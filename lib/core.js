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

/**
 * 모락모락 API 응답을 파싱한다. 절대 throw하지 않는다.
 * raw: 무엇이든 올 수 있음(null/undefined/{data:...} 아님/data가 배열아님/원소형식이상 등) — 전부 흡수.
 * 사용 인덱스: 1=메뉴명(한글,nameKo) 2=kcal(문자열,"0"·파싱불가→null) 3=이미지baseURL(없으면null)
 * 4=이미지파일명(없으면null, 실URL=index3+index4) 5=사이드메뉴(" / "split,null이면[]) 6=코너명(corner)
 * 12=영문명(nameEn,null가능). nameKo가 빈 문자열인 원소는 제외.
 * @param {*} raw
 * @returns {{ready: boolean, items: Array<{corner:string,nameKo:string,nameEn:string|null,kcal:number|null,imageUrl:string|null,sides:string[]}>}}
 * ready = items.length > 0.
 */
export function parseMoremoreResponse(raw) {
  try {
    if (!raw || typeof raw !== 'object') return { ready: false, items: [] };
    const data = raw.data;
    if (!Array.isArray(data)) return { ready: false, items: [] };

    const items = [];
    for (const row of data) {
      if (!Array.isArray(row)) continue;

      const nameKo = row[1];
      if (typeof nameKo !== 'string' || nameKo.length === 0) continue;

      let kcal = null;
      const kcalRaw = row[2];
      if (typeof kcalRaw === 'string' || typeof kcalRaw === 'number') {
        const parsed = Number(String(kcalRaw).replace(/,/g, ''));
        if (Number.isFinite(parsed) && parsed !== 0) kcal = parsed;
      }

      const imgBase = row[3];
      const imgFile = row[4];
      const imageUrl =
        typeof imgBase === 'string' && imgBase && typeof imgFile === 'string' && imgFile
          ? imgBase + imgFile
          : null;

      const sidesRaw = row[5];
      const sides = typeof sidesRaw === 'string' && sidesRaw.length > 0 ? sidesRaw.split(' / ') : [];

      const corner = typeof row[6] === 'string' ? row[6] : '';
      const nameEn = typeof row[12] === 'string' ? row[12] : null;

      items.push({ corner, nameKo, nameEn, kcal, imageUrl, sides });
    }

    return { ready: items.length > 0, items };
  } catch (err) {
    return { ready: false, items: [] };
  }
}

/**
 * 월드컵 참가 풀 구성. 순수함수.
 * candidates: lib/core.js의 다른 함수들이 다루는 candidate 형태({id,name,category_name,distance,lat,lng,address,place_url,...}).
 * categoryMenuHints: config.js의 CATEGORY_MENU_HINTS와 동일 형태(deriveMenuHint 2번째 인자).
 * 각 candidate에 deriveMenuHint(candidate.category_name, categoryMenuHints)로 힌트 도출, 힌트가 null이 아닌 것만 유효.
 * id 기준 중복 없이(한 식당당 항목 1개) rng로 비복원 추출.
 * @param {Array<object>} candidates
 * @param {Record<string, string[]>} categoryMenuHints
 * @param {number} size
 * @param {() => number} [rng] 기본 Math.random. 검증 시 고정 시드 PRNG 주입.
 * @returns {{pool: Array<{place: object, menuText: string}>, sufficient: boolean}}
 * sufficient = 유효후보수 >= size. false면 pool은 유효후보 전체(그 이하로 지어내지 않음).
 */
export function buildWorldcupPool(candidates, categoryMenuHints, size, rng = Math.random) {
  const seen = new Set();
  const valid = [];
  for (const place of candidates || []) {
    if (!place || !place.id || seen.has(place.id)) continue;
    const menuText = deriveMenuHint(place.category_name, categoryMenuHints);
    if (menuText === null) continue;
    seen.add(place.id);
    valid.push({ place, menuText });
  }

  const sufficient = valid.length >= size;
  if (!sufficient) {
    return { pool: valid, sufficient: false };
  }

  // 비복원 추출: Fisher-Yates 셔플 후 앞 size개(주입 가능 rng 사용).
  const shuffled = valid.slice();
  for (let i = shuffled.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    const tmp = shuffled[i];
    shuffled[i] = shuffled[j];
    shuffled[j] = tmp;
  }
  return { pool: shuffled.slice(0, size), sufficient: true };
}

/**
 * 참가자 배열을 순서대로 순차 페어링한다. (0,1)→match0, (2,3)→match1 ...
 * 홀수면 마지막 하나는 매치에 포함하지 않고 console.warn 한 줄 남긴다(typeof console !== 'undefined' 가드).
 * @param {Array<any>} participants
 * @returns {Array<{a:any, b:any}>}
 */
export function pairMatches(participants) {
  const list = participants || [];
  const matches = [];
  const pairCount = Math.floor(list.length / 2);
  for (let i = 0; i < pairCount; i++) {
    matches.push({ a: list[i * 2], b: list[i * 2 + 1] });
  }
  if (list.length % 2 !== 0 && typeof console !== 'undefined') {
    console.warn('[lunch] pairMatches: 참가자 수가 홀수라 마지막 1명은 이번 매치에 포함되지 않습니다.');
  }
  return matches;
}

/**
 * matches와 winnerSides(각 원소 0|1, 0=a승 1=b승)를 받아 승자만 담긴 다음 라운드 참가자 배열을 반환.
 * @param {Array<{a:any, b:any}>} matches
 * @param {Array<0|1>} winnerSides
 * @returns {Array<any>} 길이 = matches.length
 */
export function nextRoundParticipants(matches, winnerSides) {
  return matches.map((match, idx) => (winnerSides[idx] === 0 ? match.a : match.b));
}

/**
 * fetchedDate(데이터가 수집된 날짜)와 todayDate(오늘 날짜)가 같은지 판정한다. 둘 다 "YYYYMMDD" 문자열.
 * 날짜가 다르면 데이터가 있어도 "오늘 메뉴"로 표시하지 않는다(창작 금지 — plan.md 4경로 통합).
 * @param {string} fetchedDate
 * @param {string} todayDate
 * @returns {boolean}
 */
export function isFreshMoremoreData(fetchedDate, todayDate) {
  return typeof fetchedDate === 'string' && typeof todayDate === 'string' && fetchedDate.length === 8 && fetchedDate === todayDate;
}
