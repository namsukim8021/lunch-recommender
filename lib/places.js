// lib/places.js — Kakao SDK 로드 · 지오코딩 · 격자 검색 공유 모듈 (브라우저 전용, ES 모듈)
//
// app.js(탭1)와 worldcup.js(탭3)가 **같은 모듈 인스턴스**를 import 해서
// SDK 로드 프로미스 · 지오코딩 결과 · 타일 검색 결과를 공유한다(Kakao API 호출 절감).
// 순수 로직은 전부 lib/core.js 에서 가져온다 — 이 파일은 SDK/localStorage 연결부만 담당한다.
// (lib/core.js 는 Node 에서도 import 가능해야 하므로 스토리지 접근은 전부 여기 모아둔다.)

import {
  buildGridTiles,
  isTileOutsideRadius,
  tileCacheKey,
  isFreshTileCache,
  evictOldestTiles,
  isPageTruncated,
  mergeGridResults,
  haversineMeters,
  filterByRadius,
  filterLunchCandidates,
  geocodeAddress,
} from './core.js';

const MAX_PAGES_PER_TILE = 3; // Kakao 검색 1건당 최대 45개(15개×3페이지) 상한
const TILE_SIZE_METERS = 400;

const GEOCODE_CACHE_KEY = 'lunch_geocode_v1'; // { [address]: {lat, lng, ts} }
const GEOCODE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30일 — 회사 주소 좌표는 거의 변하지 않는다
const TILE_CACHE_KEY = 'lunch_tiles_v1'; // { [tileCacheKey]: {ts, places} }
// 6시간 — 하루 안에서 식당 목록이 바뀔 일이 드물다. 도움말 문구가 이 값을 그대로 읽어 쓰도록 export 한다
// (하드코딩하면 상수를 바꿀 때 화면 안내만 낡아 거짓 표기가 된다).
export const TILE_CACHE_TTL_MS = 21600000;
// localStorage 용량 보호(초과분은 오래된 것부터 제거). 200엔트리는 추정 3.4MB(UTF-16)로 5MB 한도에
// 여유가 30%뿐이고, 넘치면 setItem 이 조용히 실패해 추천 이력(lunch_recent) 저장이 죽는다 — 120(약 2MB)로 낮춘다.
const TILE_CACHE_MAX_ENTRIES = 120;

// ---------- Kakao SDK 로드 (싱글턴) ----------

let sdkPromise = null;

/**
 * Kakao Maps JS SDK를 동적 로드한다. 모듈 스코프 싱글턴 프로미스라 탭1·탭3가 몇 번 부르든 script 태그는 1개다.
 * 실패는 캐시하지 않는다(네트워크 복구 후 재시도 가능하도록 sdkPromise 를 되돌린다).
 * @param {string} appKey 도메인 제한된 Kakao JS 앱키(constitution 4)
 * @returns {Promise<any>} window.kakao
 */
export function loadKakaoSdk(appKey) {
  // 진행 중인 프로미스를 **먼저** 본다. autoload=false 라 sdk.js 평가 직후 window.kakao.maps 는
  // load 만 가진 스텁으로 이미 존재하고 services 는 kakao.maps.load() 콜백 이후에 생긴다.
  // 이 구간에서 두 번째 호출자에게 스텁을 돌려주면 new kakao.maps.services.Geocoder() 가 TypeError 로 죽는다
  // (탭3는 loadedOnce 때문에 그대로 영구 사망했다). 즉시 resolve 조건도 services 존재까지 확인한다.
  if (sdkPromise) return sdkPromise;
  if (window.kakao && window.kakao.maps && window.kakao.maps.services) {
    return Promise.resolve(window.kakao);
  }

  sdkPromise = new Promise((resolve, reject) => {
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
    script.onerror = () => {
      // 실패한 태그를 남겨두면 재시도마다 head 에 누적된다.
      if (script.parentNode) script.parentNode.removeChild(script);
      reject(new Error('SDK_LOAD_FAILED'));
    };
    document.head.appendChild(script);
  });
  sdkPromise.catch(() => {
    sdkPromise = null;
  });
  return sdkPromise;
}

// ---------- localStorage 연결부 (개인정보는 localStorage만 — constitution 2) ----------

function readJson(key) {
  try {
    const raw = localStorage.getItem(key);
    const parsed = raw ? JSON.parse(raw) : null;
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch (err) {
    console.warn('[lunch] 캐시 로드 실패(무시하고 진행)', key, err);
    return {};
  }
}

function writeJson(key, value) {
  // QuotaExceededError · 사파리 프라이빗 모드 등 저장 실패는 캐시가 없는 것과 같다 — 흡수하고 계속 진행.
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch (err) {
    console.warn('[lunch] 캐시 저장 실패(무시하고 진행)', key, err);
  }
}

// ---------- 회사 좌표(지오코딩 캐시) ----------

/**
 * 회사 기준 좌표를 구한다. config.CENTER가 유효하면 그대로,
 * 아니면 localStorage 지오코딩 캐시(30일) → 미스일 때만 Kakao Geocoder 1회 호출.
 * 지오코딩 실패는 그대로 전파(GEOCODE_FAILED) — 임의 좌표로 대체하지 않는다(창작 금지/D9).
 * @param {{CENTER?: {lat: number, lng: number}|null, COMPANY_ADDRESS?: string}} config
 * @returns {Promise<{lat: number, lng: number}>}
 */
export async function resolveCompanyCenter(config) {
  const configured = config.CENTER;
  if (configured && Number.isFinite(configured.lat) && Number.isFinite(configured.lng)) {
    return { lat: configured.lat, lng: configured.lng };
  }

  const address = config.COMPANY_ADDRESS;
  const cache = readJson(GEOCODE_CACHE_KEY);
  const hit = cache[address];
  if (
    hit &&
    Number.isFinite(hit.lat) &&
    Number.isFinite(hit.lng) &&
    Number.isFinite(hit.ts) &&
    Date.now() - hit.ts >= 0 &&
    Date.now() - hit.ts <= GEOCODE_TTL_MS
  ) {
    return { lat: hit.lat, lng: hit.lng };
  }

  const geocoderFn = (addr, callback) => {
    const geocoder = new window.kakao.maps.services.Geocoder();
    geocoder.addressSearch(addr, callback);
  };
  const center = await geocodeAddress(address, geocoderFn);
  cache[address] = { lat: center.lat, lng: center.lng, ts: Date.now() };
  writeJson(GEOCODE_CACHE_KEY, cache);
  return center;
}

// ---------- 후보 수집 (격자 분할 검색 → 45개 상한 완화, docs/plan.md) ----------

/**
 * ⚠️ 이 함수의 필드 구성을 바꾸면 **반드시 TILE_CACHE_KEY 의 버전(_v1)을 올려라.**
 * 낡은 엔트리는 isFreshTileCache 를 그대로 통과하므로, 키를 그대로 두면 신규 필드가 undefined 인
 * 옛 스키마 place 가 결과에 섞여 화면에 빈 값으로 나간다(창작 금지 위반 경로).
 *
 * Kakao place 를 캐시 가능한 형태로 정규화한다.
 * distance 는 담지 않는다 — Kakao 의 distance 는 "요청 시 location 기준" 상대값이라
 * 캐시에 넣으면 기준점이 바뀔 때(회사 ↔ 내 위치) 오염된다. 거리는 병합 후 haversineMeters 로 다시 계산한다.
 * @param {object} place Kakao categorySearch 결과 원소
 * @returns {{id: string, name: string, category_name: string, lat: number, lng: number, address: string, place_url: string}}
 */
function toCachedPlace(place) {
  return {
    id: place.id,
    name: place.place_name,
    category_name: place.category_name,
    lat: Number(place.y),
    lng: Number(place.x),
    address: place.road_address_name || place.address_name || '',
    place_url: place.place_url,
  };
}

function categorySearchPage(tile, page) {
  return new Promise((resolve, reject) => {
    const kakao = window.kakao;
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
      // location 은 넘기지 않는다 — bounds 와 함께 쓰면 정렬에 영향을 줘 45개 상한 타일의 캐시 내용이
      // 요청 center 에 의존하게 되는데 캐시 키는 center 독립이라 오염 경로가 된다.
      // 거리는 어차피 병합 후 haversineMeters 로 직접 계산한다.
      { bounds, page }
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
  return collected.map(toCachedPlace);
}

let cacheGeneration = 0; // clearTileCache() 가 올린다. 수집 시작 시점의 값과 다르면 그 수집분은 저장하지 않는다.

async function runCollect(center, radius, config) {
  const generationAtStart = cacheGeneration;
  // snap:true = 절대 격자 정렬 — 기준점(회사 ↔ 내 위치)이 달라도 타일 경계가 같아야 캐시 키가 맞는다.
  // 반경 원과 안 겹치는 타일은 검색해도 filterByRadius 가 100% 버리므로 호출 전에 쳐낸다
  // (스냅으로 늘어난 모서리 타일도 여기서 상당수 걷힌다).
  const tiles = buildGridTiles(center, radius, TILE_SIZE_METERS, { snap: true }).filter(
    (tile) => !isTileOutsideRadius(tile, center, radius)
  );

  const cache = readJson(TILE_CACHE_KEY);
  const now = Date.now();
  const freshlyFetched = {};
  let searchCalls = 0;
  let cachedTiles = 0;
  let fetchedTiles = 0;

  // allSettled: 타일 1개가 SEARCH_FAILED 여도 이미 성공한 타일들(최대 3페이지×N회 호출)을 버리지 않는다.
  const settled = await Promise.allSettled(
    tiles.map(async (tile) => {
      const key = tileCacheKey(tile);
      if (isFreshTileCache(cache[key], now, TILE_CACHE_TTL_MS)) {
        cachedTiles += 1;
        return cache[key].places;
      }
      const places = await searchTile(tile, () => {
        searchCalls += 1;
      });
      fetchedTiles += 1;
      freshlyFetched[key] = { ts: now, places };
      return places;
    })
  );

  // 실패를 던지기 **전에** 성공분을 먼저 적재한다(재시도 때 같은 타일을 다시 쏘지 않도록).
  if (fetchedTiles > 0) {
    if (cacheGeneration !== generationAtStart) {
      // 수집 도중 사용자가 "이력·캐시 초기화"를 눌렀다 — 지운 걸 되살리지 않는다(다음 수집에서 다시 받는다).
      console.warn('[lunch] 수집 중 캐시 초기화가 있어 이번 수집분은 저장하지 않습니다.');
    } else {
      // read-modify-write: 시작 시 읽은 스냅샷에 덮어쓰면 겹쳐 돌던 다른 수집의 신규 타일이 지워진다.
      const latest = readJson(TILE_CACHE_KEY);
      // 이번 수집이 실제로 쓴 타일(캐시 히트분 포함)은 보호한다 — 한 번의 수집이 상한(120)을 넘는
      // 반경(예: 2700m → 172타일)에서 자기 수집분을 스스로 밀어내면 곧장 콜드 재요청이 난다.
      const usedKeys = tiles.map(tileCacheKey);
      writeJson(
        TILE_CACHE_KEY,
        evictOldestTiles({ ...latest, ...freshlyFetched }, TILE_CACHE_MAX_ENTRIES, usedKeys)
      );
    }
  }

  const failure = settled.find((outcome) => outcome.status === 'rejected');
  if (failure) throw failure.reason;
  const tileResults = settled.map((outcome) => outcome.value);

  const merged = mergeGridResults(tileResults);
  // 거리는 캐시에 담지 않고 지금 기준점에서 직접 계산한다(직선거리 근사 — 도로 거리 아님).
  const withDistance = merged.map((place) => ({
    ...place,
    distance: haversineMeters(center, { lat: place.lat, lng: place.lng }),
  }));
  const beforeCount = withDistance.length;
  const withinRadius = filterByRadius(withDistance, radius);
  const lunchOnly = filterLunchCandidates(withinRadius, {
    excludeCategoryKeywords: config.EXCLUDE_CATEGORY_KEYWORDS || [],
    excludePlaceIds: config.EXCLUDE_PLACE_IDS || [],
    includePlaceIds: config.INCLUDE_PLACE_IDS || [],
  });

  return {
    list: lunchOnly,
    before: beforeCount,
    after: lunchOnly.length,
    searchCalls, // 실제 네트워크 호출 수만 센다(캐시 히트는 0)
    cachedTiles,
    fetchedTiles,
  };
}

const inflight = new Map(); // `${lat},${lng},${radius}` -> Promise (탭1·탭3 동시 진입 시 중복 수집 방지)

/**
 * center 기준 radius 안의 점심 후보를 수집한다.
 * 타일 프루닝 → localStorage 타일 캐시(6시간) → 미스 타일만 categorySearch 순으로 호출을 아낀다.
 * 같은 (center, radius) 요청이 진행 중이면 그 프로미스를 그대로 돌려준다(in-flight dedupe).
 * @param {{lat: number, lng: number}} center 기준점(회사 또는 내 위치)
 * @param {number} radius 미터
 * @param {object} config window.LUNCH_CONFIG
 * @returns {Promise<{list: Array<object>, before: number, after: number, searchCalls: number, cachedTiles: number, fetchedTiles: number}>}
 */
export async function collectCandidates(center, radius, config) {
  // 키를 소수 5자리(≈1.1m)로 반올림한다 — 원시 부동소수로는 탭1(37.545013…)과 탭3(37.545010…)이
  // **같은 스냅 타일 집합**을 요구하는데도 dedupe 가 안 걸려 중복 수집이 난다.
  const key = `${center.lat.toFixed(5)},${center.lng.toFixed(5)},${radius}`;
  const running = inflight.get(key);
  if (running) return running;

  const task = runCollect(center, radius, config);
  inflight.set(key, task);
  try {
    return await task;
  } finally {
    inflight.delete(key);
  }
}

/**
 * 타일 캐시를 비운다(디버그·강제 재수집용). 저장 실패와 마찬가지로 삭제 실패도 흡수한다.
 * @returns {void}
 */
export function clearTileCache() {
  // 세대를 올려, 지금 진행 중인 수집이 완료 후 캐시를 다시 쓰는 것을 막는다.
  // (수집은 시작 시점에 캐시를 읽고 완료 후 write 하므로, 그 사이에 낀 초기화는 그냥 덮여버렸다 —
  //  사용자는 "지웠다"는 안내를 받고도 위치 기반 타일 키가 그대로 남았다.)
  cacheGeneration += 1;
  try {
    localStorage.removeItem(TILE_CACHE_KEY);
  } catch (err) {
    console.warn('[lunch] 타일 캐시 초기화 실패', err);
  }
}
