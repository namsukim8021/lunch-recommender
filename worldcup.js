// worldcup.js — 탭3 점심메뉴 월드컵 (ES 모듈)
// 우선 window.__lunchTab1(탭1 후보) 재사용, 없으면 자체 수집(app.js의 categorySearchPage 패턴 로컬 재구현).
// 브래킷 진행은 lib/core.js의 순수 함수(buildWorldcupPool/pairMatches/nextRoundParticipants)로 처리.

import {
  buildGridTiles,
  mergeGridResults,
  filterByRadius,
  filterLunchCandidates,
  deriveMenuHint,
  geocodeAddress,
  buildWorldcupPool,
  pairMatches,
  nextRoundParticipants,
  isPageTruncated,
} from './lib/core.js';

const CONFIG = window.LUNCH_CONFIG || {};
const MAX_PAGES_PER_TILE = 3;
const TILE_SIZE_METERS = 400;
const DEFAULT_EMOJI = '🍽️';

let loadedOnce = false;
let localCenter = null;
let localRadius = CONFIG.RADIUS;
let poolCandidates = []; // 원본 후보(candidate 형태) — 탭1 재사용 또는 자체 수집
let currentParticipants = []; // 현재 라운드 참가자 [{place, menuText}, ...]
let currentMatches = [];
let matchWinners = [];
let currentMatchIndex = 0;

// ── 난수원(?seed= 쿼리 있으면 고정 시드 PRNG, 없으면 Math.random) ──
// scripts/oracle-check.mjs 와 동일한 mulberry32 구현(결정성 재현 목적).
function mulberry32(seed) {
  let a = seed | 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function resolveRng() {
  try {
    const params = new URLSearchParams(window.location.search);
    if (params.has('seed')) {
      const seedNum = Number(params.get('seed'));
      if (Number.isFinite(seedNum)) return mulberry32(seedNum >>> 0);
    }
  } catch (err) {
    // URL 파싱 실패해도 기본 rng로 계속 진행(크래시 없음)
  }
  return Math.random;
}

const rng = resolveRng();

function $(id) {
  return document.getElementById(id);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])
  );
}

// ---------- 자체 후보 수집(탭1 미검색 시 — app.js categorySearchPage/searchTile/collectCandidates와 동일 패턴 로컬 재구현) ----------

const SDK_POLL_INTERVAL_MS = 100;
const SDK_POLL_TIMEOUT_MS = 15000;

function waitForExistingKakaoSdk() {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const check = () => {
      if (window.kakao && window.kakao.maps) {
        resolve(window.kakao);
        return;
      }
      if (Date.now() - startedAt >= SDK_POLL_TIMEOUT_MS) {
        reject(new Error('SDK_LOAD_FAILED'));
        return;
      }
      setTimeout(check, SDK_POLL_INTERVAL_MS);
    };
    check();
  });
}

function loadKakaoSdk(appKey) {
  return new Promise((resolve, reject) => {
    if (window.kakao && window.kakao.maps) {
      resolve(window.kakao);
      return;
    }
    // 탭1(app.js)이 먼저 활성화돼 SDK 로드가 이미 진행 중일 수 있다 — 스크립트 태그 중복 삽입 방지.
    const existingScript = document.querySelector('script[src*="dapi.kakao.com"]');
    if (existingScript) {
      waitForExistingKakaoSdk().then(resolve, reject);
      return;
    }
    const script = document.createElement('script');
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

async function ensureLocalCenter() {
  if (window.__lunchTab1 && window.__lunchTab1.center) {
    localCenter = window.__lunchTab1.center;
    return;
  }
  if (CONFIG.CENTER && typeof CONFIG.CENTER.lat === 'number' && typeof CONFIG.CENTER.lng === 'number') {
    localCenter = CONFIG.CENTER;
    return;
  }
  const geocoderFn = (address, callback) => {
    const geocoder = new window.kakao.maps.services.Geocoder();
    geocoder.addressSearch(address, callback);
  };
  localCenter = await geocodeAddress(CONFIG.COMPANY_ADDRESS, geocoderFn);
}

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
    const places = new window.kakao.maps.services.Places();
    const sw = new window.kakao.maps.LatLng(tile.swLat, tile.swLng);
    const ne = new window.kakao.maps.LatLng(tile.neLat, tile.neLng);
    const bounds = new window.kakao.maps.LatLngBounds(sw, ne);
    places.categorySearch(
      'FD6',
      (data, status, pagination) => {
        if (status === window.kakao.maps.services.Status.OK) {
          resolve({ data, hasNextPage: !!(pagination && pagination.hasNextPage) });
        } else if (status === window.kakao.maps.services.Status.ZERO_RESULT) {
          resolve({ data: [], hasNextPage: false });
        } else {
          reject(new Error('SEARCH_FAILED'));
        }
      },
      {
        bounds,
        location: new window.kakao.maps.LatLng(localCenter.lat, localCenter.lng),
        page,
      }
    );
  });
}

async function searchTile(tile) {
  const collected = [];
  let isEnd = true;
  for (let page = 1; page <= MAX_PAGES_PER_TILE; page++) {
    const { data, hasNextPage } = await categorySearchPage(tile, page);
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

async function collectCandidatesOwn(radius) {
  const tiles = buildGridTiles(localCenter, radius, TILE_SIZE_METERS);
  const tileResults = await Promise.all(tiles.map((tile) => searchTile(tile)));
  const merged = mergeGridResults(tileResults);
  const withinRadius = filterByRadius(merged, radius);
  return filterLunchCandidates(withinRadius, {
    excludeCategoryKeywords: CONFIG.EXCLUDE_CATEGORY_KEYWORDS || [],
    excludePlaceIds: CONFIG.EXCLUDE_PLACE_IDS || [],
    includePlaceIds: CONFIG.INCLUDE_PLACE_IDS || [],
  });
}

async function collectViaOwnSearch(radius) {
  if (!CONFIG.KAKAO_JS_KEY) throw new Error('NO_KEY');
  if (!(window.kakao && window.kakao.maps)) {
    await loadKakaoSdk(CONFIG.KAKAO_JS_KEY);
  }
  await ensureLocalCenter();
  return collectCandidatesOwn(radius);
}

async function getSourceCandidates() {
  if (
    window.__lunchTab1 &&
    window.__lunchTab1.hasSearchedOnce &&
    Array.isArray(window.__lunchTab1.candidates) &&
    window.__lunchTab1.candidates.length > 0
  ) {
    localCenter = window.__lunchTab1.center;
    localRadius = window.__lunchTab1.radius || CONFIG.RADIUS;
    return window.__lunchTab1.candidates;
  }
  // 탭1이 아직 검색 전(hasSearchedOnce=false)이면 자체 수집 경로를 탄다(크래시 없음).
  localRadius = CONFIG.RADIUS;
  return collectViaOwnSearch(localRadius);
}

// ---------- 상태 표시 ----------

function setWorldcupStatus(message, isError) {
  const status = $('worldcup-status');
  if (!status) return;
  status.textContent = message || '';
  status.hidden = !message;
  status.classList.toggle('status-error', !!isError);
}

function showInsufficient() {
  const insufficient = $('worldcup-insufficient');
  const match = $('worldcup-match');
  const result = $('worldcup-result');
  if (insufficient) insufficient.hidden = false;
  if (match) match.hidden = true;
  if (result) result.hidden = true;
}

function showMatchSection() {
  const insufficient = $('worldcup-insufficient');
  const match = $('worldcup-match');
  const result = $('worldcup-result');
  if (insufficient) insufficient.hidden = true;
  if (match) match.hidden = false;
  if (result) result.hidden = true;
}

function showResultSection() {
  const insufficient = $('worldcup-insufficient');
  const match = $('worldcup-match');
  const result = $('worldcup-result');
  if (insufficient) insufficient.hidden = true;
  if (match) match.hidden = true;
  if (result) result.hidden = false;
}

// ---------- 브래킷 진행 ----------

function pickEmoji(categoryName) {
  const map = CONFIG.WORLDCUP_CATEGORY_EMOJI || {};
  if (categoryName) {
    for (const key of Object.keys(map)) {
      if (categoryName.includes(key)) return map[key];
    }
  }
  return DEFAULT_EMOJI;
}

function roundNameForSize(size) {
  if (size === 2) return '결승';
  return `${size}강`;
}

function startRound(participants) {
  currentParticipants = participants;
  currentMatches = pairMatches(participants);
  matchWinners = new Array(currentMatches.length).fill(undefined);
  currentMatchIndex = 0;
  renderCurrentMatch();
}

function renderCurrentMatch() {
  if (currentMatchIndex >= currentMatches.length) {
    const next = nextRoundParticipants(currentMatches, matchWinners);
    if (next.length <= 1) {
      showResult(next[0]);
    } else {
      startRound(next);
    }
    return;
  }

  const match = currentMatches[currentMatchIndex];
  const roundLabel = $('worldcup-round-label');
  if (roundLabel) {
    roundLabel.textContent = `${roundNameForSize(currentParticipants.length)} ${
      currentMatchIndex + 1
    }/${currentMatches.length}`;
  }

  renderSide('left', match.a);
  renderSide('right', match.b);
}

function renderSide(side, participant) {
  const emojiEl = $(`wc-${side}-emoji`);
  const menuEl = $(`wc-${side}-menu`);
  const placeEl = $(`wc-${side}-place`);
  if (!participant) return;
  if (emojiEl) emojiEl.textContent = pickEmoji(participant.place && participant.place.category_name);
  if (menuEl) menuEl.textContent = participant.menuText || '';
  if (placeEl) placeEl.textContent = (participant.place && participant.place.name) || '';
}

function handlePick(side) {
  matchWinners[currentMatchIndex] = side;
  currentMatchIndex += 1;
  renderCurrentMatch();
}

function showResult(winner) {
  showResultSection();
  if (!winner) return;
  const menuEl = $('wc-winner-menu');
  const placeEl = $('wc-winner-place');
  const linkEl = $('wc-winner-link');
  if (menuEl) menuEl.textContent = winner.menuText || '';
  if (placeEl) placeEl.textContent = (winner.place && winner.place.name) || '';
  if (linkEl) linkEl.href = (winner.place && winner.place.place_url) || '#';
}

// ---------- 시작/재시작/반경확대 ----------

function buildAndStartFromPool() {
  const size = CONFIG.WORLDCUP_POOL_SIZE || 16;
  const { pool, sufficient } = buildWorldcupPool(poolCandidates, CONFIG.CATEGORY_MENU_HINTS || {}, size, rng);
  if (!sufficient) {
    setWorldcupStatus('');
    showInsufficient();
    return;
  }
  setWorldcupStatus('');
  showMatchSection();
  startRound(pool);
}

async function initWorldcup() {
  showMatchSection();
  const match = $('worldcup-match');
  if (match) match.hidden = true;
  setWorldcupStatus('메뉴를 모으는 중...');
  try {
    poolCandidates = await getSourceCandidates();
  } catch (err) {
    setWorldcupStatus('식당 정보를 불러오지 못했습니다. 잠시 후 다시 시도해주세요.', true);
    return;
  }
  setWorldcupStatus('');
  buildAndStartFromPool();
}

async function handleExpandRadius() {
  setWorldcupStatus('반경을 확대해 다시 수집하는 중...');
  localRadius = (localRadius || CONFIG.RADIUS) * 1.5;
  try {
    poolCandidates = await collectViaOwnSearch(localRadius);
  } catch (err) {
    setWorldcupStatus('반경 확대 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.', true);
    return;
  }
  setWorldcupStatus('');
  buildAndStartFromPool();
}

function handleRestart() {
  // 새 추출부터 다시(이미 가진 poolCandidates 재사용, 재검색 없음)
  buildAndStartFromPool();
}

// ---------- 이벤트 바인딩 ----------

function bindWorldcupEvents() {
  const left = $('wc-left');
  const right = $('wc-right');
  const expandBtn = $('worldcup-expand-btn');
  const restartBtn = $('worldcup-restart-btn');
  if (left) left.addEventListener('click', () => handlePick(0));
  if (right) right.addEventListener('click', () => handlePick(1));
  if (expandBtn) expandBtn.addEventListener('click', handleExpandRadius);
  if (restartBtn) restartBtn.addEventListener('click', handleRestart);
}

document.addEventListener('DOMContentLoaded', () => {
  bindWorldcupEvents();
});

document.addEventListener('tab:activate', (e) => {
  if (e.detail && e.detail.tab === 3 && !loadedOnce) {
    loadedOnce = true;
    initWorldcup();
  }
});
