// app.js — 점심 추천 앱 (브라우저 전용, <script type="module" src="app.js"> 로 로드)
// window.LUNCH_CONFIG(config.js) 를 읽고 Kakao Maps JS SDK를 동적 로드해 동작한다.
// 순수 로직은 전부 lib/core.js 에서 가져온다(이 파일은 DOM/SDK/localStorage 연결부만 담당).

import {
  filterByRadius,
  filterLunchCandidates,
  deriveMenuHint,
  selectRecommendation,
  buildGridTiles,
  isPageTruncated,
  mergeGridResults,
  geocodeAddress,
} from './lib/core.js';

const CONFIG = window.LUNCH_CONFIG || {};
const RECENT_KEY = 'lunch_recent';
const METRICS_KEY = 'lunch_metrics';
const METRICS_LIMIT = 50; // 최근 50개 링버퍼(docs/plan.md 계측)
const MAX_PAGES_PER_TILE = 3; // Kakao 검색 1건당 최대 45개(15개×3페이지) 상한
const WALK_METERS_PER_MIN = 67; // 보행 4km/h ≈ 67m/분 근사(docs/plan.md)
const TILE_SIZE_METERS = 400;

const els = {};
let kakao; // window.kakao 참조(SDK 로드 후 채움)
let map = null;
let marker = null;
let center = null; // { lat, lng }
let currentRadius = CONFIG.RADIUS;
let candidates = []; // 현재 라운드의 필터 통과 후보 목록
let placesById = {}; // 최근 검색 결과의 id -> candidate 맵("최근 추천 보기" 이름 표시용, 창작 금지 — 모르면 모른다고 표시)
let hasSearchedOnce = false;
let lastCandidateCount = { before: 0, after: 0 };
let lastSearchCalls = 0;

// 탭3(worldcup.js)가 이미 수집된 탭1 후보를 재사용할 수 있도록 읽기전용 노출 (docs/plan.md)
window.__lunchTab1 = {
  get candidates() { return candidates; },
  get center() { return center; },
  get radius() { return currentRadius; },
  get hasSearchedOnce() { return hasSearchedOnce; },
};

function $(id) {
  return document.getElementById(id);
}

function initDomRefs() {
  els.recommendBtn = $('recommend-btn');
  els.anotherBtn = $('another-btn');
  els.recentBtn = $('recent-btn');
  els.resetHistoryBtn = $('reset-history-btn');
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

// ---------- Kakao SDK 로드 ----------

function loadKakaoSdk(appKey) {
  return new Promise((resolve, reject) => {
    if (window.kakao && window.kakao.maps) {
      resolve(window.kakao);
      return;
    }
    const script = document.createElement('script');
    // 프로토콜 상대(//) 대신 https 명시 — index.html을 file:// 로 직접 열어 로컬 확인할 때도
    // file://dapi.kakao.com 으로 깨지지 않도록 함(GitHub Pages 배포 시에도 https이므로 영향 없음).
    script.src = `https://dapi.kakao.com/v2/maps/sdk.js?appkey=${appKey}&libraries=services&autoload=false`;
    script.onload = () => {
      try {
        window.kakao.maps.load(() => resolve(window.kakao));
      } catch (err) {
        reject(err);
      }
    };
    script.onerror = () => reject(new Error('SDK_LOAD_FAILED'));
    document.head.appendChild(script);
  });
}

async function ensureCenter() {
  if (
    CONFIG.CENTER &&
    typeof CONFIG.CENTER.lat === 'number' &&
    typeof CONFIG.CENTER.lng === 'number'
  ) {
    center = CONFIG.CENTER;
    return;
  }
  const geocoderFn = (address, callback) => {
    const geocoder = new kakao.maps.services.Geocoder();
    geocoder.addressSearch(address, callback);
  };
  // 실패 시 geocodeAddress가 reject → 여기서 임의 좌표로 대체하지 않고 그대로 전파(창작 금지/D9).
  center = await geocodeAddress(CONFIG.COMPANY_ADDRESS, geocoderFn);
}

function initMap() {
  if (!els.mapContainer) return;
  map = new kakao.maps.Map(els.mapContainer, {
    center: new kakao.maps.LatLng(center.lat, center.lng),
    level: 4,
  });
}

// ---------- 후보 수집 (격자 분할 검색 → 45개 상한 완화, docs/plan.md) ----------

function toCandidate(place) {
  return {
    id: place.id,
    name: place.place_name,
    category_name: place.category_name,
    distance: Number(place.distance),
    lat: Number(place.y),
    lng: Number(place.x),
    address: place.road_address_name || place.address_name || '',
    place_url: place.place_url,
  };
}

function categorySearchPage(tile, page) {
  return new Promise((resolve, reject) => {
    const places = new kakao.maps.services.Places();
    const sw = new kakao.maps.LatLng(tile.swLat, tile.swLng);
    const ne = new kakao.maps.LatLng(tile.neLat, tile.neLng);
    const bounds = new kakao.maps.LatLngBounds(sw, ne);
    places.categorySearch(
      'FD6',
      (data, status, pagination) => {
        if (status === kakao.maps.services.Status.OK) {
          resolve({ data, hasNextPage: !!(pagination && pagination.hasNextPage) });
        } else if (status === kakao.maps.services.Status.ZERO_RESULT) {
          resolve({ data: [], hasNextPage: false });
        } else {
          reject(new Error('SEARCH_FAILED'));
        }
      },
      {
        bounds,
        location: new kakao.maps.LatLng(center.lat, center.lng),
        page,
      }
    );
  });
}

async function searchTile(tile, incrementSearchCalls) {
  const collected = [];
  let isEnd = true;
  for (let page = 1; page <= MAX_PAGES_PER_TILE; page++) {
    const { data, hasNextPage } = await categorySearchPage(tile, page);
    incrementSearchCalls();
    collected.push(...data);
    isEnd = !hasNextPage;
    if (!hasNextPage) break;
  }
  if (isPageTruncated({ count: collected.length, isEnd })) {
    console.warn(
      '[lunch] 타일 결과가 45개 상한에 근접/도달 — 후보 누락 가능성(격자 세분화 필요, D8 위반 후보)',
      tile
    );
  }
  return collected.map(toCandidate);
}

async function collectCandidates(radius) {
  const tiles = buildGridTiles(center, radius, TILE_SIZE_METERS);
  let searchCalls = 0;
  const increment = () => {
    searchCalls += 1;
  };
  const tileResults = await Promise.all(tiles.map((tile) => searchTile(tile, increment)));
  const merged = mergeGridResults(tileResults);
  const beforeCount = merged.length;
  const withinRadius = filterByRadius(merged, radius);
  const lunchOnly = filterLunchCandidates(withinRadius, {
    excludeCategoryKeywords: CONFIG.EXCLUDE_CATEGORY_KEYWORDS || [],
    excludePlaceIds: CONFIG.EXCLUDE_PLACE_IDS || [],
    includePlaceIds: CONFIG.INCLUDE_PLACE_IDS || [],
  });

  placesById = {};
  lunchOnly.forEach((c) => {
    placesById[c.id] = c;
  });

  return {
    list: lunchOnly,
    before: beforeCount,
    after: lunchOnly.length,
    searchCalls,
  };
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
  [els.recommendBtn, els.anotherBtn, els.expandRadiusBtn, els.retryWithResetBtn].forEach((btn) => {
    if (btn) btn.disabled = busy;
  });
}

function enableActions() {
  [els.recommendBtn, els.anotherBtn, els.recentBtn, els.resetHistoryBtn].forEach((btn) => {
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
    <p class="place-distance">약 ${distanceMeters}m · 도보 약 ${walkMinutes}분(근사)</p>
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

function buildHelpItems(config, radiusMeters) {
  // radiusMeters는 config.RADIUS 고정값이 아니라 "지금 실제로 검색에 쓰이는" 반경(currentRadius)을 받는다.
  // "반경 확대" 후에도 팝업 설명이 실제 동작과 어긋나지 않아야 하므로(spec §6, D4 창작 금지 정신).
  const radius = Math.round(radiusMeters ?? config.RADIUS ?? 1000);
  const walkMinutes = Math.max(1, Math.round(radius / WALK_METERS_PER_MIN));
  const recentLimit = config.RECENT_LIMIT ?? 10;
  return [
    `회사(${config.COMPANY_ADDRESS || '등록된 주소'})에서 도보 약 ${walkMinutes}분(직선 약 ${radius}m 근사) 이내 음식점만 후보로 삼아요.`,
    '술집·호프 등 야간 전용 업종은 자동으로 제외해요. (점심 영업 여부까지 100% 보장하진 못해서, 카카오맵에서 한 번 더 확인해주세요.)',
    `최근 ${recentLimit}곳은 다시 추천하지 않아요. 후보가 다 소진되면 오래된 순서부터 다시 후보에 포함돼요.`,
    '남은 후보 중에서 무작위로 한 곳을 골라드려요.',
    '메뉴 힌트는 업종(카테고리) 기반 추정이에요 — 실제 메뉴·가격·영업시간은 카카오맵 링크에서 확인해주세요.',
  ];
}

let helpPreviouslyFocused = null;

function openHelpModal() {
  if (els.helpModalBody) {
    els.helpModalBody.innerHTML = buildHelpItems(CONFIG, currentRadius)
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

async function handleRecommend() {
  setBusy(true);
  const startedAt = performance.now();
  try {
    if (!hasSearchedOnce) {
      showStatus('회사 주변 식당을 검색하는 중...', false);
      const result = await collectCandidates(currentRadius);
      candidates = result.list;
      lastCandidateCount = { before: result.before, after: result.after };
      lastSearchCalls = result.searchCalls;
      hasSearchedOnce = true;
      clearStatus();
    }

    if (candidates.length === 0) {
      renderCandidateEmpty();
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
      return;
    }

    saveRecent(newRecentIds);
    renderResultCard(picked);

    const elapsedMs = performance.now() - startedAt;
    recordMetrics({
      elapsedMs,
      searchCalls: lastSearchCalls,
      candidateCount: { ...lastCandidateCount },
    });
    lastSearchCalls = 0; // 이번 검색분 계측은 소비했으므로 "다른 곳"(재검색 없음)에서는 0으로 기록
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
    });
  } catch (err) {
    handleRuntimeError(err);
  } finally {
    setBusy(false);
  }
}

async function handleExpandRadius() {
  currentRadius = currentRadius * 1.5;
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
  if (els.recentPanel && !els.recentPanel.hidden) {
    els.recentList.innerHTML = '<li>최근 추천 이력이 없습니다.</li>';
  }
  showStatus('추천 이력을 초기화했습니다.', false);
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
    clearStatus();
    enableActions();
  } catch (err) {
    handleBootstrapError(err);
  }
}

document.addEventListener('DOMContentLoaded', () => {
  bootstrap();
});
