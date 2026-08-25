// lib/core.js — 점심 추천 순수 로직 (ES 모듈)
//
// DOM · Kakao Maps SDK · localStorage 의존 절대 금지.
// Node(검증 스크립트)와 브라우저(app.js) 양쪽에서 동일하게 import 가능해야 한다.
// 함수 시그니처(이름 · 인자 순서 · 반환 형태)는 docs/plan.md 를 그대로 따른다 — 임의 변경 금지.

/**
 * id 기준 중복 제거. 먼저 나온 것을 유지한다.
 * @param {Array<{id: string}>} candidates
 * @returns {Array<object>} 새 배열
 */
export function dedupeById(candidates) {
  const seen = new Set();
  const result = [];
  for (const item of candidates) {
    if (!seen.has(item.id)) {
      seen.add(item.id);
      result.push(item);
    }
  }
  return result;
}

/**
 * item.distance <= radius 인 것만 남긴다. distance는 미터(숫자).
 * @param {Array<{distance: number}>} candidates
 * @param {number} radius
 * @returns {Array<object>}
 */
export function filterByRadius(candidates, radius) {
  return candidates.filter((item) => item.distance <= radius);
}

/**
 * categoryName에 excludeCategoryKeywords 중 하나라도 부분 포함되면 true.
 * @param {string} categoryName
 * @param {string[]} excludeCategoryKeywords
 * @returns {boolean}
 */
export function isNightOnlyCategory(categoryName, excludeCategoryKeywords) {
  if (!categoryName) return false;
  return excludeCategoryKeywords.some((keyword) => categoryName.includes(keyword));
}

/**
 * 점심 후보 필터: includePlaceIds(강제포함) > excludePlaceIds(수동제외) > 야간전용업종(제외) 순으로 판정.
 * @param {Array<{id: string, category_name?: string}>} candidates
 * @param {{excludeCategoryKeywords?: string[], excludePlaceIds?: string[], includePlaceIds?: string[]}} [opts]
 * @returns {Array<object>}
 */
export function filterLunchCandidates(
  candidates,
  { excludeCategoryKeywords = [], excludePlaceIds = [], includePlaceIds = [] } = {}
) {
  return candidates.filter((item) => {
    if (includePlaceIds.includes(item.id)) return true;
    if (excludePlaceIds.includes(item.id)) return false;
    if (isNightOnlyCategory(item.category_name, excludeCategoryKeywords)) return false;
    return true;
  });
}

/**
 * category_name(예: "음식점 > 한식 > 국밥")에서 대표 메뉴 힌트를 도출한다.
 * - 리프가 categoryMenuHints의 key와 정확히 일치 → 매핑값을 '/'로 join.
 * - 아니면 리프 자체(쉼표는 '/'로 치환)를 그대로 사용(리프가 이미 메뉴성인 경우).
 * - categoryName이 비어 세그먼트가 없으면 null(창작 금지 — 없는 메뉴명을 지어내지 않는다).
 * @param {string} categoryName
 * @param {Record<string, string[])>} [categoryMenuHints]
 * @returns {string|null}
 */
export function deriveMenuHint(categoryName, categoryMenuHints = {}) {
  if (!categoryName) return null;
  const segments = categoryName
    .split('>')
    .map((segment) => segment.trim())
    .filter((segment) => segment.length > 0);
  if (segments.length === 0) return null;
  const leaf = segments[segments.length - 1];
  if (Object.prototype.hasOwnProperty.call(categoryMenuHints, leaf)) {
    return categoryMenuHints[leaf].join('/');
  }
  return leaf.split(',').join('/');
}

/**
 * list에서 rng()로 인덱스를 뽑아 해당 원소를 반환한다. list가 비어있으면 undefined.
 * @param {Array<any>} list
 * @param {() => number} [rng] 기본 Math.random. 검증 시 고정 시드 PRNG 주입.
 * @returns {any}
 */
export function pickRandom(list, rng = Math.random) {
  if (!list || list.length === 0) return undefined;
  const idx = Math.floor(rng() * list.length);
  return list[idx];
}

/**
 * pickedId를 맨 앞에 push하고, 기존 동일 id는 제거(dedupe)한 뒤 limit으로 truncate한 새 배열을 반환.
 * @param {string[]} recentIds
 * @param {string} pickedId
 * @param {number} limit
 * @returns {string[]}
 */
export function updateRecent(recentIds, pickedId, limit) {
  const withoutPicked = recentIds.filter((id) => id !== pickedId);
  const updated = [pickedId, ...withoutPicked];
  return updated.slice(0, limit);
}

/**
 * 랜덤 + 최근 안 겹치게 추천 선택.
 * 후보 0이면 절대 throw하지 않고 { picked: null, recentIds, cycled: false } 반환(크래시 없는 후보0 처리).
 * @param {Array<{id: string}>} candidates
 * @param {string[]} recentIds
 * @param {() => number} rng
 * @param {number} recentLimit
 * @param {{excludeRecent?: boolean}} [opts]
 * @returns {{picked: object|null, recentIds: string[], cycled: boolean}}
 */
export function selectRecommendation(
  candidates,
  recentIds,
  rng,
  recentLimit,
  { excludeRecent = true } = {}
) {
  if (!candidates || candidates.length === 0) {
    return { picked: null, recentIds, cycled: false };
  }

  if (!excludeRecent) {
    // 분포 검증용: 이력을 건드리지 않고 candidates 전체에서 뽑는다.
    const picked = pickRandom(candidates, rng);
    return { picked, recentIds, cycled: false };
  }

  let cycled = false;
  let workingRecentIds = recentIds.slice();
  let available = candidates.filter((c) => !workingRecentIds.includes(c.id));

  // 이력으로 후보가 모두 소진되면 가장 오래된 것(배열 끝)부터 하나씩 제거하며 재계산(순환).
  while (available.length === 0 && workingRecentIds.length > 0) {
    workingRecentIds = workingRecentIds.slice(0, -1);
    cycled = true;
    available = candidates.filter((c) => !workingRecentIds.includes(c.id));
  }

  const picked = pickRandom(available, rng);
  const newRecentIds = updateRecent(recentIds, picked.id, recentLimit);
  return { picked, recentIds: newRecentIds, cycled };
}

/**
 * center를 감싸는 반경 radiusMeters의 bounding box를 tileSizeMeters 크기의 정사각 타일로 분할한다.
 * 등장방형(equirectangular) 근사: 위도 1도 ≈ 111320m, 경도 1도 ≈ 111320 * cos(lat) m.
 * @param {{lat: number, lng: number}} center
 * @param {number} radiusMeters
 * @param {number} [tileSizeMeters]
 * @returns {Array<{swLat: number, swLng: number, neLat: number, neLng: number}>}
 */
export function buildGridTiles(center, radiusMeters, tileSizeMeters = 400) {
  const METERS_PER_DEG_LAT = 111320;
  const latRad = (center.lat * Math.PI) / 180;
  const metersPerDegLng = METERS_PER_DEG_LAT * Math.cos(latRad);

  const tileSizeLat = tileSizeMeters / METERS_PER_DEG_LAT;
  const tileSizeLng = tileSizeMeters / metersPerDegLng;

  const radiusLat = radiusMeters / METERS_PER_DEG_LAT;
  const radiusLng = radiusMeters / metersPerDegLng;

  const south = center.lat - radiusLat;
  const north = center.lat + radiusLat;
  const west = center.lng - radiusLng;
  const east = center.lng + radiusLng;

  const cols = Math.max(1, Math.ceil((east - west) / tileSizeLng));
  const rows = Math.max(1, Math.ceil((north - south) / tileSizeLat));

  const tiles = [];
  for (let r = 0; r < rows; r++) {
    const swLat = south + r * tileSizeLat;
    const neLat = swLat + tileSizeLat;
    for (let c = 0; c < cols; c++) {
      const swLng = west + c * tileSizeLng;
      const neLng = swLng + tileSizeLng;
      tiles.push({ swLat, swLng, neLat, neLng });
    }
  }
  return tiles;
}

/**
 * Kakao pagination 메타가 45개 상한 절단 의심 패턴(count===45 && isEnd===false)인지 판정.
 * @param {{count: number, isEnd: boolean}} pageMeta
 * @returns {boolean}
 */
export function isPageTruncated(pageMeta) {
  return pageMeta.count === 45 && pageMeta.isEnd === false;
}

/**
 * 타일별 결과 배열의 배열을 평탄화한 뒤 dedupeById.
 * @param {Array<Array<{id: string}>>} tileResults
 * @returns {Array<object>}
 */
export function mergeGridResults(tileResults) {
  const flat = tileResults.reduce((acc, arr) => acc.concat(arr), []);
  return dedupeById(flat);
}

/**
 * 주소를 좌표로 변환한다. geocoderFn(address, callback) 형태 (kakao Geocoder.addressSearch와 동일 시그니처).
 * status==='OK' && resultList[0] 있으면 resolve({lat, lng}). 그 외에는 절대 임의 좌표를 만들지 않고 reject(창작 금지/D9).
 * @param {string} address
 * @param {(address: string, callback: (resultList: any[], status: string) => void) => void} geocoderFn
 * @returns {Promise<{lat: number, lng: number}>}
 */
export function geocodeAddress(address, geocoderFn) {
  return new Promise((resolve, reject) => {
    geocoderFn(address, (resultList, status) => {
      if (status === 'OK' && resultList && resultList[0]) {
        resolve({ lat: Number(resultList[0].y), lng: Number(resultList[0].x) });
      } else {
        reject(new Error('GEOCODE_FAILED'));
      }
    });
  });
}
