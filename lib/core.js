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
 * 절대 격자(buildGridTiles snap 모드)의 경도 스케일을 묶는 위도 대역 폭(도).
 * 경계를 도보 반경 밖으로 밀어내되(회사 lat 37.5451 기준 가장 가까운 경계 37.75 까지 약 22.8km)
 * cos 오차는 0.3% 이내로 유지하는 절충값이다 — 앵커 37.5 vs 대역 끝 37.75 는 cos 0.7934 vs 0.7912 = 0.28%,
 * 400m 타일에서 약 1.1m 차이라 무시할 수 있다.
 * 너무 작으면(예: 0.1) 경계가 도보 반경 안으로 들어와 몇백 미터만 움직여도 캐시가 통째로 무효화되고,
 * 너무 크면(예: 1.0) 위도 끝단(제주 33도 등)의 타일 폭 오차가 커진다.
 * 오라클/테스트가 경계 좌표를 하드코딩하지 않고 계산으로 도출할 수 있도록 export 한다.
 * @type {number}
 */
export const GRID_ANCHOR_DEG = 0.5;

/**
 * center를 감싸는 반경 radiusMeters의 bounding box를 tileSizeMeters 크기의 정사각 타일로 분할한다.
 * 등장방형(equirectangular) 근사: 위도 1도 ≈ 111320m, 경도 1도 ≈ 111320 * cos(lat) m.
 *
 * snap=true 면 격자를 center 상대가 아니라 **위도 0 · 경도 0 을 원점으로 하는 절대 격자**에 정렬한다.
 * 이유: center 상대 격자는 기준점이 1m만 움직여도 타일 경계가 통째로 어긋나 tileCacheKey 가 전부 달라진다
 * ("내 위치"는 GPS 오차로 클릭마다 좌표가 미세하게 흔들리므로 매번 전량 재검색 + 캐시만 부풀린다).
 * 이때 **두 가지 스케일을 반드시 분리**한다:
 *  - 원의 크기(radiusLat/radiusLng)는 언제나 **center 위도** 기준 — 앵커 위도로 재면 앵커보다 북쪽 center 에서
 *    bbox 가 안쪽으로 줄어 반경 안인데 어떤 타일에도 안 들어가는 지점이 생긴다(실측 반례: center
 *    lat 37.74457997 의 정동 800m 지점이 스냅 bbox 동단보다 2.4m 바깥이라 커버리지 구멍이었다).
 *  - 타일 폭(격자 정렬)만 **앵커 위도** 기준 — 그래야 같은 대역의 어떤 center 든 타일 경계가 일치해 캐시가 맞는다.
 * 여기에 스냅 전 bbox 에 **타일 1칸 여유**를 더해 남은 근사 오차(등장방형↔하버사인, 앵커 스케일 차이)를 흡수한다.
 * 결과적으로 bbox 는 center 상대 격자보다 항상 넓거나 같아 반경 내부 커버리지가 줄지 않는다.
 * 늘어난 바깥 타일은 원과 겹치지 않으므로 호출부의 isTileOutsideRadius 프루닝이 대부분 그대로 걷어낸다
 * (프루닝을 적용하는 호출부에서는 실질 타일 수가 거의 늘지 않는다).
 * 기본값 false 는 기존 동작을 바이트 단위로 보존한다 — 오라클 D8 이 검증하는 것은 이 기본 경로다.
 *
 * @param {{lat: number, lng: number}} center
 * @param {number} radiusMeters
 * @param {number} [tileSizeMeters]
 * @param {{snap?: boolean}} [opts] snap=true면 절대 격자 정렬(기준점이 달라도 캐시 키가 일치)
 * @returns {Array<{swLat: number, swLng: number, neLat: number, neLng: number}>}
 */
export function buildGridTiles(center, radiusMeters, tileSizeMeters = 400, { snap = false } = {}) {
  const METERS_PER_DEG_LAT = 111320;
  const metersPerDegLngCenter = METERS_PER_DEG_LAT * Math.cos((center.lat * Math.PI) / 180);
  // 격자 정렬 스케일: snap 이면 앵커 위도(대역 안에서 타일 경계 공유), 아니면 center 위도(기존 동작 그대로).
  const anchorLat = Math.round(center.lat / GRID_ANCHOR_DEG) * GRID_ANCHOR_DEG;
  const metersPerDegLngGrid = snap
    ? METERS_PER_DEG_LAT * Math.cos((anchorLat * Math.PI) / 180)
    : metersPerDegLngCenter;

  const tileSizeLat = tileSizeMeters / METERS_PER_DEG_LAT;
  const tileSizeLng = tileSizeMeters / metersPerDegLngGrid;

  // 원의 크기는 언제나 center 위도 기준(앵커 스케일로 재면 bbox 가 안쪽으로 줄어 커버리지가 샌다).
  const radiusLat = radiusMeters / METERS_PER_DEG_LAT;
  const radiusLng = radiusMeters / metersPerDegLngCenter;

  // 스냅 전 여유: 타일 1칸. 남은 근사 오차를 흡수하며, 늘어난 바깥 타일은 프루닝이 걷어낸다.
  const marginLat = snap ? tileSizeLat : 0;
  const marginLng = snap ? tileSizeLng : 0;

  // snap=true: 절대 격자 경계로 바깥쪽 반올림(floor/ceil) → 같은 앵커 대역의 어떤 center든 동일한 타일 경계.
  const south = snap
    ? Math.floor((center.lat - radiusLat - marginLat) / tileSizeLat) * tileSizeLat
    : center.lat - radiusLat;
  const north = snap
    ? Math.ceil((center.lat + radiusLat + marginLat) / tileSizeLat) * tileSizeLat
    : center.lat + radiusLat;
  const west = snap
    ? Math.floor((center.lng - radiusLng - marginLng) / tileSizeLng) * tileSizeLng
    : center.lng - radiusLng;
  const east = snap
    ? Math.ceil((center.lng + radiusLng + marginLng) / tileSizeLng) * tileSizeLng
    : center.lng + radiusLng;

  // 스냅된 범위는 타일 크기의 정수배라 Math.round 로 부동소수 잔차(1e-15)를 흡수한다
  // (Math.ceil 이면 잔차 때문에 여분의 행/열이 하나 더 생긴다).
  const roundUp = snap ? Math.round : Math.ceil;
  const cols = Math.max(1, roundUp((east - west) / tileSizeLng));
  const rows = Math.max(1, roundUp((north - south) / tileSizeLat));

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

/**
 * 응답(raw)에 "메뉴 항목처럼 생긴 행"이 최소 1개 있는지 판정한다. 순수함수.
 * **CI 크롤러 전용**(scripts/fetch-moremore.mjs) — 브라우저 코드에서는 쓰지 않는다.
 *
 * 게이트가 이 한 가지 판정으로 축소된 근거: 워크플로 커밋 스텝의
 * `git diff --staged --quiet` 가 **이미** 바이트 동일한 재수집을 커밋하지 않는다.
 * 따라서 "하루 1커밋"을 위해 스크립트가 따로 판정할 필요가 없고, 스케줄 다중화
 * (KST 평일 9슬롯) 상황에서 스크립트가 실제로 지켜야 할 불변식은 하나뿐이다 —
 * **있는 데이터를 빈/깨진 응답으로 되돌리지 않는다.** 기존 파일 내용이나 오늘 날짜를
 * 볼 필요가 없으므로 인자에서 뺐다(예전 시그니처는 부분 게시 — 1코너만 받은 이른 슬롯을
 * 뒤 슬롯의 5코너 확정 메뉴로 갱신하지 못하는 퇴행이 있었다).
 *
 * 항목 판정 기준은 parseMoremoreResponse 와 동일하다(배열 행 + row[1]이 비어있지 않은 문자열).
 * `{"data":["error"]}` 처럼 non-empty 지만 원소 스키마가 깨진 응답도 여기서 걸린다.
 * @param {{data: any[]}|null|undefined} raw API 원본 응답
 * @returns {boolean} true면 저장 가능한 항목이 있음, false면 빈/이상 응답
 */
export function hasMoremoreItems(raw) {
  if (!raw || typeof raw !== 'object') return false;
  const data = raw.data;
  if (!Array.isArray(data) || data.length === 0) return false;
  return data.some((row) => Array.isArray(row) && typeof row[1] === 'string' && row[1].length > 0);
}

/**
 * 두 좌표 사이 직선거리(m). 하버사인(구면 근사, R=6371000m).
 * Kakao place.distance(요청 좌표 기준 직선거리)와 동등한 근사이며, 도로 거리가 아니다("근사" 정직 표기).
 * lat/lng가 숫자가 아니면 NaN을 반환한다 — 임의 좌표로 대체하지 않는다(창작 금지).
 * @param {{lat: number, lng: number}} a
 * @param {{lat: number, lng: number}} b
 * @returns {number} 미터
 */
export function haversineMeters(a, b) {
  const EARTH_RADIUS_M = 6371000;
  const toRad = (deg) => (deg * Math.PI) / 180;
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) * Math.sin(dLat / 2) +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Geolocation position 객체를 {lat, lng}로 정규화한다. 절대 throw하지 않는다.
 * coords.latitude/longitude가 유한수이고 위도 [-90,90] · 경도 [-180,180] 범위일 때만 좌표를 만든다.
 * 그 외에는 전부 null — 값이 없으면 없는 대로 알리고 임의 좌표를 지어내지 않는다(창작 금지/D9).
 * accuracy(측위 반경 m)도 함께 돌려준다 — 데스크톱 WiFi/IP 측위는 ±20km 도 나오는데 이를 숨기고
 * "내 위치"라고 단정하면 정직 표기 위반이라, 호출부가 경고를 띄울 수 있게 값을 그대로 전달한다.
 * 값이 없거나 유한수가 아니면 accuracy 는 null(추정치를 지어내지 않는다).
 * @param {{coords?: {latitude?: number, longitude?: number, accuracy?: number}}|null|undefined} position
 * @returns {{lat: number, lng: number, accuracy: number|null}|null}
 */
export function normalizeGeoPosition(position) {
  const coords = position && position.coords;
  if (!coords) return null;
  const lat = coords.latitude;
  const lng = coords.longitude;
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  // accuracy 는 '반경 몇 m 이내'라는 오차 반경이라 음수는 물리적으로 성립하지 않는다.
  // 음수를 그대로 두면 저정확도 경고 비교(accuracy > radius)를 항상 통과해 '매우 정확함'으로
  // 둔갑하므로, 근거 없는 값은 값이 없는 것으로 처리한다(창작 금지).
  const accuracy =
    Number.isFinite(coords.accuracy) && coords.accuracy >= 0 ? coords.accuracy : null;
  return { lat, lng, accuracy };
}

/**
 * GeolocationPositionError.code를 한국어 안내 문구로 바꾼다. 절대 throw하지 않는다.
 * 알 수 없는 코드·undefined도 기본 문구를 반환한다(위치를 못 얻어도 회사 기준 추천은 계속 동작한다).
 * @param {number|undefined} code 1=PERMISSION_DENIED, 2=POSITION_UNAVAILABLE, 3=TIMEOUT
 * @returns {string}
 */
export function describeGeolocationError(code) {
  if (code === 1) {
    return '위치 권한이 거부되었습니다. 브라우저 주소창의 위치 아이콘에서 권한을 허용해주세요. 회사 기준 추천을 유지합니다.';
  }
  if (code === 2) {
    return '현재 위치를 확인할 수 없습니다. 회사 기준 추천을 유지합니다.';
  }
  if (code === 3) {
    return '위치 확인이 시간 내에 끝나지 않았습니다. 회사 기준 추천을 유지합니다.';
  }
  return '위치 정보를 가져오지 못했습니다. 회사 기준 추천을 유지합니다.';
}

/**
 * 추천 기준점 라벨. 도움말·상태 문구가 실제 기준점과 어긋나지 않도록 한 곳에서 만든다(정직 표기).
 * @param {'company'|'geo'} mode
 * @param {string} companyAddress
 * @returns {string} mode==='geo' → '내 위치', 그 외 → `회사(${companyAddress})`
 */
export function originLabel(mode, companyAddress) {
  if (mode === 'geo') return '내 위치';
  return `회사(${companyAddress})`;
}

/**
 * 프루닝 판정에 쓰는 보수적 안전 마진(m). 이 값만큼은 "겹칠 수도 있다"고 보고 타일을 남긴다.
 * 축별 clamp 로 구한 최근접점은 위·아래 변(위도 고정)에서 실제 대권 최근접점과 미세하게 다를 수 있어
 * (거리식의 cos(lat2) 항 때문에 |Δlat| 에 대해 완전 단조가 아니다) 부동소수 여유까지 함께 흡수한다.
 * 마진은 **덜 프루닝하는 방향으로만** 작용한다 — 후보를 잃느니 타일 몇 개를 더 검색하는 편이 낫다.
 */
const PRUNE_SAFETY_MARGIN_METERS = 2;

/**
 * 타일이 center 반경 radiusMeters 원과 전혀 겹치지 않으면 true(= 검색해도 filterByRadius 가 100% 버린다).
 * 타일 사각형에서 center 에 가장 가까운 점을 축별 clamp 로 구한 뒤 **haversineMeters** 로 거리를 잰다 —
 * 최종 반경 필터(filterByRadius)가 쓰는 거리 함수와 동일해야 프루닝이 반경 안 후보를 삼키지 않는다.
 * (등장방형 근사로 재던 이전 구현은 두 근사의 0.3% 차이 때문에 최근접점 haversine 799.70m 인 타일을
 * 반경 800m 밖으로 오판해 버리는 반례가 있었다.)
 * 안전성 근거: 가장 가까운 점조차 반경 + 마진 밖이면 그 타일 안의 어떤 지점도 반경 안에 들어올 수 없다.
 * @param {{swLat: number, swLng: number, neLat: number, neLng: number}} tile
 * @param {{lat: number, lng: number}} center
 * @param {number} radiusMeters
 * @returns {boolean}
 */
export function isTileOutsideRadius(tile, center, radiusMeters) {
  const nearest = {
    lat: Math.min(Math.max(center.lat, tile.swLat), tile.neLat),
    lng: Math.min(Math.max(center.lng, tile.swLng), tile.neLng),
  };
  return haversineMeters(center, nearest) > radiusMeters + PRUNE_SAFETY_MARGIN_METERS;
}

/**
 * 타일 캐시 키. 부동소수 흔들림(같은 타일이 미세하게 다른 값으로 재계산되는 것)을 막으려 소수 5자리로 고정한다.
 * 소수 5자리 ≈ 1.1m 해상도 — 400m 타일을 구분하기에 충분하다.
 * @param {{swLat: number, swLng: number, neLat: number, neLng: number}} tile
 * @returns {string}
 */
export function tileCacheKey(tile) {
  return `${tile.swLat.toFixed(5)},${tile.swLng.toFixed(5)},${tile.neLat.toFixed(5)},${tile.neLng.toFixed(5)}`;
}

/**
 * 캐시 엔트리가 now 기준 유효한지 판정한다. 순수함수(시각은 인자로 주입).
 * entry는 {ts: number, places: Array} 형태여야 하며, 형식 이상·TTL 초과·미래 ts(시계 뒤틀림)면 false.
 * places가 빈 배열인 것은 정상이다 — 결과 0건 타일도 캐시 대상이다(재검색 절감 효과가 가장 큰 쪽).
 * @param {{ts: number, places: any[]}|undefined|null} entry
 * @param {number} nowMs
 * @param {number} ttlMs
 * @returns {boolean}
 */
export function isFreshTileCache(entry, nowMs, ttlMs) {
  if (!entry || typeof entry !== 'object') return false;
  if (!Number.isFinite(entry.ts) || !Array.isArray(entry.places)) return false;
  const age = nowMs - entry.ts;
  return age >= 0 && age <= ttlMs;
}

/**
 * 엔트리 수가 maxEntries를 넘으면 오래된(ts 작은) 것부터 제거한 새 객체를 반환한다(원본 불변).
 * cacheMap은 localStorage에 그대로 직렬화되는 평범한 객체({key: {ts, places}}) 형태다.
 * ts가 숫자가 아닌 엔트리는 가장 오래된 것으로 보고 먼저 버린다.
 * ts가 동률이면 **나중에 들어온 키(객체 삽입 순서상 뒤)** 를 남긴다 — 같은 ms 에 쓰인 방금 수집분이
 * sort 안정성 때문에 밀려나는 일이 없어야 한다.
 * protectedKeys에 든 키는 상한과 무관하게 항상 보존한다 — 이번 수집이 실제로 쓴 타일이 그 자리에서
 * 축출되면(반경 확대로 한 번에 172타일을 받는 경우처럼) 곧바로 같은 타일을 다시 요청하게 돼
 * 캐시의 목적 자체가 뒤집힌다. 보호 대상이 상한보다 많으면 상한이 아니라 보호 집합이 이긴다.
 * @param {Record<string, {ts: number}>} cacheMap
 * @param {number} maxEntries
 * @param {string[]} [protectedKeys] 이번 수집이 사용한 키(선택 — 미지정 시 종전 동작 그대로)
 * @returns {Record<string, {ts: number}>} 새 객체
 */
export function evictOldestTiles(cacheMap, maxEntries, protectedKeys = []) {
  const source = cacheMap && typeof cacheMap === 'object' ? cacheMap : {};
  const keys = Object.keys(source);
  const protectedSet = new Set(
    (protectedKeys || []).filter((key) => Object.prototype.hasOwnProperty.call(source, key))
  );
  if (maxEntries <= 0 && protectedSet.size === 0) return {};
  if (keys.length <= maxEntries) {
    const copy = {};
    for (const key of keys) copy[key] = source[key];
    return copy;
  }

  const tsOf = (key) => {
    const entry = source[key];
    return entry && Number.isFinite(entry.ts) ? entry.ts : -Infinity;
  };
  const orderOf = new Map(keys.map((key, index) => [key, index]));
  const evictable = keys.filter((key) => !protectedSet.has(key));
  const slots = Math.max(0, maxEntries - protectedSet.size);
  const keptEvictable = new Set(
    evictable
      .slice()
      .sort((a, b) => tsOf(b) - tsOf(a) || orderOf.get(b) - orderOf.get(a))
      .slice(0, slots)
  );

  const result = {};
  // 원본 삽입 순서를 유지해 결과가 결정적이도록 한다(직렬화 diff 안정성).
  for (const key of keys) {
    if (protectedSet.has(key) || keptEvictable.has(key)) result[key] = source[key];
  }
  return result;
}
