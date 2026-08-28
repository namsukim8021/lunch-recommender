// worldcup.js — 탭3 점심메뉴 월드컵 (ES 모듈)
// 우선 window.__lunchTab1(탭1 후보) 재사용, 없으면 자체 수집(수집은 lib/places.js 공유 모듈에 위임).
// 브래킷 진행은 lib/core.js의 순수 함수(buildWorldcupPool/pairMatches/nextRoundParticipants)로 처리.

import { buildWorldcupPool, pairMatches, nextRoundParticipants, originLabel } from './lib/core.js';
import { loadKakaoSdk, resolveCompanyCenter, collectCandidates } from './lib/places.js';

const CONFIG = window.LUNCH_CONFIG || {};
const DEFAULT_EMOJI = '🍽️';

// 수집을 끝낸 시점의 기준점. null 이면 아직 (성공적으로) 수집한 적이 없다는 뜻이라 다음 활성화에서 다시 시도한다
// (예전 loadedOnce 플래그는 실패해도 true 로 남아 새로고침 전까지 탭3를 영구 사망시켰다).
let collectedOrigin = null; // { mode: 'company'|'geo', lat, lng }
let collecting = false; // 중복 진입 방지
let pendingActivate = false; // 수집 중 들어온 탭 활성화 — 완료 후 한 번 재확인한다(이벤트 소실 방지)
let localCenter = null;
let localOriginMode = 'company'; // 지금 후보를 모은 기준점 종류(탭1을 따라간다)
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

// ---------- 자체 후보 수집 (탭1 미검색 시 — SDK 로드·지오코딩·격자 검색은 lib/places.js 공유 모듈) ----------

async function ensureLocalCenter() {
  // 탭1이 이미 기준점을 확정했으면 그대로 따른다(탭1이 "내 위치" 모드면 그 좌표를 쓴다).
  if (window.__lunchTab1 && window.__lunchTab1.center) {
    localCenter = window.__lunchTab1.center;
    localOriginMode = window.__lunchTab1.originMode || 'company';
    return;
  }
  // 실패 시 그대로 전파 — 임의 좌표를 만들지 않는다(창작 금지/D9).
  localCenter = await resolveCompanyCenter(CONFIG);
  localOriginMode = 'company';
}

async function collectViaOwnSearch(radius) {
  if (!CONFIG.KAKAO_JS_KEY) throw new Error('NO_KEY');
  // 싱글턴이라 탭1이 이미 로드했거나 로드 중이면 같은 프로미스를 그대로 받는다(중복 script 태그 없음).
  await loadKakaoSdk(CONFIG.KAKAO_JS_KEY);
  await ensureLocalCenter();
  const { list } = await collectCandidates(localCenter, radius, CONFIG);
  return list;
}

async function getSourceCandidates() {
  if (
    window.__lunchTab1 &&
    window.__lunchTab1.hasSearchedOnce &&
    Array.isArray(window.__lunchTab1.candidates) &&
    window.__lunchTab1.candidates.length > 0
  ) {
    localCenter = window.__lunchTab1.center;
    localOriginMode = window.__lunchTab1.originMode || 'company';
    localRadius = window.__lunchTab1.radius || CONFIG.RADIUS;
    return window.__lunchTab1.candidates;
  }
  // 탭1이 아직 검색 전(hasSearchedOnce=false)이면 자체 수집 경로를 탄다(크래시 없음).
  // 반경은 탭1이 들고 있는 값을 따른다 — 기준점 서명(currentOriginSignature)도 그 값을 보므로,
  // 여기서 CONFIG.RADIUS 로 고정하면 탭 전환마다 "반경이 다르다"고 판정돼 재수집이 반복된다.
  localRadius = (window.__lunchTab1 && window.__lunchTab1.radius) || CONFIG.RADIUS;
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

/**
 * 탭1이 지금 쓰고 있는 기준점(모드+좌표). 탭1이 아직 없으면 회사 기준으로 본다.
 * 좌표는 소수 5자리(≈1.1m)로 비교한다 — GPS 미세 흔들림까지 기준점 변경으로 보면 매번 재수집이 난다.
 */
function currentOriginSignature() {
  const tab1 = window.__lunchTab1;
  const mode = (tab1 && tab1.originMode) || 'company';
  const center = tab1 && tab1.center;
  return {
    mode,
    lat: center ? Number(center.lat.toFixed(5)) : null,
    lng: center ? Number(center.lng.toFixed(5)) : null,
    radius: (tab1 && tab1.radius) || CONFIG.RADIUS,
  };
}

/**
 * 지금 가진 풀(collected)을 버리고 다시 모아야 하는가.
 * - 기준점 종류(회사/내 위치)나 좌표가 달라졌으면 다른 동네 후보다 → 재수집.
 * - 탭1 반경이 지금 풀의 반경보다 **커졌으면** 재수집(탭1의 "반경 확대"가 탭3에 반영돼야 한다).
 *   반대로 탭3에서 자체 확대해 풀 반경이 더 큰 경우는 재수집하지 않는다 — 사용자가 넓힌 걸 되돌리면 안 된다.
 */
function shouldRecollect(collected, current) {
  if (!collected || !current) return true;
  if (collected.mode !== current.mode) return true;
  if (collected.lat !== null && current.lat !== null) {
    if (collected.lat !== current.lat || collected.lng !== current.lng) return true;
  }
  return Number(current.radius) > Number(collected.radius);
}

/** 지금 화면의 후보가 어느 기준점에서 모인 것인지 한 줄로 표기한다(정직 표기 — 화면에 근거를 남긴다). */
function renderOriginLine() {
  const el = $('worldcup-origin');
  if (!el) return;
  if (!collectedOrigin) {
    el.textContent = '';
    el.hidden = true; // 수집 전에는 빈 줄이 여백만 차지하지 않도록 감춘다
    return;
  }
  el.hidden = false;
  // 반경은 "의도한 값(localRadius)"이 아니라 **실제 이 풀을 만든 값**을 쓴다 —
  // 확대 버튼을 연타하면 먼저 끝난 수집이 풀을 채우는데 localRadius 는 이미 더 커져 있어 거짓 표기가 된다.
  el.textContent = `${originLabel(
    collectedOrigin.mode,
    CONFIG.COMPANY_ADDRESS || '등록된 주소'
  )} 기준 · 반경 약 ${Math.round(collectedOrigin.radius)}m(직선 근사) 후보로 진행해요.`;
}

/** 수집 중에는 반경 확대 버튼을 잠근다(연타 시 늦게 끝난 수집이 진행 중 토너먼트를 리셋하는 것을 막는다). */
function setWorldcupBusy(busy) {
  const expandBtn = $('worldcup-expand-btn');
  if (expandBtn) expandBtn.disabled = busy;
}

/** 수집이 끝난 뒤, 그 사이 들어온 탭 활성화를 한 번만 처리한다(이벤트 소실 방지 / 무한 재수집 방지). */
function drainPendingActivate() {
  if (!pendingActivate) return;
  pendingActivate = false;
  if (shouldRecollect(collectedOrigin, currentOriginSignature())) {
    poolCandidates = [];
    collectedOrigin = null;
    initWorldcup();
  }
}

async function initWorldcup() {
  if (collecting) return;
  collecting = true;
  setWorldcupBusy(true);
  showMatchSection();
  const match = $('worldcup-match');
  if (match) match.hidden = true;
  setWorldcupStatus('메뉴를 모으는 중...');
  let collected;
  try {
    collected = await getSourceCandidates();
  } catch (err) {
    // 실패하면 collectedOrigin 을 비워둔 채 끝낸다 → 탭을 다시 열면 재시도된다(영구 사망 방지).
    collectedOrigin = null;
    renderOriginLine();
    setWorldcupStatus('식당 정보를 불러오지 못했습니다. 탭을 다시 열면 재시도합니다.', true);
    return;
  } finally {
    collecting = false;
    setWorldcupBusy(false);
  }
  poolCandidates = collected;
  collectedOrigin = {
    mode: localOriginMode,
    lat: localCenter ? Number(localCenter.lat.toFixed(5)) : null,
    lng: localCenter ? Number(localCenter.lng.toFixed(5)) : null,
    radius: localRadius,
  };
  renderOriginLine();
  setWorldcupStatus('');
  buildAndStartFromPool();
  drainPendingActivate();
}

async function handleExpandRadius() {
  if (collecting) return; // 연타 방지: 늦게 끝난 수집이 진행 중 토너먼트를 리셋하는 경로를 막는다
  collecting = true;
  setWorldcupBusy(true);
  setWorldcupStatus('반경을 확대해 다시 수집하는 중...');
  const nextRadius = (localRadius || CONFIG.RADIUS) * 1.5;
  let collected;
  try {
    collected = await collectViaOwnSearch(nextRadius);
  } catch (err) {
    // 실패하면 반경을 올리지 않는다(다음 확대가 두 배로 뛰지 않도록).
    setWorldcupStatus('반경 확대 중 오류가 발생했습니다. 잠시 후 다시 시도해주세요.', true);
    return;
  } finally {
    collecting = false;
    setWorldcupBusy(false);
  }
  localRadius = nextRadius;
  poolCandidates = collected;
  collectedOrigin = {
    mode: localOriginMode,
    lat: localCenter ? Number(localCenter.lat.toFixed(5)) : null,
    lng: localCenter ? Number(localCenter.lng.toFixed(5)) : null,
    radius: localRadius,
  };
  setWorldcupStatus('');
  renderOriginLine();
  buildAndStartFromPool();
  drainPendingActivate();
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
  if (!e.detail || e.detail.tab !== 3) return;
  if (collecting) {
    // 수집 중에 들어온 활성화를 그냥 버리면(예전 동작) 그 사이 탭1에서 바꾼 기준점이 반영되지 않아
    // 사용자가 탭을 한 번 더 왕복해야 했다 — 완료 직후 재확인하도록 기록만 해둔다.
    pendingActivate = true;
    return;
  }
  // 아직 못 모았으면(최초 진입 또는 지난번 실패) 모은다.
  if (!collectedOrigin) {
    initWorldcup();
    return;
  }
  // 탭1에서 기준점·반경이 바뀌었으면 지금 풀은 다른 조건의 후보다 — 버리고 다시 모은다.
  if (shouldRecollect(collectedOrigin, currentOriginSignature())) {
    poolCandidates = [];
    collectedOrigin = null;
    initWorldcup();
  }
});
