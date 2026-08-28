// app.js — 점심 추천 앱 (브라우저 전용, <script type="module" src="app.js"> 로 로드)
// window.LUNCH_CONFIG(config.js) 를 읽고 Kakao Maps JS SDK를 동적 로드해 동작한다.
// 순수 로직은 전부 lib/core.js 에서 가져온다(이 파일은 DOM/SDK/localStorage 연결부만 담당).

import {
  deriveMenuHint,
  selectRecommendation,
  normalizeGeoPosition,
  describeGeolocationError,
  originLabel,
} from './lib/core.js';
import {
  loadKakaoSdk,
  resolveCompanyCenter,
  collectCandidates,
  clearTileCache,
  TILE_CACHE_TTL_MS,
} from './lib/places.js';

const CONFIG = window.LUNCH_CONFIG || {};
const RECENT_KEY = 'lunch_recent';
const METRICS_KEY = 'lunch_metrics';
const METRICS_LIMIT = 50; // 최근 50개 링버퍼(docs/plan.md 계측)
const WALK_METERS_PER_MIN = 80; // 보행 4.8km/h ≈ 80m/분 근사 — 국내 "도보 1분 = 80m" 관행에 맞춤(800m ↔ 도보 10분)
const GEO_OPTIONS = { enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }; // maximumAge로 OS 캐시 재사용(불필요한 GPS 기동 절감)

const els = {};
let kakao; // window.kakao 참조(SDK 로드 후 채움)
let map = null;
let marker = null;
let center = null; // { lat, lng } — 지금 추천에 쓰는 기준점
let originMode = 'company'; // 'company' | 'geo' — 기준점이 회사인지 내 위치인지
let companyCenter = null; // ensureCenter()로 확정된 회사 좌표(내 위치 모드에서 복귀할 때 씀)
let geoAccuracy = null; // 그 위치의 측위 반경(m). null이면 브라우저가 알려주지 않은 것(추정하지 않는다)
let currentRadius = CONFIG.RADIUS;
let candidates = []; // 현재 라운드의 필터 통과 후보 목록
let placesById = {}; // 최근 검색 결과의 id -> candidate 맵("최근 추천 보기" 이름 표시용, 창작 금지 — 모르면 모른다고 표시)
let hasSearchedOnce = false;
let lastCandidateCount = { before: 0, after: 0 };
let lastSearchCalls = 0;
let lastTileStats = { cachedTiles: 0, fetchedTiles: 0 }; // 타일 캐시 적중 계측(호출 절감 효과 확인용)

// 탭3(worldcup.js)가 이미 수집된 탭1 후보를 재사용할 수 있도록 읽기전용 노출 (docs/plan.md)
window.__lunchTab1 = {
  get candidates() { return candidates; },
  get center() { return center; },
  get radius() { return currentRadius; },
  get hasSearchedOnce() { return hasSearchedOnce; },
  get originMode() { return originMode; }, // 탭3가 기준점 변경(회사 ↔ 내 위치)을 인지할 수 있게
};

function $(id) {
  return document.getElementById(id);
}

function initDomRefs() {
  els.recommendBtn = $('recommend-btn');
  els.anotherBtn = $('another-btn');
  els.recentBtn = $('recent-btn');
  els.resetHistoryBtn = $('reset-history-btn');
  els.myLocationBtn = $('my-location-btn');
  els.appSubtitle = $('app-subtitle');
  els.geoAccuracyNotice = $('geo-accuracy-notice');
  els.expandRadiusBtn = $('expand-radius-btn');
  els.retryWithResetBtn = $('retry-with-reset-btn');
  els.resultCard = $('result-card');
  els.emptyState = $('empty-state');
  els.candidateEmpty = $('candidate-empty');
  els.recentPanel = $('recent-panel');
  els.recentList = $('recent-list');
  els.statusMsg = $('status-msg');
  els.mapContainer = $('map');
  els.helpBtn = $('help-btn');
  els.helpOverlay = $('help-overlay');
  els.helpModal = $('help-modal');
  els.helpCloseBtn = $('help-close-btn');
  els.helpModalBody = $('help-modal-body');
}

// ---------- localStorage 연결부 (개인정보는 localStorage만 — constitution 2) ----------

function loadRecent() {
  try {
    const raw = localStorage.getItem(RECENT_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    return Array.isArray(parsed) ? parsed : [];
  } catch (err) {
    console.error('[lunch] 이력 로드 실패', err);
    return [];
  }
}

function saveRecent(ids) {
  try {
    localStorage.setItem(RECENT_KEY, JSON.stringify(ids));
  } catch (err) {
    console.error('[lunch] 이력 저장 실패', err);
  }
}

function clearMetrics() {
  try {
    localStorage.removeItem(METRICS_KEY);
  } catch (err) {
    console.error('[lunch] 계측 초기화 실패', err);
  }
}

function clearRecent() {
  try {
    localStorage.removeItem(RECENT_KEY);
  } catch (err) {
    console.error('[lunch] 이력 초기화 실패', err);
  }
}

function recordMetrics(entry) {
  try {
    const raw = localStorage.getItem(METRICS_KEY);
    const list = raw ? JSON.parse(raw) : [];
    const arr = Array.isArray(list) ? list : [];
    arr.push({ ts: Date.now(), ...entry });
    while (arr.length > METRICS_LIMIT) arr.shift();
    localStorage.setItem(METRICS_KEY, JSON.stringify(arr));
  } catch (err) {
    console.error('[lunch] 계측 저장 실패', err);
  }
}

// ---------- 기준점 확정 (SDK 로드·지오코딩·격자 검색은 lib/places.js 공유 모듈) ----------

async function ensureCenter() {
  // 실패 시 resolveCompanyCenter가 reject → 여기서 임의 좌표로 대체하지 않고 그대로 전파(창작 금지/D9).
  companyCenter = await resolveCompanyCenter(CONFIG);
  center = companyCenter;
}

/**
 * navigator.geolocation.getCurrentPosition의 Promise 래퍼.
 * 위치 기능이 없는 브라우저는 GEO_UNSUPPORTED로 reject한다(추정 좌표를 만들지 않는다).
 */
function getCurrentPositionAsync() {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('GEO_UNSUPPORTED'));
      return;
    }
    navigator.geolocation.getCurrentPosition(resolve, reject, GEO_OPTIONS);
  });
}

function initMap() {
  if (!els.mapContainer) return;
  map = new kakao.maps.Map(els.mapContainer, {
    center: new kakao.maps.LatLng(center.lat, center.lng),
    level: 4,
  });
}

// ---------- 상태 표시 ----------

function showStatus(message, isError) {
  if (!els.statusMsg) return;
  els.statusMsg.textContent = message;
  els.statusMsg.hidden = !message;
  els.statusMsg.classList.toggle('status-error', !!isError);
}

function clearStatus() {
  showStatus('', false);
}

function setBusy(busy) {
  [
    els.recommendBtn,
    els.anotherBtn,
    els.expandRadiusBtn,
    els.retryWithResetBtn,
    els.myLocationBtn,
    // 검색 중 초기화가 끼면 수집 완료 시점의 write 가 방금 지운 타일을 되살린다(lib/places.js 세대 카운터와 2중 방어).
    els.resetHistoryBtn,
  ].forEach((btn) => {
    if (btn) btn.disabled = busy;
  });
}

function enableActions() {
  [els.recommendBtn, els.anotherBtn, els.recentBtn, els.resetHistoryBtn, els.myLocationBtn].forEach((btn) => {
    if (btn) btn.disabled = false;
  });
}

function disableActions() {
  [els.recommendBtn, els.anotherBtn].forEach((btn) => {
    if (btn) btn.disabled = true;
  });
}

// ---------- 렌더 ----------

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])
  );
}

function renderResultCard(candidate) {
  els.emptyState.hidden = true;
  els.candidateEmpty.hidden = true;
  els.resultCard.hidden = false;

  const hint = deriveMenuHint(candidate.category_name, CONFIG.CATEGORY_MENU_HINTS || {});
  const distanceMeters = Math.round(candidate.distance);
  const walkMinutes = Math.max(1, Math.round(candidate.distance / WALK_METERS_PER_MIN));

  els.resultCard.innerHTML = `
    <h2 class="place-name">${escapeHtml(candidate.name || '이름 확인 불가')}</h2>
    <p class="place-category">${escapeHtml(candidate.category_name || '')}</p>
    <p class="place-hint">${
      hint ? `메뉴 힌트: ${escapeHtml(hint)} (업종 기반 추정)` : '메뉴 힌트 정보 없음'
    }</p>
    <p class="place-distance">약 ${distanceMeters}m(직선 근사) · 도보 약 ${walkMinutes}분(도보 1분=${WALK_METERS_PER_MIN}m 관행 기준 근사)</p>
    <a class="place-link" href="${escapeHtml(candidate.place_url || '#')}" target="_blank" rel="noopener noreferrer">카카오맵에서 보기</a>
    <p class="place-disclaimer">영업 여부·메뉴는 카카오맵에서 확인하세요.</p>
  `;

  updateMapMarker(candidate);
}

function updateMapMarker(candidate) {
  if (!map || !kakao) return;
  const pos = new kakao.maps.LatLng(candidate.lat, candidate.lng);
  map.setCenter(pos);
  if (marker) marker.setMap(null);
  marker = new kakao.maps.Marker({ position: pos, map });
}

function renderCandidateEmpty() {
  els.resultCard.hidden = true;
  els.emptyState.hidden = true;
  els.candidateEmpty.hidden = false;
}

function buildHelpItems(config, radiusMeters, mode) {
  // radiusMeters는 config.RADIUS 고정값이 아니라 "지금 실제로 검색에 쓰이는" 반경(currentRadius)을 받는다.
  // "반경 확대" 후에도 팝업 설명이 실제 동작과 어긋나지 않아야 하므로(spec §6, D4 창작 금지 정신).
  // mode도 같은 이유로 받는다 — 내 위치 기준으로 검색해놓고 "회사에서 도보 N분"이라 쓰면 거짓 표기다.
  const radius = Math.round(radiusMeters ?? config.RADIUS ?? 800);
  const walkMinutes = Math.max(1, Math.round(radius / WALK_METERS_PER_MIN));
  const recentLimit = config.RECENT_LIMIT ?? 10;
  // 캐시 수명·위치 재사용 시간은 상수에서 직접 계산한다(문구가 실제 동작보다 낡지 않도록).
  const cacheHours = Math.round(TILE_CACHE_TTL_MS / 3600000);
  const geoMaxAgeMinutes = Math.round(GEO_OPTIONS.maximumAge / 60000);
  return [
    `${originLabel(mode, config.COMPANY_ADDRESS || '등록된 주소')}에서 도보 약 ${walkMinutes}분(직선 약 ${radius}m 근사) 이내 음식점만 후보로 삼아요.`,
    '술집·호프 등 야간 전용 업종은 자동으로 제외해요. (점심 영업 여부까지 100% 보장하진 못해서, 카카오맵에서 한 번 더 확인해주세요.)',
    `최근 ${recentLimit}곳은 다시 추천하지 않아요. 후보가 다 소진되면 오래된 순서부터 다시 후보에 포함돼요.`,
    '남은 후보 중에서 무작위로 한 곳을 골라드려요.',
    '메뉴 힌트는 업종(카테고리) 기반 추정이에요 — 실제 메뉴·가격·영업시간은 카카오맵 링크에서 확인해주세요.',
    `검색 결과는 최대 ${cacheHours}시간 동안 이 기기에 저장해 다시 써요(카카오 호출을 아끼려고요). 그 사이 새로 생기거나 문 닫은 가게는 반영이 늦을 수 있어요.`,
    `"내 위치"는 최대 ${geoMaxAgeMinutes}분 전에 확인된 위치를 그대로 쓸 수 있어요(배터리·GPS 절약). 정확도가 낮게 잡히면 화면에 알려드려요.`,
    '추천 이력·검색 결과·사용 기록은 이 기기에만 저장되고 서버로 전송되지 않아요. "이력·캐시 초기화"를 누르면 회사 주소 좌표 캐시만 남기고 모두 지워져요.',
  ];
}

let helpPreviouslyFocused = null;

function openHelpModal() {
  if (els.helpModalBody) {
    els.helpModalBody.innerHTML = buildHelpItems(CONFIG, currentRadius, originMode)
      .map((t) => `<li>${escapeHtml(t)}</li>`)
      .join('');
  }
  helpPreviouslyFocused = document.activeElement;
  els.helpOverlay.hidden = false;
  if (els.helpCloseBtn) els.helpCloseBtn.focus();
}

function closeHelpModal() {
  els.helpOverlay.hidden = true;
  if (helpPreviouslyFocused && typeof helpPreviouslyFocused.focus === 'function') {
    helpPreviouslyFocused.focus();
  }
}

function toggleRecentPanel() {
  if (!els.recentPanel) return;
  if (els.recentPanel.hidden) {
    const ids = loadRecent();
    if (ids.length === 0) {
      els.recentList.innerHTML = '<li>최근 추천 이력이 없습니다.</li>';
    } else {
      els.recentList.innerHTML = ids
        .map((id) => {
          const place = placesById[id];
          // 이번 세션에서 검색한 후보에 없으면 이름을 지어내지 않고 정직하게 표기(창작 금지).
          return `<li>${
            place ? escapeHtml(place.name) : `(이름 확인 불가 · 다시 추천 후 확인 가능)`
          }</li>`;
        })
        .join('');
    }
    els.recentPanel.hidden = false;
  } else {
    els.recentPanel.hidden = true;
  }
}

// ---------- 이벤트 핸들러 ----------

/**
 * 이번 검색분 계측을 기록하고 카운터를 소비한다.
 * 조기 반환(후보 0건) 경로에서 이 호출을 빠뜨리면 지난 검색의 searchCalls 가 다음 추천 기록에 얹힌다.
 */
function recordSearchMetrics(startedAt) {
  recordMetrics({
    elapsedMs: performance.now() - startedAt,
    searchCalls: lastSearchCalls,
    candidateCount: { ...lastCandidateCount },
    ...lastTileStats,
  });
  lastSearchCalls = 0; // 소비했으므로 "다른 곳"(재검색 없음)에서는 0으로 기록된다
  lastTileStats = { cachedTiles: 0, fetchedTiles: 0 };
}

async function handleRecommend() {
  setBusy(true);
  const startedAt = performance.now();
  try {
    if (!hasSearchedOnce) {
      // 기준점이 회사가 아닐 수도 있으므로 문구도 실제 기준점을 따라간다(정직 표기).
      showStatus(`${originMode === 'geo' ? '내 위치' : '회사'} 주변 식당을 검색하는 중...`, false);
      const result = await collectCandidates(center, currentRadius, CONFIG);
      candidates = result.list;
      // 이번 검색 결과로 이름 표시용 맵을 갱신("최근 추천 보기" — 모르는 id는 지어내지 않는다).
      placesById = {};
      candidates.forEach((c) => {
        placesById[c.id] = c;
      });
      lastCandidateCount = { before: result.before, after: result.after };
      lastSearchCalls = result.searchCalls;
      lastTileStats = { cachedTiles: result.cachedTiles, fetchedTiles: result.fetchedTiles };
      hasSearchedOnce = true;
      clearStatus();
    }

    if (candidates.length === 0) {
      renderCandidateEmpty();
      recordSearchMetrics(startedAt); // 후보 0건도 이번 검색 비용은 기록하고 카운터를 소비한다
      return;
    }

    const recentIds = loadRecent();
    const { picked, recentIds: newRecentIds } = selectRecommendation(
      candidates,
      recentIds,
      Math.random,
      CONFIG.RECENT_LIMIT
    );

    if (!picked) {
      renderCandidateEmpty();
      recordSearchMetrics(startedAt);
      return;
    }

    saveRecent(newRecentIds);
    renderResultCard(picked);
    recordSearchMetrics(startedAt);
  } catch (err) {
    handleRuntimeError(err);
  } finally {
    setBusy(false);
  }
}

async function handleAnother() {
  if (!hasSearchedOnce) {
    await handleRecommend();
    return;
  }
  setBusy(true);
  const startedAt = performance.now();
  try {
    if (candidates.length === 0) {
      renderCandidateEmpty();
      return;
    }
    const recentIds = loadRecent();
    // 같은 후보 리스트로 재실행(재검색 없음)
    const { picked, recentIds: newRecentIds } = selectRecommendation(
      candidates,
      recentIds,
      Math.random,
      CONFIG.RECENT_LIMIT
    );
    if (!picked) {
      renderCandidateEmpty();
      return;
    }
    saveRecent(newRecentIds);
    renderResultCard(picked);
    const elapsedMs = performance.now() - startedAt;
    recordMetrics({
      elapsedMs,
      searchCalls: 0,
      candidateCount: { ...lastCandidateCount },
      cachedTiles: 0,
      fetchedTiles: 0, // 재검색이 없는 경로라 항상 0(계측 항목 형태는 통일)
    });
  } catch (err) {
    handleRuntimeError(err);
  } finally {
    setBusy(false);
  }
}

/**
 * 기준점 관련 UI를 한 곳에서 갱신한다(버튼 라벨·상태, 헤더 문구).
 * 헤더까지 함께 바꾸는 이유: "회사 주변에서 골라드려요"가 내 위치 모드에서도 남아 있으면 거짓 표기다.
 */
function updateOriginUi() {
  if (els.myLocationBtn) {
    // 토글 버튼의 접근 가능한 이름은 상태에 따라 바꾸지 않는다(WAI-ARIA APG).
    // 라벨을 "🏢 회사 기준"으로 뒤집으면 aria-pressed=true 와 합쳐져 "회사 기준 버튼, 눌림"으로 낭독돼
    // 실제 상태(내 위치 활성)와 정반대가 된다. 라벨은 고정하고 상태는 aria-pressed + .is-active 로만 전달한다.
    els.myLocationBtn.classList.toggle('is-active', originMode === 'geo');
    els.myLocationBtn.setAttribute('aria-pressed', originMode === 'geo' ? 'true' : 'false');
  }
  if (els.appSubtitle) {
    // 헤더는 공간 제약상 짧은 라벨(회사 / 내 위치)만 쓴다. 정확한 주소 표기는 도움말 모달의
    // originLabel 이 담당한다 — 여기서 잡아야 할 거짓은 "기준점이 바뀌었는데 회사라고 말하는 것"이지
    // 주소를 안 쓰는 것이 아니다(모바일 우선: 주소를 넣으면 문구가 2줄로 감긴다).
    const shortOriginLabel = originMode === 'geo' ? '내 위치' : '회사';
    els.appSubtitle.textContent = `${shortOriginLabel} 주변에서, 최근이랑 안 겹치게 골라드려요`;
  }
  updateGeoAccuracyNotice();
}

/**
 * 측위 정확도가 추천 반경보다 낮을 때 띄우는 상시 배지.
 * 상태줄(status-msg)에 쓰면 ① 검색 실패 안내를 덮어쓰고 ② "다른 곳" 한 번에 사라져 고지가 유지되지 않는다.
 * 내 위치 모드인 동안 계속 떠 있고, 회사 기준으로 돌아가면 사라진다.
 */
function updateGeoAccuracyNotice() {
  if (!els.geoAccuracyNotice) return;
  const lowAccuracy =
    originMode === 'geo' && Number.isFinite(geoAccuracy) && geoAccuracy > currentRadius;
  els.geoAccuracyNotice.hidden = !lowAccuracy;
  if (lowAccuracy) {
    els.geoAccuracyNotice.textContent = `현재 위치 정확도가 ±${Math.round(
      geoAccuracy
    )}m로 낮아(추천 반경 ${Math.round(
      currentRadius
    )}m) 추천이 부정확할 수 있어요. "📍 내 위치"를 다시 누르면 회사 기준으로 돌아갑니다.`;
  }
}

/**
 * 기준점 토글. 회사 기준 ↔ 내 위치 기준을 오가며, 어느 쪽이든 실패하면 회사 기준을 그대로 유지한다.
 * 위치를 못 얻었을 때 좌표를 추정해 넣지 않는다(창작 금지/D9).
 */
async function handleMyLocation() {
  setBusy(true);
  try {
    if (originMode === 'geo') {
      // 회사 기준으로 복귀 — 이미 확정된 회사 좌표를 쓰므로 위치 권한을 다시 묻지 않는다.
      originMode = 'company';
      center = companyCenter;
      geoAccuracy = null;
      updateOriginUi();
      hasSearchedOnce = false;
      candidates = [];
      if (map && kakao && center) map.setCenter(new kakao.maps.LatLng(center.lat, center.lng));
      // 여기서 상태 문구를 쓰지 않는다 — 바로 이어지는 handleRecommend() 가 검색 문구로 덮어쓰기 때문.
      await handleRecommend();
      return;
    }

    showStatus('현재 위치를 확인하는 중...', false);
    const position = await getCurrentPositionAsync();
    const coords = normalizeGeoPosition(position);
    if (!coords) {
      // 좌표가 유효하지 않으면 지어내지 않고 회사 기준 그대로 둔다.
      showStatus(describeGeolocationError(undefined), true);
      return;
    }
    geoAccuracy = coords.accuracy;
    center = { lat: coords.lat, lng: coords.lng };
    originMode = 'geo';
    updateOriginUi();
    hasSearchedOnce = false;
    candidates = [];
    if (map && kakao) map.setCenter(new kakao.maps.LatLng(center.lat, center.lng));
    // 측위 반경이 추천 반경보다 크면(데스크톱 WiFi/IP 측위는 ±20km도 나온다) 전환은 진행하되
    // updateOriginUi() 안의 상시 배지로 고지한다 — 상태줄은 검색 진행·실패 안내 전용으로 남긴다.
    await handleRecommend();
  } catch (err) {
    console.error('[lunch] 내 위치 확인 실패', err);
    const message =
      err && err.message === 'GEO_UNSUPPORTED'
        ? '이 브라우저는 위치 기능을 지원하지 않습니다. 회사 기준 추천을 유지합니다.'
        : describeGeolocationError(err && err.code);
    showStatus(message, true); // originMode는 바꾸지 않는다 — 회사 기준 추천은 계속 동작한다.
  } finally {
    setBusy(false);
  }
}

async function handleExpandRadius() {
  currentRadius = currentRadius * 1.5;
  updateGeoAccuracyNotice(); // 반경이 커지면 저정확도 판정(accuracy > currentRadius)이 달라진다
  hasSearchedOnce = false;
  showStatus(`반경을 약 ${Math.round(currentRadius)}m로 확대하여 다시 검색합니다...`, false);
  await handleRecommend();
}

async function handleRetryWithReset() {
  clearRecent();
  await handleRecommend();
}

function handleResetHistory() {
  clearRecent();
  // 타일 캐시 키는 절대 좌표라 "사용자가 있던 위치"가 남는다 — 사용자가 명시적으로 지울 수단을 준다.
  // 자동 삭제가 아니라 버튼을 누를 때만 지우므로 호출 절감 효과는 유지된다.
  clearTileCache();
  // 계측(lunch_metrics)도 사용자 데이터다(시각·소요시간 기록) — 도움말이 "지워져요"라고 말하는 범위에 포함.
  clearMetrics();
  if (els.recentPanel && !els.recentPanel.hidden) {
    els.recentList.innerHTML = '<li>최근 추천 이력이 없습니다.</li>';
  }
  showStatus('추천 이력·검색 결과·사용 기록을 초기화했습니다.', false);
}

function handleRuntimeError(err) {
  console.error('[lunch] 추천 처리 중 오류', err);
  if (err && err.message === 'SEARCH_FAILED') {
    showStatus('식당 검색에 실패했습니다. 잠시 후 다시 시도해주세요.', true);
  } else {
    showStatus('오류가 발생했습니다. 잠시 후 다시 시도해주세요.', true);
  }
}

function bindEvents() {
  if (els.recommendBtn) els.recommendBtn.addEventListener('click', handleRecommend);
  if (els.anotherBtn) els.anotherBtn.addEventListener('click', handleAnother);
  if (els.recentBtn) els.recentBtn.addEventListener('click', toggleRecentPanel);
  if (els.resetHistoryBtn) els.resetHistoryBtn.addEventListener('click', handleResetHistory);
  if (els.myLocationBtn) els.myLocationBtn.addEventListener('click', handleMyLocation);
  if (els.expandRadiusBtn) els.expandRadiusBtn.addEventListener('click', handleExpandRadius);
  if (els.retryWithResetBtn)
    els.retryWithResetBtn.addEventListener('click', handleRetryWithReset);
  if (els.helpBtn) els.helpBtn.addEventListener('click', openHelpModal);
  if (els.helpCloseBtn) els.helpCloseBtn.addEventListener('click', closeHelpModal);
  if (els.helpOverlay) {
    els.helpOverlay.addEventListener('click', (e) => {
      if (e.target === els.helpOverlay) closeHelpModal(); // 배경 클릭만 닫기, 모달 내부 클릭은 무시
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && els.helpOverlay && !els.helpOverlay.hidden) closeHelpModal();
  });
}

// ---------- 부트스트랩 ----------

function handleBootstrapError(err) {
  console.error('[lunch] 초기화 실패', err);
  if (err && err.message === 'GEOCODE_FAILED') {
    showStatus(
      '회사 주소를 좌표로 변환하지 못했습니다. 잠시 후 다시 시도하거나 config.js의 COMPANY_ADDRESS를 확인하세요.',
      true
    );
  } else if (err && err.message === 'SDK_LOAD_FAILED') {
    showStatus(
      '카카오 지도 SDK를 불러오지 못했습니다. 네트워크 상태나 앱키의 허용 도메인 등록을 확인하세요.',
      true
    );
  } else {
    showStatus('초기화 중 오류가 발생했습니다.', true);
  }
  disableActions();
}

async function bootstrap() {
  initDomRefs();
  bindEvents();
  disableActions();

  if (!CONFIG.KAKAO_JS_KEY) {
    showStatus(
      'Kakao JS 키가 설정되지 않았습니다. config.js의 KAKAO_JS_KEY를 확인하세요.',
      true
    );
    return;
  }

  try {
    showStatus('지도를 불러오는 중...', false);
    kakao = await loadKakaoSdk(CONFIG.KAKAO_JS_KEY);
    await ensureCenter();
    initMap();
    updateOriginUi();
    clearStatus();
    enableActions();
  } catch (err) {
    handleBootstrapError(err);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  bootstrap();
});
