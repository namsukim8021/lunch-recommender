// oracle-check.mjs
// ─────────────────────────────────────────────────────────────────────────
// 목적: docs/oracle.md 의 도메인 오라클 D1~D16 을 자동으로 점검한다.
// "사람 눈 판정 금지" 원칙(oracle.md §2, .claude/skills/sdd-cycle)의 구현체 —
// 시나리오(AC)로 정의되지 않은 입력·경로에서도 항상 성립해야 하는 불변식을
// 모의(mock) 픽스처 + 고정 시드 PRNG로 기계적으로 검증한다.
// Node 내장 모듈만 사용(외부 의존성 0개). 실행: node scripts/oracle-check.mjs
// ─────────────────────────────────────────────────────────────────────────

import assert from 'node:assert';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import path from 'node:path';

import {
  dedupeById,
  filterByRadius,
  isNightOnlyCategory,
  filterLunchCandidates,
  deriveMenuHint,
  pickRandom,
  updateRecent,
  selectRecommendation,
  buildGridTiles,
  isPageTruncated,
  mergeGridResults,
  geocodeAddress,
  parseMoremoreResponse,
  isFreshMoremoreData,
  hasMoremoreItems,
  buildWorldcupPool,
  pairMatches,
  nextRoundParticipants,
  haversineMeters,
  normalizeGeoPosition,
  describeGeolocationError,
  originLabel,
  isTileOutsideRadius,
  tileCacheKey,
  isFreshTileCache,
  evictOldestTiles,
  GRID_ANCHOR_DEG,
} from '../lib/core.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');

// ── 결정론적 PRNG (mulberry32) ──────────────────────────────────────────
// 시드는 박제(고정). oracle.md: "시드마다 통과/실패가 흔들리는 것을 막기 위함".
const FIXED_SEED = 0x9e3779b9;

function mulberry32(seed) {
  let a = seed | 0;
  return function () {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

// ── 결과 수집 ────────────────────────────────────────────────────────────
const results = [];
function record(id, name, status, detail) {
  results.push({ id, name, status, detail });
}

// 개별 검사를 실행하고 예외를 FAIL 로 흡수하는 러너(다른 검사에 영향 안 주도록 격리)
async function runCheck(id, name, fn) {
  try {
    const { status, detail } = await fn();
    record(id, name, status, detail);
  } catch (err) {
    record(id, name, 'FAIL', `예외 발생: ${err && err.message ? err.message : String(err)}`);
  }
}

// ─────────────────────────────────────────────────────────────────────────
// D1: 추천 식당은 항상 distance <= RADIUS
// ─────────────────────────────────────────────────────────────────────────
await runCheck('D1', 'filterByRadius: 반경 밖 후보가 결과에 없다', async () => {
  const RADIUS = 1000;
  const candidates = [
    { id: 'p1', place_name: '식당A', category_name: '음식점 > 한식 > 국밥', distance: 500 },
    { id: 'p2', place_name: '식당B', category_name: '음식점 > 한식 > 백반', distance: 1000 },
    { id: 'p3', place_name: '식당C', category_name: '음식점 > 한식 > 찌개', distance: 1001 },
    { id: 'p4', place_name: '식당D', category_name: '음식점 > 중식 > 짜장면', distance: 2000 },
    { id: 'p5', place_name: '식당E', category_name: '음식점 > 일식 > 초밥', distance: 0 },
  ];
  const out = filterByRadius(candidates, RADIUS);
  const overRadius = out.filter((c) => c.distance > RADIUS);
  assert.strictEqual(overRadius.length, 0, `반경 초과 후보가 ${overRadius.length}개 포함됨`);
  // 반경 이내 후보(p1,p2,p5)는 반드시 살아남아야 함(과도 필터링 방지)
  const keptIds = out.map((c) => c.id).sort();
  assert.deepStrictEqual(keptIds, ['p1', 'p2', 'p5']);
  return { status: 'PASS', detail: `반경 밖 후보 0개 확인 (in=${candidates.length}, out=${out.length})` };
});

// ─────────────────────────────────────────────────────────────────────────
// D2: 야간 전용 업종 제외 (+ includePlaceIds 강제 포함)
// ─────────────────────────────────────────────────────────────────────────
const EXCLUDE_CATEGORY_KEYWORDS = ['술집', '호프', '바(BAR)', '포장마차', '요리주점', '이자카야', '야식'];

await runCheck('D2', 'filterLunchCandidates: 야간 전용 업종이 결과에 하나도 없다', async () => {
  const candidates = [
    { id: 'n1', place_name: '호프집', category_name: '음식점 > 유흥주점 > 호프,요리주점' },
    { id: 'n2', place_name: '이자카야', category_name: '음식점 > 술집 > 이자카야' },
    { id: 'n3', place_name: '포차', category_name: '음식점 > 포장마차' },
    { id: 'n4', place_name: '야식집', category_name: '음식점 > 야식' },
    { id: 'd1', place_name: '국밥집', category_name: '음식점 > 한식 > 국밥' },
    { id: 'd2', place_name: '파스타집', category_name: '음식점 > 양식 > 파스타' },
  ];
  const out = filterLunchCandidates(candidates, { excludeCategoryKeywords: EXCLUDE_CATEGORY_KEYWORDS });
  const nightSurvivors = out.filter((c) => isNightOnlyCategory(c.category_name, EXCLUDE_CATEGORY_KEYWORDS));
  assert.strictEqual(nightSurvivors.length, 0, `야간 업종 ${nightSurvivors.length}개 생존`);
  const outIds = out.map((c) => c.id).sort();
  assert.deepStrictEqual(outIds, ['d1', 'd2']);
  return { status: 'PASS', detail: `야간 업종 후보 4개 전부 제외 확인, 정상 후보 2개 생존` };
});

await runCheck('D2b', 'filterLunchCandidates: includePlaceIds 강제 포함이 야간 필터를 override 한다', async () => {
  const candidates = [
    { id: 'n1', place_name: '호프집', category_name: '음식점 > 유흥주점 > 호프,요리주점' },
    { id: 'n2', place_name: '단골이자카야', category_name: '음식점 > 술집 > 이자카야' },
    { id: 'd1', place_name: '국밥집', category_name: '음식점 > 한식 > 국밥' },
  ];
  const out = filterLunchCandidates(candidates, {
    excludeCategoryKeywords: EXCLUDE_CATEGORY_KEYWORDS,
    includePlaceIds: ['n2'],
  });
  const outIds = out.map((c) => c.id).sort();
  assert.ok(outIds.includes('n2'), 'includePlaceIds 로 지정한 야간 업종 후보가 강제 포함되지 않음');
  assert.ok(!outIds.includes('n1'), 'includePlaceIds 에 없는 야간 업종 후보가 걸러지지 않음');
  return { status: 'PASS', detail: `includePlaceIds=['n2'] 강제 포함 확인 (out=${JSON.stringify(outIds)})` };
});

// ─────────────────────────────────────────────────────────────────────────
// D3: RECENT_LIMIT 이내 중복 없음(가용 후보 > RECENT_LIMIT), 순환은 정상(별도 케이스)
// ─────────────────────────────────────────────────────────────────────────
await runCheck('D3', 'selectRecommendation: 가용 후보 > RECENT_LIMIT 일 때 최근 N회 내 중복 없음', async () => {
  const RECENT_LIMIT = 10;
  const N_CANDIDATES = 15;
  const candidates = Array.from({ length: N_CANDIDATES }, (_, i) => ({
    id: `c${i + 1}`,
    place_name: `식당${i + 1}`,
    category_name: '음식점 > 한식 > 백반',
    distance: 100 + i,
  }));
  const rng = mulberry32(FIXED_SEED);
  let recentIds = [];
  const picks = [];
  const ITERATIONS = 60;
  for (let i = 0; i < ITERATIONS; i++) {
    const { picked, recentIds: nextRecent, cycled } = selectRecommendation(candidates, recentIds, rng, RECENT_LIMIT);
    assert.ok(picked !== null, `${i}번째 호출에서 picked=null (후보가 충분한데도 실패)`);
    assert.strictEqual(cycled, false, `가용 후보(${N_CANDIDATES}) > RECENT_LIMIT(${RECENT_LIMIT})인데 cycled=true 발생`);
    picks.push(picked.id);
    recentIds = nextRecent;
  }
  // 슬라이딩 윈도우: 임의의 연속 RECENT_LIMIT 구간에 중복이 없어야 함
  let dupFoundAt = -1;
  for (let i = 0; i < picks.length; i++) {
    const windowStart = Math.max(0, i - RECENT_LIMIT + 1);
    const window = picks.slice(windowStart, i + 1);
    const uniq = new Set(window);
    if (uniq.size !== window.length) {
      dupFoundAt = i;
      break;
    }
  }
  assert.strictEqual(dupFoundAt, -1, `인덱스 ${dupFoundAt} 근방 슬라이딩 윈도우(size=${RECENT_LIMIT})에 중복 발견`);
  return { status: 'PASS', detail: `${ITERATIONS}회 연속 호출, 슬라이딩 윈도우(${RECENT_LIMIT}) 내 중복 0건` };
});

await runCheck('D3b', 'selectRecommendation: 가용 후보 <= RECENT_LIMIT 이면 순환이 정상 발생(에러 아님)', async () => {
  const RECENT_LIMIT = 10;
  const N_CANDIDATES = 6; // <= RECENT_LIMIT
  const candidates = Array.from({ length: N_CANDIDATES }, (_, i) => ({
    id: `s${i + 1}`,
    place_name: `식당${i + 1}`,
    category_name: '음식점 > 한식 > 백반',
    distance: 50 + i,
  }));
  const rng = mulberry32(FIXED_SEED ^ 0x1234);
  let recentIds = [];
  let cycledObserved = false;
  const ITERATIONS = 30;
  for (let i = 0; i < ITERATIONS; i++) {
    const { picked, recentIds: nextRecent, cycled } = selectRecommendation(candidates, recentIds, rng, RECENT_LIMIT);
    assert.ok(picked !== null, `${i}번째 호출에서 picked=null (순환 상황에서도 크래시 없이 값을 반환해야 함)`);
    if (cycled) cycledObserved = true;
    recentIds = nextRecent;
  }
  assert.ok(cycledObserved, `${ITERATIONS}회 호출 동안 cycled=true 가 한 번도 관측되지 않음(순환 로직 미동작 의심)`);
  return { status: 'PASS', detail: `가용 후보(${N_CANDIDATES}) <= RECENT_LIMIT(${RECENT_LIMIT}) 상황에서 순환 발생 확인, 에러 없음` };
});

// ─────────────────────────────────────────────────────────────────────────
// D4: 메뉴 힌트 창작 금지 — leaf 단순변형 / 매핑 join / null 중 하나만 허용
// ─────────────────────────────────────────────────────────────────────────
await runCheck('D4', 'deriveMenuHint: 매핑표/입력 leaf 밖의 임의 문자열을 만들어내지 않는다', async () => {
  const CATEGORY_MENU_HINTS = {
    양식: ['파스타', '스테이크'],
    중식: ['짜장면', '짬뽕'],
    일식: ['초밥', '돈카츠', '우동'],
    분식: ['떡볶이', '김밥'],
    한식: ['백반', '찌개', '비빔밥'],
    아시아음식: ['쌀국수', '팟타이'],
  };

  function allowedAnswers(categoryName) {
    const leaf = String(categoryName).split('>').pop().trim();
    const leafVariants = new Set([leaf, leaf.split(',').map((s) => s.trim()).join('/')]);
    const mappingVariants = new Set();
    for (const [key, arr] of Object.entries(CATEGORY_MENU_HINTS)) {
      if (categoryName.includes(key)) {
        for (const sep of [',', '/', ', ', ' / ', ' ']) {
          mappingVariants.add(arr.join(sep));
        }
      }
    }
    return { leafVariants, mappingVariants };
  }

  const cases = [
    '음식점 > 한식 > 국밥',
    '음식점 > 한식',
    '음식점 > 양식 > 파스타,스테이크',
    '음식점 > 기타 > 우동나베',
    '',
  ];

  const details = [];
  for (const categoryName of cases) {
    const actual = deriveMenuHint(categoryName, CATEGORY_MENU_HINTS);
    if (!categoryName) {
      assert.strictEqual(actual, null, `categoryName 빈 문자열인데 null이 아님(actual=${JSON.stringify(actual)})`);
      details.push(`""→null OK`);
      continue;
    }
    const { leafVariants, mappingVariants } = allowedAnswers(categoryName);
    const ok = actual === null || leafVariants.has(actual) || mappingVariants.has(actual);
    assert.ok(
      ok,
      `"${categoryName}" → "${actual}" 는 leaf 변형(${[...leafVariants].join('|')})도 매핑 join(${[...mappingVariants].join('|')})도 null도 아님(창작 의심)`,
    );
    details.push(`"${categoryName}"→"${actual}" OK`);
  }
  return { status: 'PASS', detail: details.join('; ') };
});

// ─────────────────────────────────────────────────────────────────────────
// D5: 네트워크 전송 패턴이 Kakao SDK 로드 외 목적으로 쓰이지 않는지 정적 검사
// ─────────────────────────────────────────────────────────────────────────
await runCheck('D5', '정적 검사: fetch/XHR/sendBeacon 이 Kakao SDK 로드 외 용도로 없다', async () => {
  // lib/places.js(타일/지오코딩 수집 공유 모듈)·worldcup.js(탭3, lib/places.js 재사용) 를 스캔 대상에 추가.
  // moremore.js는 의도적으로 제외했다 — fetch('data/moremore-latest.json')가 같은 오리진 정적 파일을
  // 읽는 정당한 용도라 "Kakao SDK 로드 외 용도로 없다"는 이 검사의 취지와 다르고, 예외를 넣으려면
  // "같은 오리진 상대경로 fetch 는 허용"이라는 판정 로직을 새로 만들어야 하는데(요청 범위 밖) 지금 넣으면
  // 검사가 실제로 보증하는 바(=Kakao 도메인 참조 없이는 네트워크 코드 없음)가 흐려진다.
  const candidateFiles = ['app.js', 'lib/core.js', 'config.js', 'lib/places.js', 'worldcup.js'].map((f) =>
    path.join(REPO_ROOT, f),
  );
  const existingFiles = candidateFiles.filter((f) => existsSync(f));
  if (existingFiles.length === 0) {
    return { status: 'SKIP', detail: 'app.js/lib/core.js/config.js/lib/places.js/worldcup.js 모두 아직 없음(병렬 작성 중)' };
  }
  const NETWORK_PATTERNS = [/fetch\(/g, /XMLHttpRequest/g, /sendBeacon/g, /navigator\.sendBeacon/g];
  const offending = [];
  const checkedFiles = [];
  for (const file of existingFiles) {
    const content = readFileSync(file, 'utf8');
    checkedFiles.push(path.relative(REPO_ROOT, file));
    const hasKakaoRef = content.includes('dapi.kakao.com');
    for (const pattern of NETWORK_PATTERNS) {
      const matches = content.match(pattern);
      if (matches && matches.length > 0 && !hasKakaoRef) {
        offending.push(`${path.relative(REPO_ROOT, file)}: ${pattern} x${matches.length} (dapi.kakao.com 근거 없음)`);
      }
    }
  }
  assert.strictEqual(offending.length, 0, `의심 패턴 발견: ${offending.join(' | ')}`);
  return { status: 'PASS', detail: `검사 대상 [${checkedFiles.join(', ')}] — 의심 네트워크 전송 패턴 없음` };
});

// ─────────────────────────────────────────────────────────────────────────
// D6: 클라이언트 노출 키는 JS 앱키만, REST/시크릿 필드 없음
// ─────────────────────────────────────────────────────────────────────────
await runCheck('D6', '정적 검사: config.js 에 REST/시크릿 키 필드가 없고 KAKAO_JS_KEY 만 있다', async () => {
  const configPath = path.join(REPO_ROOT, 'config.js');
  if (!existsSync(configPath)) {
    return { status: 'SKIP', detail: 'config.js 아직 없음(병렬 작성 중)' };
  }
  const content = readFileSync(configPath, 'utf8');
  const forbiddenPatterns = [/\bREST\b/i, /KAKAO_REST_KEY/i, /SECRET/i, /Authorization/i];
  const hits = forbiddenPatterns.filter((p) => p.test(content)).map((p) => p.toString());
  assert.strictEqual(hits.length, 0, `금지 패턴 발견: ${hits.join(', ')}`);
  assert.ok(/KAKAO_JS_KEY/.test(content), 'KAKAO_JS_KEY 필드가 없음');
  return { status: 'PASS', detail: 'config.js: REST/SECRET/Authorization 없음, KAKAO_JS_KEY 존재' };
});

// ─────────────────────────────────────────────────────────────────────────
// D7: 후보 0개여도 크래시 없이 안내(null picked)
// ─────────────────────────────────────────────────────────────────────────
await runCheck('D7', 'selectRecommendation: 후보 0개일 때 throw 없이 picked=null 반환', async () => {
  const rng = mulberry32(FIXED_SEED);
  const result = selectRecommendation([], [], rng, 10);
  assert.ok(result && typeof result === 'object', '반환값이 객체가 아님');
  assert.strictEqual(result.picked, null, `picked 가 null 이 아님(${JSON.stringify(result.picked)})`);
  assert.strictEqual(result.cycled, false, `후보 0개인데 cycled=true`);
  return { status: 'PASS', detail: `selectRecommendation([],...) → ${JSON.stringify(result)}` };
});

// ─────────────────────────────────────────────────────────────────────────
// D8: 격자 분할이 반경 원을 빈틈없이 덮는다 + isPageTruncated 판정
// ─────────────────────────────────────────────────────────────────────────
await runCheck('D8', 'buildGridTiles: 표본점 전수가 타일에 포함된다 + isPageTruncated 판정', async () => {
  const center = { lat: 37.5665, lng: 126.978 };
  const RADIUS_METERS = 1000;
  const tiles = buildGridTiles(center, RADIUS_METERS, 400);
  assert.ok(Array.isArray(tiles) && tiles.length > 0, 'buildGridTiles 결과가 빈 배열/비배열');

  const EPS = 1e-9;
  const rng = mulberry32(FIXED_SEED ^ 0xabcdef);
  const SAMPLE_COUNT = 2000;
  let uncovered = 0;
  const uncoveredSamples = [];

  const lonScale = 111320 * Math.cos((center.lat * Math.PI) / 180);
  for (let i = 0; i < SAMPLE_COUNT; i++) {
    const r = RADIUS_METERS * Math.sqrt(rng()) * 0.999; // 경계 부동소수 오차 회피용 여유
    const theta = rng() * 2 * Math.PI;
    const dx = r * Math.cos(theta);
    const dy = r * Math.sin(theta);
    const lat = center.lat + dy / 111320;
    const lng = center.lng + dx / lonScale;
    const covered = tiles.some(
      (t) => lat >= t.swLat - EPS && lat <= t.neLat + EPS && lng >= t.swLng - EPS && lng <= t.neLng + EPS,
    );
    if (!covered) {
      uncovered++;
      if (uncoveredSamples.length < 5) uncoveredSamples.push({ lat, lng });
    }
  }
  assert.strictEqual(
    uncovered,
    0,
    `표본 ${SAMPLE_COUNT}개 중 ${uncovered}개가 어떤 타일에도 안 걸림. 예: ${JSON.stringify(uncoveredSamples)}`,
  );

  assert.strictEqual(isPageTruncated({ count: 45, isEnd: false }), true, 'count=45,isEnd=false 인데 true 아님');
  assert.strictEqual(isPageTruncated({ count: 20, isEnd: true }), false, 'count=20,isEnd=true 인데 false 아님');

  return {
    status: 'PASS',
    detail: `타일 ${tiles.length}개, 표본 ${SAMPLE_COUNT}개 전수 포함 확인, isPageTruncated 경계값 2건 확인`,
  };
});

// ─────────────────────────────────────────────────────────────────────────
// D9: 지오코딩 실패 시 reject, 임의 좌표 생성 금지 / 성공 시 올바른 좌표 resolve
// ─────────────────────────────────────────────────────────────────────────
await runCheck('D9', 'geocodeAddress: 실패 시 reject, 성공 시 올바른 {lat,lng} resolve', async () => {
  const mockGeocoderFail = (address, callback) => {
    callback([], 'ZERO_RESULT');
  };
  const mockGeocoderSuccess = (address, callback) => {
    callback([{ x: '127.0946', y: '37.5651', address_name: address }], 'OK');
  };

  let rejected = false;
  let rejectedWithCoord = null;
  try {
    const value = await geocodeAddress('존재하지않는주소12345', mockGeocoderFail);
    rejectedWithCoord = value; // resolve 되면 안 됨
  } catch (err) {
    rejected = true;
    assert.ok(err instanceof Error, `reject 된 값이 Error 인스턴스가 아님(${String(err)})`);
  }
  assert.ok(rejected, `실패 mock geocoderFn 인데도 reject 되지 않고 resolve됨(값=${JSON.stringify(rejectedWithCoord)})`);

  const resolved = await geocodeAddress('서울특별시 성동구 아차산로13길 11', mockGeocoderSuccess);
  assert.ok(resolved && typeof resolved === 'object', '성공 케이스 반환값이 객체가 아님');
  assert.strictEqual(Number(resolved.lat), 37.5651, `lat 불일치(${resolved.lat})`);
  assert.strictEqual(Number(resolved.lng), 127.0946, `lng 불일치(${resolved.lng})`);

  return { status: 'PASS', detail: `실패→reject 확인, 성공→{lat:${resolved.lat}, lng:${resolved.lng}} resolve 확인` };
});

// ─────────────────────────────────────────────────────────────────────────
// D10: 추천 분포 카이제곱 적합도 검정 (이력 제외 OFF, 고정 시드, N=100n, df=n-1, α=0.001)
// ─────────────────────────────────────────────────────────────────────────
const CHI_SQUARE_CRITICAL_DF7_ALPHA0001 = 24.322; // 표준 카이제곱 분포표, df=7, α=0.001

await runCheck('D10', 'selectRecommendation: 분포 카이제곱 적합도 검정(이력제외 OFF, N=100n, df=n-1, α=0.001)', async () => {
  const RECENT_LIMIT = 10;
  const n = 8;
  const candidates = Array.from({ length: n }, (_, i) => ({
    id: `d10-${i + 1}`,
    place_name: `식당${i + 1}`,
    category_name: '음식점 > 한식 > 백반',
    distance: 100,
  }));
  const N = 100 * n; // 800
  const rng = mulberry32(FIXED_SEED); // 하나의 PRNG 인스턴스를 800회 이어서 사용

  const counts = Object.fromEntries(candidates.map((c) => [c.id, 0]));
  for (let i = 0; i < N; i++) {
    const { picked } = selectRecommendation(candidates, [], rng, RECENT_LIMIT, { excludeRecent: false });
    assert.ok(picked !== null, `${i}번째 시행에서 picked=null (excludeRecent:false 인데도 실패)`);
    assert.ok(Object.prototype.hasOwnProperty.call(counts, picked.id), `알 수 없는 id 선택됨: ${picked.id}`);
    counts[picked.id]++;
  }

  const expected = N / n;
  let chiSquare = 0;
  for (const c of candidates) {
    const observed = counts[c.id];
    chiSquare += ((observed - expected) ** 2) / expected;
  }
  const df = n - 1;
  const pass = chiSquare <= CHI_SQUARE_CRITICAL_DF7_ALPHA0001;
  assert.ok(
    pass,
    `카이제곱 통계량 ${chiSquare.toFixed(4)} 가 임계값 ${CHI_SQUARE_CRITICAL_DF7_ALPHA0001}(df=${df}, α=0.001) 초과 — 분포 쏠림 의심. counts=${JSON.stringify(counts)}`,
  );

  return {
    status: 'PASS',
    detail: `n=${n}, N=${N}, χ²=${chiSquare.toFixed(4)} <= 임계값 ${CHI_SQUARE_CRITICAL_DF7_ALPHA0001}(df=${df})`,
  };
});

// ── D3 보조로 쓴 dedupeById / updateRecent / mergeGridResults / pickRandom 도
//    최소 1회는 직접 호출해 계약(시그니처) 자체가 깨지지 않았는지 가볍게 확인 ──
await runCheck('D11', '부가 계약 점검: dedupeById/updateRecent/mergeGridResults/pickRandom 시그니처', async () => {
  const dup = dedupeById([{ id: 'x' }, { id: 'x' }, { id: 'y' }]);
  assert.strictEqual(dup.length, 2, 'dedupeById 가 id 기준 중복 제거를 못함');

  const rng = mulberry32(FIXED_SEED);
  const picked = pickRandom(['a', 'b', 'c'], rng);
  assert.ok(['a', 'b', 'c'].includes(picked), 'pickRandom 이 목록 밖의 값을 반환함');

  const recent = updateRecent([], 'z1', 3);
  assert.deepStrictEqual(recent, ['z1']);
  const recent2 = updateRecent(['z1'], 'z2', 1);
  assert.deepStrictEqual(recent2, ['z2'], 'updateRecent 가 limit 초과분을 truncate 못함');

  const merged = mergeGridResults([[{ id: 'm1' }, { id: 'm2' }], [{ id: 'm2' }, { id: 'm3' }]]);
  const mergedIds = merged.map((c) => c.id).sort();
  assert.deepStrictEqual(mergedIds, ['m1', 'm2', 'm3'], 'mergeGridResults 가 dedupe 를 못함');

  return { status: 'PASS', detail: 'dedupeById/pickRandom/updateRecent/mergeGridResults 기본 계약 확인' };
});

// ─────────────────────────────────────────────────────────────────────────
// D12: 모락모락 4경로 통합 · 창작 금지 (fetch실패/빈data/파싱예외/날짜불일치)
// ─────────────────────────────────────────────────────────────────────────
await runCheck('D12', 'parseMoremoreResponse + isFreshMoremoreData: 4경로(fetch실패/빈data/파싱예외/날짜불일치) 동일 귀결 + 필드 창작 금지', async () => {
  // 모의 응답 행: index 1=nameKo 2=kcal 3=이미지baseURL 4=이미지파일명 5=sides 6=corner 12=nameEn
  function makeRow({ nameKo, kcal = null, imgBase = null, imgFile = null, sidesStr = null, corner = null, nameEn = null }) {
    const row = new Array(13).fill(null);
    row[1] = nameKo;
    row[2] = kcal;
    row[3] = imgBase;
    row[4] = imgFile;
    row[5] = sidesStr;
    row[6] = corner;
    row[12] = nameEn;
    return row;
  }

  const rowA = makeRow({
    nameKo: '제육볶음정식',
    kcal: '1,324', // 콤마 포함 → 숫자 변환
    imgBase: 'https://img.pulmuone.com/',
    imgFile: 'jeyuk.jpg',
    sidesStr: '김치 / 콩나물국',
    corner: '백반',
    nameEn: 'Stir-fried Pork Set',
  });
  const rowB = makeRow({
    nameKo: '샐러드바',
    kcal: '0', // "0" → null 처리
    corner: '스페셜',
  });
  const rowC = makeRow({
    nameKo: '돈까스',
    kcal: '750',
    imgBase: 'https://img.pulmuone.com/',
    imgFile: 'donkatsu.jpg',
    sidesStr: '단무지 / 양배추',
    corner: 'TAKEOUT',
    nameEn: 'Pork Cutlet',
  });
  const rowEmptyName = makeRow({ nameKo: '', kcal: '500', corner: '제외되어야함' }); // nameKo 빈문자열 → 제외
  const rowUnparsableKcal = makeRow({ nameKo: '특선메뉴', kcal: 'N/A', corner: '특선' }); // 파싱불가 → null

  const mockRows = [rowA, rowB, rowC, rowEmptyName, rowUnparsableKcal];
  const result = parseMoremoreResponse({ data: mockRows });

  assert.ok(result && typeof result === 'object', '반환값이 객체가 아님');
  assert.strictEqual(result.ready, true, `정상 응답인데 ready!==true (${JSON.stringify(result.ready)})`);
  assert.strictEqual(result.items.length, 4, `nameKo 빈 행은 제외되어 4개여야 하는데 ${result.items.length}개`);

  const EXPECTED_KEYS = ['corner', 'nameKo', 'nameEn', 'kcal', 'imageUrl', 'sides'].sort();
  for (const item of result.items) {
    const actualKeys = Object.keys(item).sort();
    assert.deepStrictEqual(actualKeys, EXPECTED_KEYS, `item이 정의된 6개 필드 외를 갖거나 누락함: ${JSON.stringify(actualKeys)}`);
  }

  const itemA = result.items.find((i) => i.nameKo === '제육볶음정식');
  assert.ok(itemA, 'rowA 파싱 결과 없음');
  assert.strictEqual(itemA.kcal, 1324, `콤마 kcal 파싱 실패(${itemA.kcal})`);
  assert.strictEqual(itemA.imageUrl, 'https://img.pulmuone.com/jeyuk.jpg', `imageUrl = index3+index4 아님(${itemA.imageUrl})`);
  assert.deepStrictEqual(itemA.sides, ['김치', '콩나물국'], `sides " / " split 실패(${JSON.stringify(itemA.sides)})`);
  assert.strictEqual(itemA.corner, '백반');
  assert.strictEqual(itemA.nameEn, 'Stir-fried Pork Set');

  const itemB = result.items.find((i) => i.nameKo === '샐러드바');
  assert.ok(itemB, 'rowB 파싱 결과 없음');
  assert.strictEqual(itemB.kcal, null, `kcal "0" 인데 null 아님(${itemB.kcal})`);
  assert.strictEqual(itemB.imageUrl, null, `이미지 필드 없는데 imageUrl null 아님(${itemB.imageUrl})`);
  assert.deepStrictEqual(itemB.sides, [], `sides null인데 [] 아님(${JSON.stringify(itemB.sides)})`);

  const itemE = result.items.find((i) => i.nameKo === '특선메뉴');
  assert.ok(itemE, 'rowUnparsableKcal 파싱 결과 없음');
  assert.strictEqual(itemE.kcal, null, `kcal 파싱 불가("N/A")인데 null 아님(${itemE.kcal})`);

  // 3경로(+ 그 외 이상 입력) 모두 예외 없이 {ready:false, items:[]} 류로 귀결
  const abnormalInputs = [null, undefined, {}, { data: '문자열' }, { data: [] }, { data: [['불완전행']] }];
  for (const input of abnormalInputs) {
    let out;
    assert.doesNotThrow(() => {
      out = parseMoremoreResponse(input);
    }, `입력 ${JSON.stringify(input)}에서 throw 발생(절대 throw 금지 위반)`);
    assert.ok(out && typeof out === 'object', `입력 ${JSON.stringify(input)} 결과가 객체가 아님`);
    assert.strictEqual(out.ready, false, `입력 ${JSON.stringify(input)}에서 ready!==false (${JSON.stringify(out.ready)})`);
    assert.ok(Array.isArray(out.items) && out.items.length === 0, `입력 ${JSON.stringify(input)}에서 items가 빈 배열이 아님`);
  }

  // 4번째 경로: 날짜 불일치(isFreshMoremoreData) — 파싱은 정상(ready:true)이어도
  // moremore.js는 ready && isFreshMoremoreData(...) 모두 참일 때만 정상 렌더해야 하므로,
  // isFreshMoremoreData 자체의 계약(정확 일치만 true, 그 외 전부 예외 없이 false)을 별도 검증한다.
  const freshnessCases = [
    { fetchedDate: '20260825', todayDate: '20260825', expected: true, label: '같은 날짜' },
    { fetchedDate: '20260824', todayDate: '20260825', expected: false, label: '어제 데이터(하루 전)' },
    { fetchedDate: '20260826', todayDate: '20260825', expected: false, label: '미래 날짜' },
    { fetchedDate: null, todayDate: '20260825', expected: false, label: 'fetchedDate=null' },
    { fetchedDate: '20260825', todayDate: undefined, expected: false, label: 'todayDate=undefined' },
    { fetchedDate: '2026-08-25', todayDate: '20260825', expected: false, label: '형식 다름(하이픈 포함, 정확 일치 아님)' },
    { fetchedDate: '', todayDate: '', expected: false, label: '빈 문자열끼리(길이 8 아님 → 신선 오판 방지)' },
  ];
  const freshnessDetails = [];
  for (const { fetchedDate, todayDate, expected, label } of freshnessCases) {
    let actual;
    assert.doesNotThrow(() => {
      actual = isFreshMoremoreData(fetchedDate, todayDate);
    }, `isFreshMoremoreData(${JSON.stringify(fetchedDate)}, ${JSON.stringify(todayDate)})에서 throw 발생(예외 없이 false여야 함)`);
    assert.strictEqual(
      actual,
      expected,
      `isFreshMoremoreData(${JSON.stringify(fetchedDate)}, ${JSON.stringify(todayDate)}) [${label}] → ${actual}, 기대값 ${expected}`,
    );
    freshnessDetails.push(`${label}→${actual} OK`);
  }

  return {
    status: 'PASS',
    detail: `정상 3행 파싱(콤마kcal/kcal0/파싱불가kcal 확인, 필드 6개 정확 일치, 빈 nameKo 제외) + 이상입력 ${abnormalInputs.length}종 전부 {ready:false, items:[]} 귀결 + 4번째경로(날짜불일치) isFreshMoremoreData ${freshnessCases.length}종 확인: ${freshnessDetails.join('; ')}`,
  };
});

// ─────────────────────────────────────────────────────────────────────────
// D13: 월드컵 참가 메뉴는 실제 후보 기반(가상 식당 없음)
// ─────────────────────────────────────────────────────────────────────────
const CATEGORY_MENU_HINTS = {
  양식: ['파스타', '스테이크'],
  중식: ['짜장면', '짬뽕'],
  일식: ['초밥', '돈카츠', '우동'],
  분식: ['떡볶이', '김밥'],
  한식: ['백반', '찌개', '비빔밥'],
  아시아음식: ['쌀국수', '팟타이'],
};

// toCandidate() 결과와 동일한 형태: {id,name,category_name,distance,lat,lng,address,place_url,...}
function makeCandidate(id, categoryName) {
  return {
    id,
    name: `식당${id}`,
    category_name: categoryName,
    distance: 100 + Number(String(id).replace(/\D/g, '')),
    lat: 37.5665 + Number(String(id).replace(/\D/g, '')) * 0.0001,
    lng: 126.978 + Number(String(id).replace(/\D/g, '')) * 0.0001,
    address: `서울특별시 성동구 어딘가 ${id}`,
    place_url: `https://place.map.kakao.com/${id}`,
  };
}

const VALID_LEAF_CATEGORIES = [
  '음식점 > 한식 > 국밥',
  '음식점 > 양식 > 파스타,스테이크',
  '음식점 > 중식 > 짜장면',
  '음식점 > 일식 > 초밥',
  '음식점 > 분식 > 떡볶이',
  '음식점 > 한식', // 리프가 매핑 폴백('한식') → 여전히 non-null
];

await runCheck('D13', 'buildWorldcupPool: 참가 풀이 실제 후보 참조 그대로(가상 식당 생성 없음) + 부족 시 지어내지 않음 + 결정성', async () => {
  // 후보 20개: 16개는 유효(non-empty category_name → deriveMenuHint non-null), 4개는 무효(category_name='' → null)
  const candidates20 = [];
  for (let i = 1; i <= 16; i++) {
    candidates20.push(makeCandidate(`w${i}`, VALID_LEAF_CATEGORIES[(i - 1) % VALID_LEAF_CATEGORIES.length]));
  }
  for (let i = 17; i <= 20; i++) {
    candidates20.push(makeCandidate(`w${i}`, '')); // 힌트 없는(빈) 카테고리 → 무효 후보
  }

  const rng1 = mulberry32(FIXED_SEED);
  const { pool, sufficient } = buildWorldcupPool(candidates20, CATEGORY_MENU_HINTS, 16, rng1);
  assert.strictEqual(sufficient, true, `유효 후보 16개인데 sufficient!==true`);
  assert.strictEqual(pool.length, 16, `pool 크기가 16이 아님(${pool.length})`);

  const validCandidates = candidates20.slice(0, 16);
  const seenIds = new Set();
  for (const entry of pool) {
    assert.ok(entry && entry.place && typeof entry.menuText !== 'undefined', 'pool 원소가 {place, menuText} 형태가 아님');
    const isSameRef = validCandidates.some((c) => c === entry.place);
    assert.ok(isSameRef, `entry.place가 원본 candidates 배열의 참조와 동일하지 않음(가상 식당 생성 의심): ${JSON.stringify(entry.place)}`);
    assert.ok(!seenIds.has(entry.place.id), `place.id 중복 발견: ${entry.place.id}`);
    seenIds.add(entry.place.id);
  }

  // 유효 후보가 size보다 적을 때: 지어내지 않고 있는 만큼만
  const only10Valid = candidates20.slice(0, 10);
  const rng2 = mulberry32(FIXED_SEED ^ 0x2468);
  const shortResult = buildWorldcupPool(only10Valid, CATEGORY_MENU_HINTS, 16, rng2);
  assert.strictEqual(shortResult.sufficient, false, `유효 후보 10개 < size 16인데 sufficient!==false`);
  assert.strictEqual(shortResult.pool.length, 10, `부족 시 pool 크기가 유효 후보 수(10)와 다름(${shortResult.pool.length})`);
  const shortIds = shortResult.pool.map((e) => e.place.id).sort();
  assert.deepStrictEqual(shortIds, only10Valid.map((c) => c.id).sort(), '부족 시 pool이 유효 후보 전체와 다름(지어냄 의심)');

  // 결정성: 같은 고정 시드로 두 번 호출 시 같은 pool
  const poolRun1 = buildWorldcupPool(candidates20, CATEGORY_MENU_HINTS, 16, mulberry32(FIXED_SEED));
  const poolRun2 = buildWorldcupPool(candidates20, CATEGORY_MENU_HINTS, 16, mulberry32(FIXED_SEED));
  const ids1 = poolRun1.pool.map((e) => e.place.id);
  const ids2 = poolRun2.pool.map((e) => e.place.id);
  assert.deepStrictEqual(ids1, ids2, `같은 고정 시드인데 두 번 호출 결과가 다름(비결정적): ${JSON.stringify(ids1)} vs ${JSON.stringify(ids2)}`);

  return {
    status: 'PASS',
    detail: `sufficient=true·pool=16(참조동일성/중복없음 확인), 부족(10<16) 시 지어내지 않고 pool=10, 고정시드 2회 호출 동일 pool 확인`,
  };
});

// ─────────────────────────────────────────────────────────────────────────
// D14: 브래킷 라운드마다 정확히 절반, 패자 재등장 없음
// ─────────────────────────────────────────────────────────────────────────
await runCheck('D14', 'pairMatches/nextRoundParticipants: 라운드마다 정확히 절반 + 패자 재등장 없음(16→8→4→2→1, 총 15경기)', async () => {
  const participants16 = Array.from({ length: 16 }, (_, i) => ({ id: `p${i + 1}` }));

  // pairMatches: 순차 페어링 확인
  const firstRoundMatches = pairMatches(participants16);
  assert.strictEqual(firstRoundMatches.length, 8, `16명 페어링 결과가 8매치가 아님(${firstRoundMatches.length})`);
  for (let i = 0; i < firstRoundMatches.length; i++) {
    const m = firstRoundMatches[i];
    assert.strictEqual(m.a, participants16[2 * i], `매치[${i}].a 페어링 순서 불일치`);
    assert.strictEqual(m.b, participants16[2 * i + 1], `매치[${i}].b 페어링 순서 불일치`);
    assert.notStrictEqual(m.a, m.b, `매치[${i}]가 동일 참가자로 구성됨`);
  }

  // nextRoundParticipants: winnerSides에 맞는 쪽 선택
  const winnerSidesFixed = [0, 1, 0, 1, 0, 1, 0, 1];
  const winners8 = nextRoundParticipants(firstRoundMatches, winnerSidesFixed);
  assert.strictEqual(winners8.length, 8, `승자 수가 8이 아님(${winners8.length})`);
  for (let i = 0; i < firstRoundMatches.length; i++) {
    const expected = winnerSidesFixed[i] === 0 ? firstRoundMatches[i].a : firstRoundMatches[i].b;
    assert.strictEqual(winners8[i], expected, `winnerSides[${i}]=${winnerSidesFixed[i]}인데 승자 선택이 다름`);
  }

  // end-to-end: 16→8→4→2→1, 매 라운드 정확히 절반 + 이전 라운드 패자가 이후 라운드에 재등장하지 않음
  let round = Array.from({ length: 16 }, (_, i) => ({ id: `e${i + 1}` }));
  const priorLosers = new Set();
  let totalMatches = 0;
  const roundSizeLog = [];
  while (round.length > 1) {
    for (const p of round) {
      assert.ok(!priorLosers.has(p), `이전 라운드 패자(${p.id})가 이번 라운드에 재등장함`);
    }
    roundSizeLog.push(round.length);
    const matches = pairMatches(round);
    totalMatches += matches.length;
    for (const m of matches) {
      assert.notStrictEqual(m.a, m.b, '매치가 동일 참가자로 구성됨');
    }
    const winnerSides = matches.map((_, idx) => idx % 2); // 결정적 패턴(항상 짝수 인덱스는 a, 홀수는 b 승)
    const winners = nextRoundParticipants(matches, winnerSides);
    assert.strictEqual(winners.length, round.length / 2, `라운드 축소가 정확히 절반이 아님(${round.length} → ${winners.length})`);
    const losers = matches.map((m, idx) => (winnerSides[idx] === 0 ? m.b : m.a));
    for (const loser of losers) priorLosers.add(loser);
    round = winners;
  }
  assert.strictEqual(totalMatches, 15, `전체 경기 수가 15가 아님(${totalMatches})`);
  assert.strictEqual(round.length, 1, `최종 우승자가 1명이 아님(${round.length})`);
  assert.ok(!priorLosers.has(round[0]), '최종 우승자가 과거 패자 집합에 속함(모순)');

  return {
    status: 'PASS',
    detail: `pairMatches 순서 확인(8매치), nextRoundParticipants winnerSides 선택 확인, e2e 16→${roundSizeLog.slice(1).join('→')}→1 총 ${totalMatches}경기, 패자 재등장 0건`,
  };
});

// ─────────────────────────────────────────────────────────────────────────
// D15: 우승 메뉴는 실제 식당과 연결(가짜 링크 금지)
// ─────────────────────────────────────────────────────────────────────────
await runCheck('D15', '전체 토너먼트 시뮬레이션: 최종 우승자 place.place_url이 원본 후보와 정확히 일치(가짜 링크 없음)', async () => {
  const candidates20 = [];
  for (let i = 1; i <= 16; i++) {
    candidates20.push(makeCandidate(`d15-w${i}`, VALID_LEAF_CATEGORIES[(i - 1) % VALID_LEAF_CATEGORIES.length]));
  }
  for (let i = 17; i <= 20; i++) {
    candidates20.push(makeCandidate(`d15-w${i}`, ''));
  }

  const rng = mulberry32(FIXED_SEED);
  const { pool, sufficient } = buildWorldcupPool(candidates20, CATEGORY_MENU_HINTS, 16, rng);
  assert.strictEqual(sufficient, true, '시뮬레이션 전제(유효 후보 16개) 불충족');
  assert.strictEqual(pool.length, 16);

  let round = pool; // Array<{place, menuText}>
  let matchCount = 0;
  while (round.length > 1) {
    const matches = pairMatches(round);
    matchCount += matches.length;
    const winnerSides = matches.map(() => Math.floor(rng() * 2)); // 무작위 승자 선택도 같은 rng로
    round = nextRoundParticipants(matches, winnerSides);
  }
  assert.strictEqual(round.length, 1, '최종 우승자가 1명이 아님');
  assert.strictEqual(matchCount, 15, `전체 경기 수가 15가 아님(${matchCount})`);

  const champion = round[0];
  assert.ok(champion && champion.place && champion.place.place_url, '우승자에 place.place_url이 없음');

  const matchingCandidate = candidates20.find((c) => c.place_url === champion.place.place_url);
  assert.ok(matchingCandidate, `우승자 place_url(${champion.place.place_url})이 원본 후보 중 어느 것과도 일치하지 않음(가짜 링크 의심)`);
  assert.strictEqual(champion.place, matchingCandidate, '우승자 place가 원본 후보 객체와 참조 동일하지 않음(가짜/복제 식당 의심)');

  return {
    status: 'PASS',
    detail: `16강~결승 총 ${matchCount}경기 완주, 우승자 place_url="${champion.place.place_url}"이 원본 후보와 문자열·참조 모두 일치`,
  };
});

// ─────────────────────────────────────────────────────────────────────────
// D16: 크롤러 저장 게이트 — 빈/이상 응답으로 되돌리지 않되, 항목이 있으면 항상 반영
// ─────────────────────────────────────────────────────────────────────────
await runCheck('D16', 'hasMoremoreItems: 빈/스키마깨짐 응답만 false, 항목이 있으면 항상 true(부분 게시도 반영)', async () => {
  const oneCorner = { data: [['010', '라면', '0', null, null, null, 'TAKEOUT']] };
  const fiveCorners = {
    data: [
      ['010', '라면', '0'],
      ['020', '쫄면순두부찌개', '939'],
      ['030', '제육볶음', '820'],
      ['040', '치킨마요덮밥', '760'],
      ['050', '샐러드', '310'],
    ],
  };

  // (a) 저장할 항목이 없는 응답 → false (있는 데이터를 빈 것으로 되돌리지 않는다)
  assert.strictEqual(hasMoremoreItems({ data: [] }), false, '(a) 빈 배열인데 true');
  assert.strictEqual(hasMoremoreItems(null), false, '(a) null 인데 true');
  assert.strictEqual(hasMoremoreItems(undefined), false, '(a) undefined 인데 true');
  assert.strictEqual(hasMoremoreItems({}), false, '(a) data 부재인데 true');
  assert.strictEqual(hasMoremoreItems({ data: null }), false, '(a) data=null 인데 true');
  assert.strictEqual(hasMoremoreItems({ data: 'error' }), false, '(a) data가 배열이 아닌데 true');
  assert.strictEqual(hasMoremoreItems('error'), false, '(a) raw가 문자열인데 true');

  // (b) non-empty 지만 원소 스키마가 깨진 응답 → false (parseMoremoreResponse 가 항목 0개로 보는 입력)
  assert.strictEqual(hasMoremoreItems({ data: ['error'] }), false, '(b) 배열이 아닌 행만 있는데 true');
  assert.strictEqual(hasMoremoreItems({ data: [['010']] }), false, '(b) row[1] 부재인데 true');
  assert.strictEqual(hasMoremoreItems({ data: [['010', '']] }), false, '(b) row[1] 빈 문자열인데 true');
  assert.strictEqual(hasMoremoreItems({ data: [['010', 123]] }), false, '(b) row[1] 비문자열인데 true');
  assert.strictEqual(hasMoremoreItems({ data: [null, { a: 1 }] }), false, '(b) 항목 아닌 행들만 있는데 true');
  // 깨진 행이 섞여 있어도 유효 행이 1개라도 있으면 저장한다(parseMoremoreResponse 가 걸러 렌더).
  assert.strictEqual(hasMoremoreItems({ data: ['error', ['010', '라면']] }), true, '(b) 유효 행 1개가 있는데 false');

  // (c) 부분 게시 — 코너 수와 무관하게 항상 true.
  //     이른 슬롯이 1코너만 커밋해도 뒤 슬롯의 5코너 확정 메뉴가 반영돼야 한다(기존 게이트의 퇴행 지점).
  //     반대로 5코너 → 1코너로 줄어드는 응답도 최신이 정답이므로 반영한다.
  assert.strictEqual(hasMoremoreItems(oneCorner), true, '(c) 1코너 응답인데 false');
  assert.strictEqual(hasMoremoreItems(fiveCorners), true, '(c) 5코너 응답인데 false');

  // (d) 게이트 판정 기준이 parseMoremoreResponse 의 항목 판정과 일치한다(한쪽만 통과하는 입력이 없어야 함).
  const samples = [
    { data: [] },
    { data: ['error'] },
    { data: [['010']] },
    { data: [['010', '']] },
    { data: [['010', 123]] },
    oneCorner,
    fiveCorners,
    { data: ['error', ['010', '라면']] },
  ];
  for (const sample of samples) {
    const parsed = parseMoremoreResponse(sample);
    assert.strictEqual(
      hasMoremoreItems(sample),
      parsed.ready,
      `(d) 게이트와 parseMoremoreResponse.ready 불일치: ${JSON.stringify(sample)}`,
    );
  }

  // (e) 실제 커밋된 산출물도 게이트를 통과해야 한다(픽스처만 통과하는 판정이 아님을 확인).
  const latestPath = path.join(REPO_ROOT, 'data', 'moremore-latest.json');
  let realDetail = 'data/moremore-latest.json 없음(스킵)';
  if (existsSync(latestPath)) {
    const saved = JSON.parse(readFileSync(latestPath, 'utf-8'));
    assert.strictEqual(hasMoremoreItems(saved.raw), true, '(e) 커밋된 실데이터가 게이트를 통과하지 못함');
    realDetail = `실데이터 통과(rows=${saved.raw.data.length})`;
  }

  return {
    status: 'PASS',
    detail:
      '(a) 빈/비배열 7종 false OK; (b) 스키마 깨진 행 5종 false + 유효행 혼재 true OK; ' +
      `(c) 1코너·5코너 모두 true(부분 게시 반영) OK; (d) parseMoremoreResponse.ready 와 8종 전부 일치 OK; (e) ${realDetail}`,
  };
});

// ─────────────────────────────────────────────────────────────────────────
// D17: 원 밖 타일 프루닝 무손실 — isTileOutsideRadius=true 인 타일 내부의 어떤 점도
//      실제(haversine) 반경 안에 들어오지 않는지 몬테카를로로 검증한다(가장 중요).
// ─────────────────────────────────────────────────────────────────────────
await runCheck(
  'D17',
  'isTileOutsideRadius: 프루닝된 타일 내부 표본 전부가 실제로 반경 밖(정보 손실 없음) + 실측 반례 회귀',
  async () => {
    // 하드코딩된 실측 반례(적대적 리뷰 발견, 회귀 테스트로 박제).
    // 과거 결함: 프루닝은 등장방형 근사, 최종 filterByRadius는 haversine이라 둘이 어긋나
    // 반경 안(최근접점 haversine 799.70m ≤ 800m)인 타일을 프루닝(정보 손실)했다.
    // 몬테카를로 표본이 이 0.002% 지점을 우연히 못 뽑아 기존 2,000점/타일로는 이 반례를 놓쳤다.
    const REGRESSION_CASE_D17 = {
      center: { lat: 37.54638305542474, lng: 127.06547994871624 },
      radius: 800,
      tile: {
        swLat: 37.5494071146245,
        swLng: 127.05272065330915,
        neLat: 37.553000359324464,
        neLng: 127.05724983913025,
      },
    };
    const regressionNearestDist = (() => {
      const nearest = {
        lat: Math.min(Math.max(REGRESSION_CASE_D17.center.lat, REGRESSION_CASE_D17.tile.swLat), REGRESSION_CASE_D17.tile.neLat),
        lng: Math.min(Math.max(REGRESSION_CASE_D17.center.lng, REGRESSION_CASE_D17.tile.swLng), REGRESSION_CASE_D17.tile.neLng),
      };
      return haversineMeters(REGRESSION_CASE_D17.center, nearest);
    })();
    assert.ok(
      regressionNearestDist <= REGRESSION_CASE_D17.radius,
      `실측 반례 픽스처 자체가 어긋남: 최근접점 haversine=${regressionNearestDist.toFixed(2)}m 가 radius=${REGRESSION_CASE_D17.radius}m 를 초과(반례 조건 불성립, 픽스처 오류 의심)`,
    );
    const regressionResult = isTileOutsideRadius(
      REGRESSION_CASE_D17.tile,
      REGRESSION_CASE_D17.center,
      REGRESSION_CASE_D17.radius,
    );
    assert.strictEqual(
      regressionResult,
      false,
      `실측 반례(회귀) FAIL: 타일 최근접점 haversine≈${regressionNearestDist.toFixed(2)}m ≤ ${REGRESSION_CASE_D17.radius}m인데 isTileOutsideRadius가 true(반경 안 후보 유실)를 반환함`,
    );

    // 2차 적대적 리뷰 지적: 위 REGRESSION_CASE_D17 하나만으로는 부족하다 — 등장방형 최근접거리(800.613m)가
    // radius+margin(800+2=802m) 아래라 "거리 함수를 haversine에서 등장방형으로 되돌리되 마진(2m)은 남겨둔"
    // 회귀는 위 케이스로 못 잡는다(마진이 그 정도 괴리는 흡수해버림). 두 근사(등장방형/haversine)의 괴리는
    // 위도가 높고 반경이 클수록 커지므로, 국내 좌표대(위도 33~43N, 경도 126~129E) x 반경(800~8000m)을
    // 격자 탐색해 "등장방형 최근접거리 > radius+margin 인데 haversine 최근접거리 <= radius"인 조합을 찾았다
    // (탐색 스크립트: 위 두 조건을 만족하는 첫 500개 후보 중 괴리가 가장 큰 것을 채택, radius<=1800에서는
    // 그런 조합이 하나도 없었다 — 정직하게 남긴다. lat=35,lng=129,radius=8000이 실사용 반경 800m보다
    // 훨씬 크지만, 이 D17 자체는 isTileOutsideRadius의 "등장방형 vs haversine 불일치" 결함 계열을 잡는
    // 일반 오라클이라 특정 반경에 종속될 이유가 없다).
    const EQUIRECT_MARGIN_D17B = 2; // lib/core.js의 PRUNE_SAFETY_MARGIN_METERS(비공개 상수, 현재 2)와 동기화 필요
    const REGRESSION_CASE_D17B = {
      center: { lat: 35, lng: 129 },
      radius: 8000,
      tile: {
        swLat: 35.03054257994969,
        swLng: 128.91607757495663,
        neLat: 35.03413582464965,
        neLng: 128.92046411677754,
      },
    };
    function nearestPointInTile(tile, center) {
      return {
        lat: Math.min(Math.max(center.lat, tile.swLat), tile.neLat),
        lng: Math.min(Math.max(center.lng, tile.swLng), tile.neLng),
      };
    }
    function equirectDistanceMeters(center, point) {
      const METERS_PER_DEG_LAT = 111320;
      const metersPerDegLng = METERS_PER_DEG_LAT * Math.cos((center.lat * Math.PI) / 180);
      const dy = (point.lat - center.lat) * METERS_PER_DEG_LAT;
      const dx = (point.lng - center.lng) * metersPerDegLng;
      return Math.sqrt(dx * dx + dy * dy);
    }
    const nearestB = nearestPointInTile(REGRESSION_CASE_D17B.tile, REGRESSION_CASE_D17B.center);
    const haversineNearestB = haversineMeters(REGRESSION_CASE_D17B.center, nearestB);
    const equirectNearestB = equirectDistanceMeters(REGRESSION_CASE_D17B.center, nearestB);
    // 픽스처 정합성: (1) 실제(haversine) 기준으로는 반경 안(프루닝하면 안 됨), (2) 등장방형+마진 기준으로는
    // 반경 밖으로 오판하는 조합이어야 이 픽스처가 "거리함수 등장방형 회귀"를 실제로 가려낸다.
    assert.ok(
      haversineNearestB <= REGRESSION_CASE_D17B.radius,
      `REGRESSION_CASE_D17B 픽스처 오류: haversine 최근접거리=${haversineNearestB.toFixed(3)}m 가 radius=${REGRESSION_CASE_D17B.radius}m 초과(반경 안 조건 불성립)`,
    );
    assert.ok(
      equirectNearestB > REGRESSION_CASE_D17B.radius + EQUIRECT_MARGIN_D17B,
      `REGRESSION_CASE_D17B 픽스처 오류: 등장방형 최근접거리=${equirectNearestB.toFixed(3)}m 가 radius+margin=${REGRESSION_CASE_D17B.radius + EQUIRECT_MARGIN_D17B}m 이하라, "등장방형+마진" 회귀를 가려낼 수 없음(판별력 없는 픽스처)`,
    );
    const regressionResultB = isTileOutsideRadius(
      REGRESSION_CASE_D17B.tile,
      REGRESSION_CASE_D17B.center,
      REGRESSION_CASE_D17B.radius,
    );
    assert.strictEqual(
      regressionResultB,
      false,
      `실측 반례B(회귀, 등장방형+마진 판별용) FAIL: haversine 최근접거리≈${haversineNearestB.toFixed(2)}m ≤ ${REGRESSION_CASE_D17B.radius}m인데 isTileOutsideRadius가 true(반경 안 후보 유실)를 반환함 — 거리 함수가 haversine이 아닌 등장방형으로 되돌아갔을 가능성`,
    );

    const centers = [
      { lat: 37.5451, lng: 127.0554, label: '회사' },
      { lat: 37.5665, lng: 126.978, label: '시청' },
      { lat: 37.4979, lng: 127.0276, label: '강남역' },
    ];
    const radii = [800, 1200, 1800]; // 1366m(타일 400m 대각선/2 ≈)을 넘어야 실질 프루닝이 나오므로 세 값 모두 필요
    const SAMPLES_PER_TILE = 20000; // 2,000점으로는 위 0.002% 반례급 밀도를 놓쳐 20,000으로 상향(조합 수는 유지)

    let totalPrunedTiles = 0;
    let totalSamples = 0;
    let violations = 0;
    const violationDetails = [];
    const perComboLog = [];
    let seedOffset = 0;

    for (const center of centers) {
      for (const R of radii) {
        const tiles = buildGridTiles(center, R, 400, { snap: true });
        const prunedTiles = tiles.filter((t) => isTileOutsideRadius(t, center, R));
        totalPrunedTiles += prunedTiles.length;
        perComboLog.push(`${center.label}@R${R}: 전체${tiles.length}/프루닝${prunedTiles.length}`);

        const rng = mulberry32(FIXED_SEED ^ (0x1000 + seedOffset));
        seedOffset++;
        for (const tile of prunedTiles) {
          for (let i = 0; i < SAMPLES_PER_TILE; i++) {
            const lat = tile.swLat + rng() * (tile.neLat - tile.swLat);
            const lng = tile.swLng + rng() * (tile.neLng - tile.swLng);
            totalSamples++;
            const d = haversineMeters(center, { lat, lng });
            if (!(d > R)) {
              violations++;
              if (violationDetails.length < 5) {
                violationDetails.push(
                  `${center.label}@R${R} tile=${JSON.stringify(tile)} sample=(${lat.toFixed(6)},${lng.toFixed(6)}) d=${d.toFixed(2)}`,
                );
              }
            }
          }
        }
      }
    }

    assert.strictEqual(
      violations,
      0,
      `프루닝된 타일 내부 표본 중 ${violations}건이 실제로는 반경 이내(정보 손실 발생, isTileOutsideRadius 오판 의심): ${violationDetails.join(' | ')}`,
    );
    assert.ok(
      totalPrunedTiles > 0,
      `${centers.length}x${radii.length}=${centers.length * radii.length} 조합 전부 프루닝 타일이 0개 — 이 오라클이 아무것도 검증하지 못한 채 통과(공허한 검사)`,
    );

    return {
      status: 'PASS',
      detail: `실측 반례A(마진 도입 회귀) 1건(최근접점≈${regressionNearestDist.toFixed(2)}m≤800m→false) + 반례B(등장방형+마진 회귀) 1건(haversine≈${haversineNearestB.toFixed(2)}m≤8000m vs 등장방형≈${equirectNearestB.toFixed(2)}m>8002m인데도 →false) 확인; ${centers.length}x${radii.length}=${centers.length * radii.length} 조합, 프루닝 타일 총 ${totalPrunedTiles}개, 표본 총 ${totalSamples}개(타일당 ${SAMPLES_PER_TILE}) 전부 haversine > R 확인 — ${perComboLog.join('; ')}`,
    };
  },
);

// ─────────────────────────────────────────────────────────────────────────
// D18: 스냅 격자 커버리지 — {snap:true} 격자도 반경 원 내부 표본을 빠짐없이 덮는지
//      (D8의 snap:true 판, 앵커 위도 대역 경계를 걸치는 좌표 포함)
// ─────────────────────────────────────────────────────────────────────────
await runCheck(
  'D18',
  'buildGridTiles({snap:true}): 표본점 전수가 스냅 격자에 포함된다(앵커 대역 경계 포함) + 실측 반례 회귀(축 방향 극단점)',
  async () => {
    const RADIUS_METERS = 1000;
    const EPS = 1e-9;
    const SAMPLE_COUNT = 20000; // 2,000점으로는 축 방향 극단점(측정 0 확률)을 거의 못 뽑아 20,000으로 상향

    // 앵커 대역 경계는 GRID_ANCHOR_DEG로부터 계산한다(하드코딩 금지 — 상수가 바뀌면 자동 추종).
    const COMPANY_LAT = 37.5451;
    const COMPANY_LNG = 127.0554;
    const nearestAnchor = Math.round(COMPANY_LAT / GRID_ANCHOR_DEG) * GRID_ANCHOR_DEG;
    const bandBoundaryLat = nearestAnchor + GRID_ANCHOR_DEG / 2;
    const BOUNDARY_OFFSET_DEG = 0.0005; // ≈55m — 경계 바로 아래/위이면서 반올림 경계 자체의 부동소수 흔들림은 피할 만큼 충분히 떨어진 값
    const belowLat = bandBoundaryLat - BOUNDARY_OFFSET_DEG;
    const aboveLat = bandBoundaryLat + BOUNDARY_OFFSET_DEG;

    // 하드코딩된 실측 반례(적대적 리뷰 발견, 회귀 테스트로 박제).
    // 과거 결함: snap 모드가 radiusLng 를 center.lat 대신 앵커 위도 스케일로 계산해 bbox 가 안쪽으로 줄었다.
    // 정동 800m 지점(haversine≈799.10m, 반경 800m 안)이 스냅 bbox 동단보다 2.4m 바깥이라 커버리지 구멍이었다.
    // 몬테카를로는 원 내부를 균등샘플하므로 "경계에 거의 붙은 축 방향 극단점"을 뽑을 확률이 사실상 0이라
    // 기존 2,000점(심지어 20,000점 몬테카를로로도)으로는 이 결함을 못 잡는다 — 그래서 직접 좌표를 박아 확인한다.
    const REGRESSION_CENTER_D18 = { lat: 37.74457997, lng: 126.90778388 };
    const REGRESSION_RADIUS_D18 = 800;
    const REGRESSION_EAST_LNG_D18 = 126.9168721; // 정동 800m 지점(haversine≈799.10m), 실측값

    const regressionEastDist = haversineMeters(REGRESSION_CENTER_D18, {
      lat: REGRESSION_CENTER_D18.lat,
      lng: REGRESSION_EAST_LNG_D18,
    });
    assert.ok(
      Math.abs(regressionEastDist - 799.1) < 1,
      `실측 반례 픽스처 자체가 어긋남: haversine=${regressionEastDist.toFixed(2)}m 가 기대값 799.10m 근방이 아님(픽스처 오류 의심)`,
    );
    const regressionTiles = buildGridTiles(REGRESSION_CENTER_D18, REGRESSION_RADIUS_D18, 400, { snap: true });
    const regressionCovered = regressionTiles.some(
      (t) =>
        REGRESSION_CENTER_D18.lat >= t.swLat - EPS &&
        REGRESSION_CENTER_D18.lat <= t.neLat + EPS &&
        REGRESSION_EAST_LNG_D18 >= t.swLng - EPS &&
        REGRESSION_EAST_LNG_D18 <= t.neLng + EPS,
    );
    assert.ok(
      regressionCovered,
      `실측 반례(회귀) FAIL: center=${JSON.stringify(REGRESSION_CENTER_D18)}, radius=${REGRESSION_RADIUS_D18} 의 정동 800m 지점(lng=${REGRESSION_EAST_LNG_D18}, haversine≈${regressionEastDist.toFixed(2)}m)이 스냅 격자 어떤 타일에도 안 걸림(커버리지 구멍 재발)`,
    );

    const centers = [
      { lat: 37.5665, lng: 126.978, label: '시청' },
      { lat: COMPANY_LAT, lng: COMPANY_LNG, label: '회사' },
      {
        lat: belowLat,
        lng: COMPANY_LNG,
        label: `경계 아래(lat=${belowLat.toFixed(4)}, anchor=${(Math.round(belowLat / GRID_ANCHOR_DEG) * GRID_ANCHOR_DEG).toFixed(2)})`,
      },
      {
        lat: aboveLat,
        lng: COMPANY_LNG,
        label: `경계 위(lat=${aboveLat.toFixed(4)}, anchor=${(Math.round(aboveLat / GRID_ANCHOR_DEG) * GRID_ANCHOR_DEG).toFixed(2)})`,
      },
      {
        lat: REGRESSION_CENTER_D18.lat,
        lng: REGRESSION_CENTER_D18.lng,
        label: '실측 반례 center(정동 커버리지 구멍 회귀)',
        radius: REGRESSION_RADIUS_D18,
      },
    ];

    let totalUncovered = 0;
    let totalAxisChecked = 0;
    const perCenterLog = [];
    let seedOffset = 0;
    for (const center of centers) {
      const R = center.radius || RADIUS_METERS;
      const tiles = buildGridTiles(center, R, 400, { snap: true });
      assert.ok(Array.isArray(tiles) && tiles.length > 0, `${center.label}: buildGridTiles 결과가 빈 배열/비배열`);

      const lonScale = 111320 * Math.cos((center.lat * Math.PI) / 180);

      // 축 방향 극단점(정동/정서/정북/정남, 반경 경계 직전 0.999R) 명시적 커버리지 확인.
      // 몬테카를로(원 내부 균등샘플)는 이 측정 0 확률 지점을 사실상 못 뽑으므로 별도로 검사한다.
      const AXIS_FACTOR = 0.999;
      const axisPoints = [
        { label: '정동', lat: center.lat, lng: center.lng + (R * AXIS_FACTOR) / lonScale },
        { label: '정서', lat: center.lat, lng: center.lng - (R * AXIS_FACTOR) / lonScale },
        { label: '정북', lat: center.lat + (R * AXIS_FACTOR) / 111320, lng: center.lng },
        { label: '정남', lat: center.lat - (R * AXIS_FACTOR) / 111320, lng: center.lng },
      ];
      for (const ap of axisPoints) {
        const covered = tiles.some(
          (t) => ap.lat >= t.swLat - EPS && ap.lat <= t.neLat + EPS && ap.lng >= t.swLng - EPS && ap.lng <= t.neLng + EPS,
        );
        totalAxisChecked++;
        assert.ok(
          covered,
          `${center.label}(R=${R}) ${ap.label} 축 방향 경계 직전 지점(${ap.lat.toFixed(8)},${ap.lng.toFixed(8)})이 어떤 타일에도 안 걸림(커버리지 구멍)`,
        );
      }

      const rng = mulberry32(FIXED_SEED ^ (0x2000 + seedOffset));
      seedOffset++;
      let uncovered = 0;
      const uncoveredSamples = [];
      for (let i = 0; i < SAMPLE_COUNT; i++) {
        const r = R * Math.sqrt(rng()) * 0.999;
        const theta = rng() * 2 * Math.PI;
        const dx = r * Math.cos(theta);
        const dy = r * Math.sin(theta);
        const lat = center.lat + dy / 111320;
        const lng = center.lng + dx / lonScale;
        const covered = tiles.some(
          (t) => lat >= t.swLat - EPS && lat <= t.neLat + EPS && lng >= t.swLng - EPS && lng <= t.neLng + EPS,
        );
        if (!covered) {
          uncovered++;
          if (uncoveredSamples.length < 5) uncoveredSamples.push({ lat, lng });
        }
      }
      totalUncovered += uncovered;
      perCenterLog.push(
        `${center.label}(R=${R}): 타일${tiles.length}개/표본${SAMPLE_COUNT}개 미포함${uncovered}/축4방향OK${uncovered > 0 ? ` 예:${JSON.stringify(uncoveredSamples)}` : ''}`,
      );
    }

    assert.strictEqual(totalUncovered, 0, `스냅 격자 커버리지 실패: ${perCenterLog.join(' | ')}`);

    return {
      status: 'PASS',
      detail: `실측 반례 1건(정동 800m 지점≈${regressionEastDist.toFixed(2)}m 커버 확인) + center당 축4방향(총 ${totalAxisChecked}건) 명시 확인; ${perCenterLog.join('; ')}`,
    };
  },
);

// ─────────────────────────────────────────────────────────────────────────
// D19: 스냅 격자 캐시 키 재사용 — center 를 100m/300m 옮겨도 tileCacheKey 상당수가 겹치는지
//      (snap:false 대조군 수치를 나란히 기록)
// ─────────────────────────────────────────────────────────────────────────
await runCheck(
  'D19',
  '스냅 격자 캐시 키 재사용: center 이동(100m/300m) 후에도 tileCacheKey 상당수 겹침(snap:false 대조군 병기)',
  async () => {
    const RADIUS = 800; // 반경 1000m→800m 변경 반영
    const centerA = { lat: 37.5451, lng: 127.0554 };
    const shifts = [
      { meters: 100, label: '100m' },
      { meters: 300, label: '300m' },
    ];
    const details = [];

    for (const { meters, label } of shifts) {
      const centerB = { lat: centerA.lat + meters / 111320, lng: centerA.lng };

      const keysA_snap = new Set(buildGridTiles(centerA, RADIUS, 400, { snap: true }).map(tileCacheKey));
      const keysB_snap = new Set(buildGridTiles(centerB, RADIUS, 400, { snap: true }).map(tileCacheKey));
      const intersectSnap = [...keysA_snap].filter((k) => keysB_snap.has(k)).length;
      const minSizeSnap = Math.min(keysA_snap.size, keysB_snap.size);
      const ratioSnap = minSizeSnap > 0 ? intersectSnap / minSizeSnap : 0;

      const keysA_nosnap = new Set(buildGridTiles(centerA, RADIUS, 400, { snap: false }).map(tileCacheKey));
      const keysB_nosnap = new Set(buildGridTiles(centerB, RADIUS, 400, { snap: false }).map(tileCacheKey));
      const intersectNosnap = [...keysA_nosnap].filter((k) => keysB_nosnap.has(k)).length;
      const minSizeNosnap = Math.min(keysA_nosnap.size, keysB_nosnap.size);
      const ratioNosnap = minSizeNosnap > 0 ? intersectNosnap / minSizeNosnap : 0;

      assert.ok(intersectSnap > 0, `${label} 이동: snap:true 교집합이 0(캐시 재사용 전혀 없음)`);
      if (meters === 100) {
        assert.ok(
          ratioSnap > 0.5,
          `100m 이동인데 snap:true 재사용률 ${(ratioSnap * 100).toFixed(1)}% <= 50%(작은 쪽 집합 과반 미만)`,
        );
      }

      details.push(
        `${label} 이동: snap=true 교집합${intersectSnap}/${minSizeSnap}(${(ratioSnap * 100).toFixed(1)}%) vs snap=false 교집합${intersectNosnap}/${minSizeNosnap}(${(ratioNosnap * 100).toFixed(1)}%)`,
      );
    }

    return { status: 'PASS', detail: details.join(' | ') };
  },
);

// ─────────────────────────────────────────────────────────────────────────
// D19b: 앵커 대역 경계 회귀 — 회사 좌표에서 반경 800m 내 어디로 움직여도
//      tileCacheKey 재사용률이 0%로 떨어지지 않는다(GRID_ANCHOR_DEG 축소 회귀 방지).
//      GRID_ANCHOR_DEG=0.1일 때 경계가 회사에서 북쪽 545m에 놓여 도보 반경 안에서
//      재사용률이 0%로 떨어졌던 실측 문제를 박제한 회귀 테스트.
// ─────────────────────────────────────────────────────────────────────────
await runCheck(
  'D19b',
  '앵커 대역 경계 회귀: 회사 좌표 반경 800m 내 임의 이동 시 캐시 재사용률이 0%로 떨어지지 않는다',
  async () => {
    const RADIUS = 800;
    const company = { lat: 37.5451, lng: 127.0554 };
    const keysCompany = new Set(buildGridTiles(company, RADIUS, 400, { snap: true }).map(tileCacheKey));

    const rng = mulberry32(FIXED_SEED ^ 0x19b0);
    const SAMPLE_POINTS = 40;
    const lonScale = 111320 * Math.cos((company.lat * Math.PI) / 180);
    let minRatio = Infinity;
    let minRatioDist = null;
    const zeroReuse = [];

    for (let i = 0; i < SAMPLE_POINTS; i++) {
      const dist = RADIUS * rng(); // 0~800m
      const theta = rng() * 2 * Math.PI;
      const dx = dist * Math.cos(theta);
      const dy = dist * Math.sin(theta);
      const point = { lat: company.lat + dy / 111320, lng: company.lng + dx / lonScale };
      const keysPoint = new Set(buildGridTiles(point, RADIUS, 400, { snap: true }).map(tileCacheKey));
      const intersect = [...keysCompany].filter((k) => keysPoint.has(k)).length;
      const ratio = intersect / Math.min(keysCompany.size, keysPoint.size);
      if (ratio === 0) zeroReuse.push({ dist: dist.toFixed(1), theta: theta.toFixed(3) });
      if (ratio < minRatio) {
        minRatio = ratio;
        minRatioDist = dist;
      }
    }

    assert.strictEqual(
      zeroReuse.length,
      0,
      `회사 반경 ${RADIUS}m 내 이동 ${SAMPLE_POINTS}회 표본 중 캐시 재사용률 0%인 지점 ${zeroReuse.length}건 발견(GRID_ANCHOR_DEG=${GRID_ANCHOR_DEG}): ${JSON.stringify(zeroReuse.slice(0, 5))}`,
    );

    return {
      status: 'PASS',
      detail: `GRID_ANCHOR_DEG=${GRID_ANCHOR_DEG}, 회사 좌표 기준 반경 ${RADIUS}m 내 ${SAMPLE_POINTS}개 표본 전부 캐시 재사용률 > 0%(최소값 ${(minRatio * 100).toFixed(1)}%, dist=${minRatioDist.toFixed(1)}m)`,
    };
  },
);

// ─────────────────────────────────────────────────────────────────────────
// D20: 거리 계산의 기준점 독립 — haversineMeters 가 캐시 재계산 시나리오에서
//      이전 center 값을 새어나오게 하지 않는지 + 알려진 좌표쌍(자오선/적도 상 정확 대원 거리)으로 정확도 검증
// ─────────────────────────────────────────────────────────────────────────
await runCheck(
  'D20',
  'haversineMeters: 기준점 독립(캐시 재계산 시 구 center 값 잔존 없음) + 알려진 좌표쌍 정확도(오차<1%) + 비수치 입력 NaN',
  async () => {
    // (1) 기준점 독립: place 목록을 centerA 기준으로 distance 계산 → 캐시엔 distance를 담지 않는다는 계약을 흉내내
    //     distance를 벗겨낸 뒤 centerB 기준으로 재계산했을 때, centerA 기준값이 새어나오지 않고 centerB haversine과 일치하는지.
    const places = [
      { id: 'x1', lat: 37.5451, lng: 127.0554 },
      { id: 'x2', lat: 37.5665, lng: 126.978 },
      { id: 'x3', lat: 37.4979, lng: 127.0276 },
    ];
    const centerA = { lat: 37.5451, lng: 127.0554 };
    const centerB = { lat: 37.5665, lng: 126.978 };

    const withDistA = places.map((p) => ({ ...p, distance: haversineMeters(centerA, p) }));
    const stripped = withDistA.map(({ distance, ...rest }) => rest); // 캐시 저장 계약(D23) 흉내: distance 미보존
    const withDistB = stripped.map((p) => ({ ...p, distance: haversineMeters(centerB, p) }));

    for (const p of withDistB) {
      const expected = haversineMeters(centerB, { lat: p.lat, lng: p.lng });
      assert.strictEqual(p.distance, expected, `centerB 재계산 불일치(id=${p.id})`);
      const distFromA = withDistA.find((x) => x.id === p.id).distance;
      assert.notStrictEqual(
        p.distance,
        distFromA,
        `centerB 재계산 결과에 centerA 기준 거리값이 그대로 남아있음(재계산 안 됨 의심, id=${p.id})`,
      );
    }

    // (2) 정확도: 자오선(위도 차만 있는) 두 점, 적도(대원 그 자체) 두 점은 haversine 공식과 무관하게
    //     기하학적으로 정확한 대원거리(centralAngle = |Δlat| 또는 |Δlng|)를 analytic 하게 구할 수 있어
    //     "haversineMeters 자기 자신"이 아닌 독립적 정답과 비교 가능하다(순환 검증 회피).
    const EARTH_RADIUS_M = 6371000;
    const knownPairs = [
      {
        label: '자오선 1도(37N→38N, 127E)',
        a: { lat: 37.0, lng: 127.0 },
        b: { lat: 38.0, lng: 127.0 },
        expected: EARTH_RADIUS_M * (Math.PI / 180),
      },
      {
        label: '적도 90도(0,0→0,90) — 지구 둘레의 1/4',
        a: { lat: 0, lng: 0 },
        b: { lat: 0, lng: 90 },
        expected: EARTH_RADIUS_M * (Math.PI / 2),
      },
      {
        label: '자오선 20도(-10S→10N, 50E)',
        a: { lat: -10, lng: 50 },
        b: { lat: 10, lng: 50 },
        expected: EARTH_RADIUS_M * ((20 * Math.PI) / 180),
      },
    ];
    const accuracyDetails = [];
    for (const { label, a, b, expected } of knownPairs) {
      const actual = haversineMeters(a, b);
      const relError = Math.abs(actual - expected) / expected;
      assert.ok(
        relError < 0.01,
        `${label}: haversineMeters=${actual.toFixed(2)}m, 기하학적 정답=${expected.toFixed(2)}m, 오차율=${(relError * 100).toFixed(4)}% (1% 초과)`,
      );
      accuracyDetails.push(`${label}: 오차 ${(relError * 100).toFixed(4)}%`);
    }

    // (3) 비수치 입력 → NaN(임의 좌표로 대체하지 않음)
    const nanCases = [
      { a: { lat: 'a', lng: 127 }, b: { lat: 37, lng: 127 } },
      { a: { lat: 37, lng: undefined }, b: { lat: 37, lng: 127 } },
      { a: { lat: NaN, lng: 127 }, b: { lat: 37, lng: 127 } },
    ];
    for (const { a, b } of nanCases) {
      const result = haversineMeters(a, b);
      assert.ok(Number.isNaN(result), `haversineMeters(${JSON.stringify(a)}, ${JSON.stringify(b)}) → ${result}, NaN이어야 함`);
    }

    return {
      status: 'PASS',
      detail: `기준점 독립 확인(${withDistB.length}건, centerA 값 잔존 없음); 알려진 좌표쌍 3종 정확도<1% 확인(${accuracyDetails.join(', ')}); 비수치 입력 3종 NaN 확인`,
    };
  },
);

// ─────────────────────────────────────────────────────────────────────────
// D21: 위치정보 창작 금지 + 오류 매핑 — normalizeGeoPosition null 계약(8종+ 무효 입력) +
//      describeGeolocationError 코드별 구별 + originLabel 주소 노출 여부
// ─────────────────────────────────────────────────────────────────────────
await runCheck(
  'D21',
  '위치정보 창작 금지 + 오류 매핑: normalizeGeoPosition null 계약 + describeGeolocationError 구별 + originLabel 주소 노출 여부',
  async () => {
    const invalidCases = [
      { label: 'null', input: null },
      { label: 'undefined', input: undefined },
      { label: '{}', input: {} },
      { label: 'coords 없음(최상위에 직접 latitude/longitude)', input: { latitude: 37, longitude: 127 } },
      { label: 'latitude=NaN', input: { coords: { latitude: NaN, longitude: 127 } } },
      { label: 'longitude=Infinity', input: { coords: { latitude: 37, longitude: Infinity } } },
      { label: 'lat=91(범위 밖)', input: { coords: { latitude: 91, longitude: 127 } } },
      { label: 'lng=-181(범위 밖)', input: { coords: { latitude: 37, longitude: -181 } } },
      { label: '문자열 좌표', input: { coords: { latitude: '37.5', longitude: '127.0' } } },
    ];
    const invalidDetails = [];
    for (const { label, input } of invalidCases) {
      let result;
      assert.doesNotThrow(() => {
        result = normalizeGeoPosition(input);
      }, `normalizeGeoPosition(${label}) 에서 throw 발생`);
      assert.strictEqual(
        result,
        null,
        `normalizeGeoPosition(${label}) → ${JSON.stringify(result)}, 정확히 null 이어야 함(임의 좌표 생성 금지)`,
      );
      invalidDetails.push(`${label}→null OK`);
    }

    // accuracy 필드 추가(계약 변경): coords.accuracy 가 유한수면 그대로 보존, 아니면 null.
    // 데스크톱 WiFi/IP 측위는 accuracy 20000(±20km) 도 나오는데 이를 숨기고 "내 위치"로 단정하면
    // 정직 표기 위반이라 값을 그대로 노출해 호출부가 경고할 수 있게 한다(창작 금지의 연장).
    const validCases = [
      {
        label: '정상 좌표(accuracy 없음)',
        input: { coords: { latitude: 37.5451, longitude: 127.0554 } },
        expected: { lat: 37.5451, lng: 127.0554, accuracy: null },
      },
      {
        label: '경계값 lat=90,lng=180(accuracy 없음)',
        input: { coords: { latitude: 90, longitude: 180 } },
        expected: { lat: 90, lng: 180, accuracy: null },
      },
      {
        label: '경계값 lat=-90,lng=-180(accuracy 없음)',
        input: { coords: { latitude: -90, longitude: -180 } },
        expected: { lat: -90, lng: -180, accuracy: null },
      },
      {
        label: 'accuracy=20000(WiFi/IP 측위, ±20km) → 그대로 보존',
        input: { coords: { latitude: 37.5451, longitude: 127.0554, accuracy: 20000 } },
        expected: { lat: 37.5451, lng: 127.0554, accuracy: 20000 },
      },
      {
        label: 'accuracy=0(유효값, null로 바뀌면 안 됨)',
        input: { coords: { latitude: 37.5451, longitude: 127.0554, accuracy: 0 } },
        expected: { lat: 37.5451, lng: 127.0554, accuracy: 0 },
      },
      {
        label: 'accuracy=NaN → null',
        input: { coords: { latitude: 37.5451, longitude: 127.0554, accuracy: NaN } },
        expected: { lat: 37.5451, lng: 127.0554, accuracy: null },
      },
      {
        label: 'accuracy=Infinity → null',
        input: { coords: { latitude: 37.5451, longitude: 127.0554, accuracy: Infinity } },
        expected: { lat: 37.5451, lng: 127.0554, accuracy: null },
      },
      {
        label: "accuracy='20'(문자열) → null",
        input: { coords: { latitude: 37.5451, longitude: 127.0554, accuracy: '20' } },
        expected: { lat: 37.5451, lng: 127.0554, accuracy: null },
      },
    ];
    for (const { label, input, expected } of validCases) {
      const result = normalizeGeoPosition(input);
      assert.deepStrictEqual(result, expected, `normalizeGeoPosition(${label}) 결과 불일치: ${JSON.stringify(result)}`);
    }

    // accuracy 음수는 오차 반경으로 성립하지 않는 값이므로 null 로 정규화된다(무효값 취급).
    // 보존해 두면 저정확도 경고 비교(accuracy > radius)를 항상 통과해 '매우 정확함'으로 둔갑한다.
    // lib/core.js의 normalizeGeoPosition은 `Number.isFinite(coords.accuracy) && coords.accuracy >= 0`
    // 조건으로 음수를 null로 정규화하므로, 아래 기대값(accuracy: null)은 실제 구현과 일치한다.
    const negativeAccuracyResult = normalizeGeoPosition({
      coords: { latitude: 37.5451, longitude: 127.0554, accuracy: -5 },
    });
    assert.deepStrictEqual(
      negativeAccuracyResult,
      { lat: 37.5451, lng: 127.0554, accuracy: null },
      `accuracy=-5 가 null 로 정규화되지 않음: ${JSON.stringify(negativeAccuracyResult)}`,
    );

    // 위/경도가 무효면 accuracy가 멀쩡해도(20000) 전체가 null(부분 좌표 창작 금지).
    const invalidLatWithValidAccuracy = normalizeGeoPosition({
      coords: { latitude: 91, longitude: 127, accuracy: 20000 },
    });
    assert.strictEqual(
      invalidLatWithValidAccuracy,
      null,
      `lat=91(무효)인데 accuracy가 멀쩡하다고 부분 결과를 만듦: ${JSON.stringify(invalidLatWithValidAccuracy)}`,
    );

    const codes = [1, 2, 3, undefined, 999];
    const messages = codes.map((c) => describeGeolocationError(c));
    for (let i = 0; i < messages.length; i++) {
      assert.ok(
        typeof messages[i] === 'string' && messages[i].length > 0,
        `describeGeolocationError(${codes[i]}) 가 비어있지 않은 문자열이 아님`,
      );
      assert.ok(/[가-힣]/.test(messages[i]), `describeGeolocationError(${codes[i]}) 에 한국어 안내가 없음: ${messages[i]}`);
    }
    const uniqueMsgs = new Set(messages.slice(0, 3)); // 1/2/3 은 서로 달라야 함
    assert.strictEqual(uniqueMsgs.size, 3, `describeGeolocationError(1|2|3) 중 동일 문자열이 있음: ${JSON.stringify(messages.slice(0, 3))}`);

    const companyAddr = '서울특별시 성동구 아차산로13길 11';
    const companyLabel = originLabel('company', companyAddr);
    const geoLabel = originLabel('geo', companyAddr);
    assert.ok(companyLabel.includes(companyAddr), `originLabel('company', addr) 에 주소가 없음: ${companyLabel}`);
    assert.ok(
      !geoLabel.includes(companyAddr),
      `originLabel('geo', addr) 에 회사 주소가 노출됨(내 위치 모드인데 거짓 표기): ${geoLabel}`,
    );

    return {
      status: 'PASS',
      detail: `무효입력 ${invalidCases.length}종 전부 null 확인; 유효입력(accuracy 포함) ${validCases.length}종 정확 확인(accuracy=20000 보존, 0 보존, NaN/Infinity/문자열→null); accuracy=-5 → null(오차 반경으로 성립 불가한 값은 무효 처리); lat=91+accuracy=20000 → 전체 null(부분 좌표 창작 금지) 확인; describeGeolocationError(1/2/3/undefined/999) 전부 비지않은 한국어+1·2·3 서로 구별 확인; originLabel company="${companyLabel}" geo="${geoLabel}"(주소 노출 없음)`,
    };
  },
);

// ─────────────────────────────────────────────────────────────────────────
// (C) lib/places.js 캐시 계약 검증 준비 — localStorage/window.kakao 인메모리 스텁으로 동적 import.
// Node 에서 import 자체가 불가능하면(SyntaxError 등) SKIP 으로 정직하게 남긴다.
// ─────────────────────────────────────────────────────────────────────────
function createMemoryLocalStorage() {
  const store = new Map();
  let quotaExceeded = false;
  return {
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    setItem(key, value) {
      // 실제 브라우저의 QuotaExceededError를 흉내낸다 — lib/places.js의 writeJson은 이걸 흡수하고
      // 경고만 남긴 채 계속 진행해야 한다(캐시 저장 실패가 수집 자체를 실패시키면 안 된다).
      if (quotaExceeded) {
        const err = new Error('QuotaExceededError(mock)');
        err.name = 'QuotaExceededError';
        throw err;
      }
      store.set(key, String(value));
    },
    removeItem(key) {
      store.delete(key);
    },
    clear() {
      store.clear();
    },
    setQuotaExceeded(value) {
      quotaExceeded = value;
    },
  };
}

// shouldFail(callIndexZeroBased, options): 참을 반환하면 그 호출을 SEARCH_FAILED로 실패시킨다.
// respond(options, callIndex): 지정하면 shouldFail/dummyPlaces 대신 {data, status, hasNextPage}를 직접 결정한다
// (다중 페이지·ZERO_RESULT 타일 등 categorySearchPage 루프 세부 경로를 테스트할 때 씀).
// geocode: {status:'OK', x, y}면 성공 응답, 그 외/미지정이면 항상 ZERO_RESULT(기존 기본 동작 유지).
// 모든 타일의 categorySearch는 동기적으로 시작되므로(콜백만 setTimeout(0)으로 지연) 호출 순번은
// 호출부(tiles.map 등)의 배열 순서와 항상 일치한다 — 부분 실패(D26) 시나리오를 결정적으로 구성하는 데 쓴다.
function createMockKakaoSdk({ dummyPlaces, shouldFail, respond, geocode } = {}) {
  let callCount = 0;
  let geocodeCallCount = 0;
  const calls = [];
  const geocodeCalls = [];
  const STATUS = { OK: 'OK', ZERO_RESULT: 'ZERO_RESULT', ERROR: 'ERROR' };
  const kakao = {
    maps: {
      LatLng: function (lat, lng) {
        this.lat = lat;
        this.lng = lng;
      },
      LatLngBounds: function (sw, ne) {
        this.sw = sw;
        this.ne = ne;
      },
      services: {
        Status: STATUS,
        Places: function () {
          this.categorySearch = (code, callback, options) => {
            const callIndex = callCount;
            callCount++;
            calls.push({ code, options, callIndex });
            // 실제 SDK처럼 비동기(마이크로태스크 이후)로 콜백 — 동시 호출(in-flight dedupe) 시나리오 재현에 필요.
            setTimeout(() => {
              if (typeof respond === 'function') {
                const r = respond(options, callIndex);
                callback(r.data, r.status, r.status === STATUS.OK ? { hasNextPage: !!r.hasNextPage } : null);
                return;
              }
              const fail = typeof shouldFail === 'function' && shouldFail(callIndex, options);
              if (fail) {
                callback(null, STATUS.ERROR, null);
              } else {
                callback(dummyPlaces, STATUS.OK, { hasNextPage: false });
              }
            }, 0);
          };
        },
        Geocoder: function () {
          this.addressSearch = (address, callback) => {
            geocodeCallCount++;
            geocodeCalls.push(address);
            setTimeout(() => {
              if (geocode && geocode.status === 'OK') {
                callback([{ x: geocode.x, y: geocode.y, address_name: address }], STATUS.OK);
              } else {
                callback([], STATUS.ZERO_RESULT);
              }
            }, 0);
          };
        },
      },
    },
  };
  return {
    kakao,
    getCallCount: () => callCount,
    getCalls: () => calls,
    getGeocodeCallCount: () => geocodeCallCount,
    getGeocodeCalls: () => geocodeCalls,
  };
}

function createMockDocument() {
  const appendedScripts = [];
  const head = {
    appendChild(el) {
      el.parentNode = head; // 실제 DOM처럼 부모를 붙여야 script.onerror의 parentNode.removeChild 경로를 검증 가능
      appendedScripts.push(el);
    },
    removeChild(el) {
      const idx = appendedScripts.indexOf(el);
      if (idx >= 0) appendedScripts.splice(idx, 1);
      el.parentNode = null;
    },
  };
  return {
    appendedScripts,
    createElement() {
      return { src: '', onload: null, onerror: null, parentNode: null };
    },
    head,
  };
}

const DUMMY_PLACES = [
  {
    id: 'kp1',
    place_name: '테스트식당1',
    category_name: '음식점 > 한식 > 백반',
    x: '127.0554',
    y: '37.5455',
    place_url: 'https://place.map.kakao.com/kp1',
    road_address_name: '서울 성동구 어딘가1',
  },
  {
    id: 'kp2',
    place_name: '테스트식당2',
    category_name: '음식점 > 중식 > 짜장면',
    x: '127.0556',
    y: '37.5450',
    place_url: 'https://place.map.kakao.com/kp2',
    road_address_name: '서울 성동구 어딘가2',
  },
];

let placesModule = null;
let placesSkipReason = '';
let localStorageStub = null;
try {
  localStorageStub = createMemoryLocalStorage();
  globalThis.localStorage = localStorageStub;
  globalThis.window = globalThis.window || {};
  globalThis.window.kakao = createMockKakaoSdk({ dummyPlaces: DUMMY_PLACES }).kakao;
  const placesPath = path.join(REPO_ROOT, 'lib', 'places.js');
  if (!existsSync(placesPath)) {
    placesSkipReason = 'lib/places.js 아직 없음(병렬 작성 중)';
  } else {
    placesModule = await import(pathToFileURL(placesPath).href);
  }
} catch (err) {
  placesSkipReason = `lib/places.js Node import 실패: ${err && err.message ? err.message : String(err)}`;
  placesModule = null;
}

// ─────────────────────────────────────────────────────────────────────────
// D22: 타일 캐시 정합성 — 같은 (center,radius) 재호출 시 searchCalls=0/fetchedTiles=0,
//      id 집합 동일, 모의 SDK 실제 호출 카운트도 늘지 않음.
// ─────────────────────────────────────────────────────────────────────────
await runCheck(
  'D22',
  'lib/places.js collectCandidates: 타일 캐시 정합성(재호출 시 searchCalls=0, id 집합 동일, 모의 SDK 재호출 없음)',
  async () => {
    if (!placesModule) return { status: 'SKIP', detail: placesSkipReason };
    const { collectCandidates, clearTileCache } = placesModule;

    clearTileCache();
    localStorageStub.clear();
    const mock = createMockKakaoSdk({ dummyPlaces: DUMMY_PLACES });
    globalThis.window.kakao = mock.kakao;

    const center = { lat: 37.5451, lng: 127.0554 };
    const radius = 100;
    const config = {};

    const first = await collectCandidates(center, radius, config);
    const callCountAfterFirst = mock.getCallCount();
    assert.ok(callCountAfterFirst > 0, '첫 호출인데 모의 SDK가 한 번도 호출되지 않음(테스트 설계 문제 의심)');
    assert.ok(first.fetchedTiles > 0, '첫 호출인데 fetchedTiles=0');
    assert.ok(first.list.length > 0, '첫 호출 결과가 비어있음(더미 place가 반경/필터를 통과하지 못함, 테스트 설계 문제 의심)');

    const second = await collectCandidates(center, radius, config);
    assert.strictEqual(second.searchCalls, 0, `두 번째 호출 searchCalls=${second.searchCalls}, 0이어야 함(캐시 히트)`);
    assert.strictEqual(second.fetchedTiles, 0, `두 번째 호출 fetchedTiles=${second.fetchedTiles}, 0이어야 함`);
    assert.strictEqual(
      mock.getCallCount(),
      callCountAfterFirst,
      `두 번째 호출에서 모의 SDK 호출 카운트가 늘어남(캐시 미스 의심): ${callCountAfterFirst}→${mock.getCallCount()}`,
    );

    const idsA = first.list.map((p) => p.id).sort();
    const idsB = second.list.map((p) => p.id).sort();
    assert.deepStrictEqual(idsB, idsA, `두 호출의 id 집합이 다름: ${JSON.stringify(idsA)} vs ${JSON.stringify(idsB)}`);

    // categorySearch 호출 옵션에서 location이 제거됐는지 확인(구현 변경 — bounds와 함께 location을 넘기면
    // 정렬에 영향을 줘 캐시(키는 center 독립)가 요청 center에 암묵적으로 의존하게 되는 오염 경로였다).
    const callsSoFar = mock.getCalls();
    assert.ok(callsSoFar.length > 0, 'mock.getCalls() 가 비어있음(테스트 설계 문제 의심)');
    for (const call of callsSoFar) {
      assert.ok(
        call.options && typeof call.options === 'object',
        'categorySearch 옵션이 객체가 아님',
      );
      assert.ok(
        !Object.prototype.hasOwnProperty.call(call.options, 'location'),
        `categorySearch 옵션에 location이 남아있음(캐시 오염 경로 재발 의심): ${JSON.stringify(Object.keys(call.options))}`,
      );
      assert.ok(
        Object.prototype.hasOwnProperty.call(call.options, 'bounds'),
        'categorySearch 옵션에 bounds가 없음',
      );
    }

    return {
      status: 'PASS',
      detail: `1차 호출 fetchedTiles=${first.fetchedTiles}/searchCalls=${first.searchCalls}(모의SDK호출${callCountAfterFirst}회), 2차 searchCalls=0/fetchedTiles=0/SDK호출증가없음, id집합 동일(${JSON.stringify(idsA)}); categorySearch 옵션 ${callsSoFar.length}건 전부 location 없음/bounds 있음 확인`,
    };
  },
);

// ─────────────────────────────────────────────────────────────────────────
// D23: 캐시 스키마에 distance 미저장 + center 변경 시 재계산(구 center 값 잔존 없음)
// ─────────────────────────────────────────────────────────────────────────
await runCheck(
  'D23',
  'lib/places.js: 타일 캐시 스키마에 distance 미저장 + center 변경 시 list.distance 재계산(구 center 값 잔존 없음)',
  async () => {
    if (!placesModule) return { status: 'SKIP', detail: placesSkipReason };
    const { collectCandidates, clearTileCache } = placesModule;

    clearTileCache();
    localStorageStub.clear();
    const mock = createMockKakaoSdk({ dummyPlaces: DUMMY_PLACES });
    globalThis.window.kakao = mock.kakao;

    const centerA = { lat: 37.5451, lng: 127.0554 };
    const radius = 100;
    const resultA = await collectCandidates(centerA, radius, {});
    assert.ok(resultA.list.length > 0, 'centerA 결과가 비어있음(테스트 설계 문제 의심)');

    const rawCacheStr = localStorageStub.getItem('lunch_tiles_v1');
    assert.ok(rawCacheStr, 'lunch_tiles_v1 캐시가 저장되지 않음');
    const rawCache = JSON.parse(rawCacheStr);
    let checkedEntries = 0;
    for (const key of Object.keys(rawCache)) {
      const entry = rawCache[key];
      assert.ok(Array.isArray(entry.places), `캐시 엔트리 ${key}.places 가 배열이 아님`);
      for (const place of entry.places) {
        assert.ok(
          !Object.prototype.hasOwnProperty.call(place, 'distance'),
          `캐시된 place(id=${place.id})에 distance 키가 존재함(기준점 오염 위험): ${JSON.stringify(place)}`,
        );
        checkedEntries++;
      }
    }
    assert.ok(checkedEntries > 0, '검사할 캐시 place 엔트리가 0개(테스트 설계 문제 의심)');

    // center 변경 — 반환된 list의 distance가 새 center 기준으로 재계산됐는지(구 center 값 잔존 없음).
    // centerB는 centerA에서 북쪽으로 60m만 옮긴 지점: 시청처럼 멀리 옮기면 더미 place가 radius=100m
    // 밖으로 나가 resultB.list가 비어버려 아래 재계산 검증 루프 자체가 공회전한다(공허 검사 방지).
    // 60m로도 kp1/kp2의 centerA/centerB 기준 거리값이 충분히 달라(15m대 vs 44m대 등) notStrictEqual이 유의미하다.
    const centerB = { lat: centerA.lat + 60 / 111320, lng: centerA.lng };
    const resultB = await collectCandidates(centerB, radius, {});
    assert.ok(resultB.list.length > 0, 'centerB 결과가 비어있음(재계산 검증 루프가 공회전, 테스트 설계 문제 의심)');
    for (const place of resultB.list) {
      const expected = haversineMeters(centerB, { lat: place.lat, lng: place.lng });
      assert.strictEqual(
        place.distance,
        expected,
        `centerB 재계산 불일치(id=${place.id}): actual=${place.distance}, expected=${expected}`,
      );
      const staleA = haversineMeters(centerA, { lat: place.lat, lng: place.lng });
      assert.notStrictEqual(place.distance, staleA, `centerB 결과에 centerA 기준 거리값이 남아있음(id=${place.id})`);
    }

    return {
      status: 'PASS',
      detail: `캐시 place 엔트리 ${checkedEntries}개 전부 distance 키 없음 확인; centerB(${resultB.list.length}건) distance 전부 centerB haversine과 일치, centerA 잔존값 없음 확인`,
    };
  },
);

// ─────────────────────────────────────────────────────────────────────────
// D24: TTL 만료 시 재수집 + 동시 호출(await 없이 2회) in-flight dedupe
// ─────────────────────────────────────────────────────────────────────────
await runCheck(
  'D24',
  'lib/places.js: TTL 만료 시 재수집 + in-flight dedupe(동시 호출 시 SDK 중복호출 없음)',
  async () => {
    if (!placesModule) return { status: 'SKIP', detail: placesSkipReason };
    const { collectCandidates, clearTileCache, TILE_CACHE_TTL_MS } = placesModule;

    // lib/places.js가 export하는 실제 TTL 상수를 이후 검증(만료 시각 계산 등) 전체에서 쓴다 —
    // 하드코딩하면 상수가 바뀔 때 테스트만 낡은 값으로 남아 드리프트가 생긴다(도움말 문구가 상수를
    // 직접 읽는 것과 같은 이유). 아래 21600000(=6시간) 자체는 **의도적으로 박제한 값**이다 — TTL은
    // "캐시가 최대 몇 시간 묵을 수 있는가"라는 사용자 체감 동작이라, 6시간이 아닌 다른 값으로 바뀌면
    // 그건 조용히 지나칠 변경이 아니라 사람이 의식적으로 검토해야 할 변경이다. TTL을 의도적으로 조정할
    // 때는 이 리터럴도 함께 갱신해라(실패하면 그게 신호다) — 드리프트 방지 목적과 모순되지 않는다.
    assert.strictEqual(typeof TILE_CACHE_TTL_MS, 'number', 'lib/places.js가 TILE_CACHE_TTL_MS를 number로 export하지 않음');
    assert.strictEqual(
      TILE_CACHE_TTL_MS,
      21600000,
      `TILE_CACHE_TTL_MS 값이 6시간(21600000ms)이 아님(${TILE_CACHE_TTL_MS}) — 의도적 변경이면 이 리터럴도 함께 갱신, 아니면 회귀`,
    );

    // isFreshTileCache 자체 계약(순수함수) 확인
    const freshEntry = { ts: Date.now(), places: [] };
    assert.strictEqual(isFreshTileCache(freshEntry, Date.now(), TILE_CACHE_TTL_MS), true, 'isFreshTileCache: 방금 쓴 엔트리가 fresh 아님');
    const staleEntry = { ts: Date.now() - TILE_CACHE_TTL_MS - 1000, places: [] };
    assert.strictEqual(
      isFreshTileCache(staleEntry, Date.now(), TILE_CACHE_TTL_MS),
      false,
      'isFreshTileCache: TTL 초과 엔트리가 fresh로 판정됨',
    );

    // (1) TTL 만료 → 재수집
    clearTileCache();
    localStorageStub.clear();
    const mockA = createMockKakaoSdk({ dummyPlaces: DUMMY_PLACES });
    globalThis.window.kakao = mockA.kakao;

    const centerTtl = { lat: 37.5451, lng: 127.0554 };
    const radiusTtl = 100;
    const firstTtl = await collectCandidates(centerTtl, radiusTtl, {});
    const callsAfterFirst = mockA.getCallCount();
    assert.ok(firstTtl.fetchedTiles > 0, 'TTL 시나리오 1차 호출인데 fetchedTiles=0');

    const cacheRaw = JSON.parse(localStorageStub.getItem('lunch_tiles_v1'));
    const pastTs = Date.now() - TILE_CACHE_TTL_MS - 60000; // TTL + 1분 초과로 강제 만료
    for (const key of Object.keys(cacheRaw)) cacheRaw[key].ts = pastTs;
    localStorageStub.setItem('lunch_tiles_v1', JSON.stringify(cacheRaw));

    const secondTtl = await collectCandidates(centerTtl, radiusTtl, {});
    assert.ok(secondTtl.fetchedTiles > 0, `캐시 ts를 TTL 밖으로 밀었는데 재수집(fetchedTiles)이 0`);
    assert.ok(
      mockA.getCallCount() > callsAfterFirst,
      `만료 후 재호출인데 모의 SDK 호출 횟수가 늘지 않음(${callsAfterFirst}→${mockA.getCallCount()})`,
    );

    // (2) in-flight dedupe: 같은 (center,radius) 를 await 없이 동시 2회 호출 → 단독 1회 호출과 SDK 호출 수가 같아야 함
    clearTileCache();
    localStorageStub.clear();
    const mockB = createMockKakaoSdk({ dummyPlaces: DUMMY_PLACES });
    globalThis.window.kakao = mockB.kakao;

    const centerDedupe = { lat: 37.5561, lng: 127.0011 };
    const radiusDedupe = 100;
    const p1 = collectCandidates(centerDedupe, radiusDedupe, {});
    const p2 = collectCandidates(centerDedupe, radiusDedupe, {}); // await 없이 곧바로 두 번째 호출(동시 진입)
    const [r1, r2] = await Promise.all([p1, p2]);
    const dedupeCallCount = mockB.getCallCount();

    clearTileCache();
    localStorageStub.clear();
    const mockSolo = createMockKakaoSdk({ dummyPlaces: DUMMY_PLACES });
    globalThis.window.kakao = mockSolo.kakao;
    await collectCandidates(centerDedupe, radiusDedupe, {});
    const soloCallCount = mockSolo.getCallCount();

    assert.strictEqual(
      dedupeCallCount,
      soloCallCount,
      `동시 2회 호출의 모의 SDK 호출 수(${dedupeCallCount})가 단독 1회 호출 기준(${soloCallCount})과 다름(in-flight dedupe 실패 의심)`,
    );
    assert.deepStrictEqual(
      r1.list.map((p) => p.id).sort(),
      r2.list.map((p) => p.id).sort(),
      '동시 호출 두 결과의 id 집합이 다름',
    );

    return {
      status: 'PASS',
      detail: `isFreshTileCache fresh/stale 2건 확인; TTL: 1차 fetchedTiles=${firstTtl.fetchedTiles}(SDK호출${callsAfterFirst}) → ts 강제만료 후 2차 fetchedTiles=${secondTtl.fetchedTiles}(SDK호출${mockA.getCallCount()}, 증가확인); in-flight dedupe: 동시2호출 SDK호출=${dedupeCallCount} == 단독기준 ${soloCallCount}`,
    };
  },
);

// ─────────────────────────────────────────────────────────────────────────
// D25: evictOldestTiles — 신규 순수함수 중 오라클 참조가 0건이던 캐시 용량 보호 함수(localStorage 용량 초과 방지).
// ─────────────────────────────────────────────────────────────────────────
await runCheck(
  'D25',
  'evictOldestTiles: maxEntries 3분기 + ts 없음/비수치 취급 + 동률 ts + 원본 불변 + 상위 N 정확성',
  async () => {
    // (1) keys.length < maxEntries → 전체 보존(다만 컨테이너는 새 객체)
    const under = { a: { ts: 10 }, b: { ts: 20 } };
    const underResult = evictOldestTiles(under, 5);
    assert.deepStrictEqual(underResult, under, 'keys<maxEntries인데 전체 보존 안 됨');
    assert.notStrictEqual(underResult, under, 'keys<maxEntries인데 원본과 같은 컨테이너 참조를 반환함(불변 계약 위반)');

    // (2) keys.length === maxEntries → 전체 보존
    const exact = { a: { ts: 10 }, b: { ts: 20 }, c: { ts: 30 } };
    const exactResult = evictOldestTiles(exact, 3);
    assert.deepStrictEqual(exactResult, exact, 'keys===maxEntries인데 전체 보존 안 됨');
    assert.notStrictEqual(exactResult, exact, 'keys===maxEntries인데 원본과 같은 컨테이너 참조를 반환함');

    // (3) keys.length > maxEntries → ts 큰 순 상위 N개만 남는다
    const overOriginalSnapshot = { a: { ts: 10 }, b: { ts: 50 }, c: { ts: 30 }, d: { ts: 40 }, e: { ts: 20 } };
    const over = { a: { ts: 10 }, b: { ts: 50 }, c: { ts: 30 }, d: { ts: 40 }, e: { ts: 20 } };
    const overResult = evictOldestTiles(over, 3);
    const overKeys = Object.keys(overResult).sort();
    assert.deepStrictEqual(
      overKeys,
      ['b', 'c', 'd'],
      `상위 3(ts 큰 순 b=50,d=40,c=30)이 정확히 남아야 하는데 ${JSON.stringify(overKeys)}`,
    );
    assert.strictEqual(Object.keys(overResult).length, 3, 'over 케이스인데 결과 엔트리 수가 3이 아님');

    // (4) maxEntries <= 0 → 빈 객체
    assert.deepStrictEqual(evictOldestTiles(over, 0), {}, 'maxEntries=0인데 빈 객체가 아님');
    assert.deepStrictEqual(evictOldestTiles(over, -1), {}, 'maxEntries=-1인데 빈 객체가 아님');

    // (5) ts가 없거나 비수치인 엔트리는 가장 오래된 것으로 취급되어 먼저 제거된다
    const withBadTs = {
      good1: { ts: 100 },
      good2: { ts: 90 },
      noTs: {}, // ts 필드 자체가 없음
      nanTs: { ts: NaN },
      good3: { ts: 80 },
    };
    const badTsResult = evictOldestTiles(withBadTs, 3);
    const badTsKeys = Object.keys(badTsResult).sort();
    assert.deepStrictEqual(
      badTsKeys,
      ['good1', 'good2', 'good3'],
      `ts 없음/NaN 엔트리가 가장 먼저 제거돼야 하는데 ${JSON.stringify(badTsKeys)}`,
    );

    // (6) ts 동일값이 여럿이어도 결과 수는 정확해야 하고, 동률이 아닌 확실한 상위값(top)은
    //     동률 처리 로직 때문에 밀려나면 안 된다.
    const tiedTs = { x: { ts: 50 }, y: { ts: 50 }, z: { ts: 50 }, top: { ts: 100 } };
    const tiedResult = evictOldestTiles(tiedTs, 2);
    const tiedKeys = Object.keys(tiedResult);
    assert.strictEqual(tiedKeys.length, 2, `동률 ts 케이스인데 결과 엔트리 수가 2가 아님(${tiedKeys.length})`);
    assert.ok(tiedKeys.includes('top'), `ts=100(최댓값, 비동률)이 동률 처리 때문에 밀려남: ${JSON.stringify(tiedKeys)}`);

    // (7) 원본 객체 불변: (3)에서 호출한 뒤에도 원본 cacheMap 이 그대로인지, 결과가 새 컨테이너인지
    assert.deepStrictEqual(over, overOriginalSnapshot, 'evictOldestTiles 호출 후 원본 cacheMap 이 변형됨(불변 계약 위반)');
    assert.notStrictEqual(overResult, over, 'over 케이스인데 결과 컨테이너가 원본과 같은 참조(새 객체 아님)');

    return {
      status: 'PASS',
      detail: `keys<max 전체보존(컨테이너만 새 객체), keys===max 전체보존, keys>max 상위3개(${JSON.stringify(overKeys)}) 정확, maxEntries<=0(0/-1) 빈객체, ts없음/NaN 우선제거 확인, 동률ts 2건 유지(top 생존), 원본 불변 확인`,
    };
  },
);

// ─────────────────────────────────────────────────────────────────────────
// D26: Promise.allSettled 부분 실패 — 타일 일부가 실패해도 성공분은 캐시에 적재되고,
//      재시도 시 실패했던 타일만 다시 요청한다(구현 변경: Promise.all → Promise.allSettled).
// ─────────────────────────────────────────────────────────────────────────
await runCheck(
  'D26',
  'lib/places.js collectCandidates: Promise.allSettled 부분 실패 시 성공 타일은 캐시 적재, 재시도는 실패분만 재요청',
  async () => {
    if (!placesModule) return { status: 'SKIP', detail: placesSkipReason };
    const { collectCandidates, clearTileCache } = placesModule;

    clearTileCache();
    localStorageStub.clear();

    const center = { lat: 37.5451, lng: 127.0554 };
    const radius = 300;

    // 사전 확인: 이 (center,radius) 조합에서 프루닝 후 살아남는 타일이 2개 이상인지(부분 실패 시나리오 전제).
    const survivingTiles = buildGridTiles(center, radius, 400, { snap: true }).filter(
      (t) => !isTileOutsideRadius(t, center, radius),
    );
    assert.ok(
      survivingTiles.length >= 2,
      `테스트 전제 불성립: radius=${radius}에서 프루닝 후 살아남는 타일이 ${survivingTiles.length}개(2개 이상 필요, 부분 실패 시나리오 구성 불가)`,
    );

    // 첫 번째로 시작되는 categorySearch 호출(=tiles 배열의 첫 원소)만 실패시킨다. 모든 타일의 categorySearch는
    // 동기적으로 시작되고(콜백만 setTimeout(0)으로 지연) tiles.map 순서대로 호출되므로 호출 순번이 배열 순서와 같다.
    const mockFail = createMockKakaoSdk({
      dummyPlaces: DUMMY_PLACES,
      shouldFail: (callIndex) => callIndex === 0,
    });
    globalThis.window.kakao = mockFail.kakao;

    let firstError = null;
    try {
      await collectCandidates(center, radius, {});
    } catch (err) {
      firstError = err;
    }
    assert.ok(
      firstError instanceof Error,
      '일부 타일이 실패했는데 collectCandidates가 reject 하지 않음(allSettled 실패 전파 안 됨)',
    );

    // ① 성공한 타일들은 실패를 던지기 전에 이미 캐시에 적재돼야 한다.
    const rawCacheAfterFailure = JSON.parse(localStorageStub.getItem('lunch_tiles_v1') || '{}');
    const cachedAfterFailure = Object.keys(rawCacheAfterFailure).length;
    assert.strictEqual(
      cachedAfterFailure,
      survivingTiles.length - 1,
      `① 실패 1개를 제외한 성공 타일(${survivingTiles.length - 1}개)만 캐시에 남아야 하는데 ${cachedAfterFailure}개`,
    );

    // ② 재시도: 실패 없는 새 mock으로 교체 — 이전에 캐시된 성공 타일은 재호출하지 않고,
    //    실패했던 1개 타일만 재요청돼야 한다.
    const mockRetry = createMockKakaoSdk({ dummyPlaces: DUMMY_PLACES });
    globalThis.window.kakao = mockRetry.kakao;

    const retryResult = await collectCandidates(center, radius, {});
    assert.strictEqual(
      mockRetry.getCallCount(),
      1,
      `② 재시도 시 실패했던 1개 타일만 재요청돼야 하는데 모의 SDK 호출 ${mockRetry.getCallCount()}회(캐시된 성공 타일까지 다시 부름)`,
    );
    assert.strictEqual(retryResult.fetchedTiles, 1, `재시도 fetchedTiles가 1이 아님(${retryResult.fetchedTiles})`);
    assert.strictEqual(
      retryResult.cachedTiles,
      survivingTiles.length - 1,
      `재시도 cachedTiles가 이전 성공분(${survivingTiles.length - 1})과 다름(${retryResult.cachedTiles})`,
    );

    const rawCacheAfterRetry = JSON.parse(localStorageStub.getItem('lunch_tiles_v1'));
    assert.strictEqual(
      Object.keys(rawCacheAfterRetry).length,
      survivingTiles.length,
      `재시도 후 캐시 엔트리 수가 전체 타일 수(${survivingTiles.length})와 다름(${Object.keys(rawCacheAfterRetry).length})`,
    );

    return {
      status: 'PASS',
      detail: `살아남은 타일 ${survivingTiles.length}개 중 1개 실패 → collectCandidates reject 확인, 성공 ${survivingTiles.length - 1}개 캐시 적재 확인; 재시도 시 모의SDK호출=1(실패분만)/fetchedTiles=1/cachedTiles=${survivingTiles.length - 1}, 캐시 총 ${survivingTiles.length}개로 완성 확인`,
    };
  },
);

// ─────────────────────────────────────────────────────────────────────────
// D27: SDK 싱글턴 — autoload=false 스텁 구간(kakao.maps 는 있고 services 는 없음)에서
//      두 번째 호출자가 불완전한 kakao로 즉시 resolve 되지 않는지(탭3 영구 사망 회귀 방지).
// ─────────────────────────────────────────────────────────────────────────
await runCheck(
  'D27',
  'lib/places.js loadKakaoSdk: services 없는 kakao.maps 스텁 상태에서 즉시 resolve 되지 않음(대조군: services 있으면 즉시 resolve)',
  async () => {
    if (!placesModule) return { status: 'SKIP', detail: placesSkipReason };
    // loadKakaoSdk의 in-flight 상태(sdkPromise)는 모듈 스코프 비공개 변수라, 캐시 버스팅 쿼리로
    // 새 모듈 인스턴스를 import해 "막 시작된 상태(sdkPromise=null)"를 격리해서 재현한다.
    const placesPath = path.join(REPO_ROOT, 'lib', 'places.js');
    let freshA;
    let freshB;
    try {
      freshA = await import(`${pathToFileURL(placesPath).href}?d27a=${Date.now()}`);
      freshB = await import(`${pathToFileURL(placesPath).href}?d27b=${Date.now()}`);
    } catch (err) {
      return { status: 'SKIP', detail: `격리된 모듈 인스턴스 재import 실패: ${err && err.message ? err.message : String(err)}` };
    }

    // (1) services 없음(autoload=false 스텁 구간) → 즉시 resolve 되면 안 됨, 새 <script> 로 재시도해야 함.
    const mockDocA = createMockDocument();
    globalThis.document = mockDocA;
    globalThis.window.kakao = { maps: { load: () => {} } }; // services 없음

    const pendingPromise = freshA.loadKakaoSdk('test-app-key-a');
    assert.strictEqual(
      mockDocA.appendedScripts.length,
      1,
      'services 없는 kakao.maps 스텁 상태인데 새 <script> 태그를 안 만듦(즉시 resolve 분기로 샌 것으로 의심)',
    );

    let settled = false;
    let settledValue;
    pendingPromise.then((v) => {
      settled = true;
      settledValue = v;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.strictEqual(
      settled,
      false,
      `services 없는 window.kakao.maps 상태인데 프로미스가 즉시 resolve됨(값=${JSON.stringify(settledValue)}) — 구버전 "탭3 영구 사망" 버그 재발 의심`,
    );

    // (2) 대조군: services 있음 → 새 <script> 없이 즉시 resolve(불필요한 재로드 없음).
    const mockDocB = createMockDocument();
    globalThis.document = mockDocB;
    globalThis.window.kakao = { maps: { load: () => {}, services: {} } };

    const resolvedPromise = freshB.loadKakaoSdk('test-app-key-b');
    let settled2 = false;
    let settledValue2;
    resolvedPromise.then((v) => {
      settled2 = true;
      settledValue2 = v;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.strictEqual(mockDocB.appendedScripts.length, 0, 'services 있는데도 새 <script> 태그를 만듦(불필요한 재로드)');
    assert.strictEqual(settled2, true, 'services 있는데 즉시 resolve 되지 않음');
    assert.strictEqual(settledValue2, globalThis.window.kakao, 'services 있는 경로에서 resolve 값이 window.kakao가 아님');

    // (3) script.onerror 경로: 실패한 <script> 태그를 정리(parentNode.removeChild)하고,
    //     이후 재시도(새 loadKakaoSdk 호출)가 다시 새 <script> 를 만들 수 있는지(영구 사망 아님).
    let freshC;
    try {
      freshC = await import(`${pathToFileURL(placesPath).href}?d27c=${Date.now()}`);
    } catch (err) {
      return { status: 'SKIP', detail: `격리된 모듈 인스턴스(C) 재import 실패: ${err && err.message ? err.message : String(err)}` };
    }
    const mockDocC = createMockDocument();
    globalThis.document = mockDocC;
    globalThis.window.kakao = undefined;

    const failingPromise = freshC.loadKakaoSdk('test-app-key-c');
    assert.strictEqual(mockDocC.appendedScripts.length, 1, 'onerror 시나리오 사전조건: script가 1개 생성돼야 함');
    const failedScript = mockDocC.appendedScripts[0];
    assert.ok(failedScript.parentNode, 'appendChild 후 script.parentNode가 없음(스텁 결함, onerror의 removeChild 경로를 검증할 수 없음)');

    let failingRejected = false;
    let failingError = null;
    failingPromise.catch((err) => {
      failingRejected = true;
      failingError = err;
    });
    failedScript.onerror(); // 실제 SDK 로드 실패(네트워크 오류 등) 시뮬레이션
    await new Promise((resolve) => setTimeout(resolve, 0));

    assert.strictEqual(failingRejected, true, 'script.onerror 호출 후에도 loadKakaoSdk 프로미스가 reject 되지 않음');
    assert.ok(failingError instanceof Error, `reject된 값이 Error가 아님: ${String(failingError)}`);
    assert.strictEqual(
      mockDocC.appendedScripts.length,
      0,
      'script.onerror 후 실패한 <script> 태그가 정리(parentNode.removeChild)되지 않음(head에 계속 누적)',
    );

    // 재시도: sdkPromise가 reject 시 null로 리셋되므로, 같은 모듈 인스턴스에서 다시 호출하면 새 <script>가 생겨야 한다.
    globalThis.window.kakao = { maps: { load: () => {}, services: {} } };
    const retryPromise = freshC.loadKakaoSdk('test-app-key-c-retry');
    let retrySettled = false;
    retryPromise.then(() => {
      retrySettled = true;
    });
    await new Promise((resolve) => setTimeout(resolve, 0));
    assert.strictEqual(retrySettled, true, '로드 실패 후 재시도인데도 즉시 resolve(services 있음)되지 않음');
    assert.strictEqual(
      mockDocC.appendedScripts.length,
      0,
      '재시도가 services 있는 window.kakao를 못 보고 불필요한 새 <script>를 또 만듦',
    );

    return {
      status: 'PASS',
      detail: 'services 없음: script 신규생성 + 마이크로태스크 flush 후에도 pending 유지 확인; services 있음(대조군): script 미생성 + 즉시 resolve(window.kakao 그대로) 확인; script.onerror: reject 확인 + parentNode.removeChild로 정리 확인 + 재시도 시 sdkPromise 리셋되어 정상 재로드 확인',
    };
  },
);

// ─────────────────────────────────────────────────────────────────────────
// D28: in-flight dedupe 키 소수 5자리 반올림 — 미세하게 다른 좌표(예: 37.545013 vs 37.545010)도
//      같은 요청으로 합쳐지는지(구현 변경: 원시 좌표 → toFixed(5) 반올림 키).
// ─────────────────────────────────────────────────────────────────────────
await runCheck(
  'D28',
  'lib/places.js collectCandidates: in-flight dedupe 키가 소수 5자리 반올림이라 미세하게 다른 좌표도 동일 요청으로 합쳐진다',
  async () => {
    if (!placesModule) return { status: 'SKIP', detail: placesSkipReason };
    const { collectCandidates, clearTileCache } = placesModule;

    clearTileCache();
    localStorageStub.clear();
    const mock = createMockKakaoSdk({ dummyPlaces: DUMMY_PLACES });
    globalThis.window.kakao = mock.kakao;

    const centerA = { lat: 37.545013, lng: 127.055512 };
    const centerB = { lat: 37.54501, lng: 127.05551 }; // 소수 5자리로는 A와 동일 키
    const radius = 100;

    // 사전 확인(픽스처 자체 검증): 두 center가 toFixed(5) 기준 같은 키를 만드는지, 원시값은 다른지.
    const keyA = `${centerA.lat.toFixed(5)},${centerA.lng.toFixed(5)},${radius}`;
    const keyB = `${centerB.lat.toFixed(5)},${centerB.lng.toFixed(5)},${radius}`;
    assert.strictEqual(keyA, keyB, `픽스처 오류: centerA/centerB가 소수 5자리 반올림 후에도 다른 키(${keyA} vs ${keyB})`);
    assert.notStrictEqual(centerA.lat, centerB.lat, '픽스처 오류: centerA와 centerB의 원시 좌표가 동일함(구분이 안 됨)');

    const p1 = collectCandidates(centerA, radius, {});
    const p2 = collectCandidates(centerB, radius, {}); // await 없이 곧바로 — in-flight dedupe 대상
    const [r1, r2] = await Promise.all([p1, p2]);

    assert.strictEqual(
      r1,
      r2,
      '미세하게 다른 좌표(소수 5자리로는 동일)인데 두 호출이 같은 결과 객체(단일 실행)를 공유하지 않음(dedupe 실패)',
    );
    assert.ok(mock.getCallCount() > 0, '테스트 설계 문제: 모의 SDK가 한 번도 호출되지 않음');

    // 이후 같은 (반올림)좌표로 순차 재호출하면 캐시 히트라 모의 SDK 호출이 늘지 않아야 한다.
    const callsAfterDedupe = mock.getCallCount();
    await collectCandidates(centerA, radius, {});
    assert.strictEqual(
      mock.getCallCount(),
      callsAfterDedupe,
      '같은 (반올림)좌표로 순차 재호출했는데 캐시 히트가 아니라 재수집됨',
    );

    return {
      status: 'PASS',
      detail: `centerA=${JSON.stringify(centerA)}, centerB=${JSON.stringify(centerB)} → toFixed(5) 동일 키(${keyA}) 확인, 동시호출 시 같은 결과 객체 공유(dedupe) 확인, 이후 순차호출도 캐시 히트(SDK 호출 ${callsAfterDedupe}에서 불변) 확인`,
    };
  },
);

// ─────────────────────────────────────────────────────────────────────────
// D29: resolveCompanyCenter — 지오코딩 캐시(30일) 콜드/웜/만료/시계뒤틀림 + config.CENTER 우선
//      + 실패 시 캐시 미기록(임의 좌표 창작 금지). 기존 D22~D28은 Geocoder가 항상 ZERO_RESULT를
//      반환하는 스텁이라 성공 경로·lunch_geocode_v1 캐시가 한 줄도 실행되지 않았다(2차 리뷰 지적).
// ─────────────────────────────────────────────────────────────────────────
await runCheck(
  'D29',
  'lib/places.js resolveCompanyCenter: 지오코딩 캐시 콜드/웜/TTL만료/시계뒤틀림 + config.CENTER 우선 + 실패 시 캐시 미기록',
  async () => {
    if (!placesModule) return { status: 'SKIP', detail: placesSkipReason };
    const { resolveCompanyCenter } = placesModule;

    // lib/places.js의 비공개 상수(export 안 됨)와 동기화 필요 — GEOCODE_CACHE_KEY='lunch_geocode_v1', GEOCODE_TTL_MS=30일.
    const GEOCODE_CACHE_KEY = 'lunch_geocode_v1';
    const GEOCODE_TTL_MS = 30 * 24 * 60 * 60 * 1000;
    const address = '서울특별시 성동구 아차산로13길 11';

    // (a) 콜드: 캐시 없음 → Geocoder 1회 호출, 좌표 정상 반환, 캐시 저장
    localStorageStub.clear();
    const mockOk = createMockKakaoSdk({ geocode: { status: 'OK', x: '127.0554', y: '37.5451' } });
    globalThis.window.kakao = mockOk.kakao;

    const configNoCenter = { COMPANY_ADDRESS: address };
    const coldResult = await resolveCompanyCenter(configNoCenter);
    assert.deepStrictEqual(
      coldResult,
      { lat: 37.5451, lng: 127.0554 },
      `콜드 resolveCompanyCenter 결과 불일치: ${JSON.stringify(coldResult)}`,
    );
    assert.strictEqual(
      mockOk.getGeocodeCallCount(),
      1,
      `콜드 호출인데 Geocoder 호출 수가 1이 아님(${mockOk.getGeocodeCallCount()})`,
    );

    const geocodeCacheRaw = JSON.parse(localStorageStub.getItem(GEOCODE_CACHE_KEY) || '{}');
    assert.ok(geocodeCacheRaw[address], '콜드 호출 후 lunch_geocode_v1에 해당 주소 엔트리가 없음');
    assert.strictEqual(geocodeCacheRaw[address].lat, 37.5451, '캐시에 저장된 lat 불일치');
    assert.strictEqual(geocodeCacheRaw[address].lng, 127.0554, '캐시에 저장된 lng 불일치');
    assert.ok(Number.isFinite(geocodeCacheRaw[address].ts), '캐시에 저장된 ts가 유한수가 아님');

    // (b) 웜: 재호출 → Geocoder 호출 0회(캐시 히트), 같은 좌표
    const warmResult = await resolveCompanyCenter(configNoCenter);
    assert.deepStrictEqual(
      warmResult,
      { lat: 37.5451, lng: 127.0554 },
      `웜 resolveCompanyCenter 결과 불일치: ${JSON.stringify(warmResult)}`,
    );
    assert.strictEqual(
      mockOk.getGeocodeCallCount(),
      1,
      `웜 호출인데 Geocoder 호출 수가 늘어남(캐시 미스 의심, ${mockOk.getGeocodeCallCount()})`,
    );

    // (c) TTL(30일) 초과 → 다시 호출
    const cacheAfterWarm = JSON.parse(localStorageStub.getItem(GEOCODE_CACHE_KEY));
    cacheAfterWarm[address].ts = Date.now() - GEOCODE_TTL_MS - 60000;
    localStorageStub.setItem(GEOCODE_CACHE_KEY, JSON.stringify(cacheAfterWarm));
    const expiredResult = await resolveCompanyCenter(configNoCenter);
    assert.deepStrictEqual(expiredResult, { lat: 37.5451, lng: 127.0554 }, 'TTL 만료 후 결과 좌표 불일치');
    assert.strictEqual(
      mockOk.getGeocodeCallCount(),
      2,
      `TTL(30일) 초과인데 Geocoder가 재호출되지 않음(${mockOk.getGeocodeCallCount()})`,
    );

    // (d) 미래 ts(시계 뒤틀림) → 캐시를 신뢰하지 않고 안전하게 재호출(throw 없이, 부정확 좌표 고착 방지)
    const cacheAfterExpiry = JSON.parse(localStorageStub.getItem(GEOCODE_CACHE_KEY));
    cacheAfterExpiry[address].ts = Date.now() + 1000 * 60 * 60 * 24; // 미래 24시간(시계 뒤틀림 재현)
    localStorageStub.setItem(GEOCODE_CACHE_KEY, JSON.stringify(cacheAfterExpiry));
    let futureError = null;
    let futureResult = null;
    try {
      futureResult = await resolveCompanyCenter(configNoCenter);
    } catch (err) {
      futureError = err;
    }
    assert.strictEqual(futureError, null, `미래 ts(시계 뒤틀림)에서 throw 발생: ${futureError}`);
    assert.deepStrictEqual(futureResult, { lat: 37.5451, lng: 127.0554 }, '미래 ts 상황에서 결과 좌표 불일치');
    assert.strictEqual(
      mockOk.getGeocodeCallCount(),
      3,
      `미래 ts(시계 뒤틀림) 캐시를 그대로 신뢰해 재호출을 건너뜀(부정확한 좌표를 계속 쓸 위험, ${mockOk.getGeocodeCallCount()})`,
    );

    // (e) config.CENTER 유효 → Geocoder 아예 호출 안 함
    localStorageStub.clear();
    const mockUnused = createMockKakaoSdk({ geocode: { status: 'OK', x: '999', y: '999' } });
    globalThis.window.kakao = mockUnused.kakao;
    const configWithCenter = { CENTER: { lat: 1.5, lng: 2.5 }, COMPANY_ADDRESS: address };
    const centerResult = await resolveCompanyCenter(configWithCenter);
    assert.deepStrictEqual(centerResult, { lat: 1.5, lng: 2.5 }, 'config.CENTER 우선 결과 불일치');
    assert.strictEqual(
      mockUnused.getGeocodeCallCount(),
      0,
      `config.CENTER가 유효한데도 Geocoder가 호출됨(${mockUnused.getGeocodeCallCount()})`,
    );

    // (f) 실패 시 GEOCODE_FAILED로 reject, 캐시에 아무것도 안 씀(임의 좌표 창작 금지, D9 정신)
    localStorageStub.clear();
    const mockFail = createMockKakaoSdk({}); // geocode 미지정 → 항상 ZERO_RESULT
    globalThis.window.kakao = mockFail.kakao;
    let failError = null;
    try {
      await resolveCompanyCenter({ COMPANY_ADDRESS: address });
    } catch (err) {
      failError = err;
    }
    assert.ok(failError instanceof Error, '지오코딩 실패인데 reject 되지 않음(임의 좌표 창작 의심)');
    assert.ok(/GEOCODE_FAILED/.test(failError.message), `reject 에러 메시지가 GEOCODE_FAILED가 아님: ${failError.message}`);
    const cacheAfterFail = localStorageStub.getItem(GEOCODE_CACHE_KEY);
    assert.ok(
      !cacheAfterFail || !JSON.parse(cacheAfterFail)[address],
      '지오코딩 실패인데도 lunch_geocode_v1에 엔트리가 기록됨(임의 좌표 창작 금지 위반)',
    );

    return {
      status: 'PASS',
      detail: `콜드 1회 호출+캐시 저장 확인, 웜 0회(캐시 히트), TTL(30일) 초과 재호출 확인(누적2회), 미래ts도 안전 재호출(누적3회, throw 없음), config.CENTER 우선 시 Geocoder 0회, 실패 시 GEOCODE_FAILED reject+캐시 미기록 확인`,
    };
  },
);

// ─────────────────────────────────────────────────────────────────────────
// D30: categorySearchPage 다중 페이지 루프(2·3페이지) + ZERO_RESULT 타일 경로 +
//      localStorage 용량 초과(QuotaExceededError) 시 캐시 저장 실패가 흡수되고 수집 자체는 성공하는지.
// ─────────────────────────────────────────────────────────────────────────
await runCheck(
  'D30',
  'lib/places.js: categorySearchPage 다중 페이지/ZERO_RESULT 타일 경로 + localStorage 용량 초과 흡수',
  async () => {
    if (!placesModule) return { status: 'SKIP', detail: placesSkipReason };
    const { collectCandidates, clearTileCache } = placesModule;

    clearTileCache();
    localStorageStub.clear();

    const center = { lat: 37.5451, lng: 127.0554 };
    const radius = 300;
    const survivingTiles = buildGridTiles(center, radius, 400, { snap: true }).filter(
      (t) => !isTileOutsideRadius(t, center, radius),
    );
    assert.ok(
      survivingTiles.length >= 3,
      `테스트 전제 불성립: radius=${radius}에서 살아남는 타일이 ${survivingTiles.length}개(3개 이상 필요 — ZERO_RESULT/다중페이지/3페이지상한 타일을 각각 구성)`,
    );

    const zeroResultKey = tileCacheKey(survivingTiles[0]);
    const multiPageKey = tileCacheKey(survivingTiles[1]);
    const truncatedKey = tileCacheKey(survivingTiles[2]);

    function identifyTile(options) {
      const t = {
        swLat: options.bounds.sw.lat,
        swLng: options.bounds.sw.lng,
        neLat: options.bounds.ne.lat,
        neLng: options.bounds.ne.lng,
      };
      return tileCacheKey(t);
    }

    const respond = (options) => {
      const key = identifyTile(options);
      const page = options.page;
      if (key === zeroResultKey) {
        return { data: [], status: 'ZERO_RESULT' };
      }
      if (key === multiPageKey) {
        if (page === 1) return { data: [DUMMY_PLACES[0]], status: 'OK', hasNextPage: true };
        return { data: [DUMMY_PLACES[1]], status: 'OK', hasNextPage: false };
      }
      if (key === truncatedKey) {
        // 매 페이지가 "다음 페이지 있음"을 계속 주장 — MAX_PAGES_PER_TILE(3) 상한에서 멈춰야 한다.
        return { data: [DUMMY_PLACES[0]], status: 'OK', hasNextPage: true };
      }
      return { data: DUMMY_PLACES, status: 'OK', hasNextPage: false };
    };

    const mock = createMockKakaoSdk({ respond });
    globalThis.window.kakao = mock.kakao;

    let collectError = null;
    let result = null;
    try {
      result = await collectCandidates(center, radius, {});
    } catch (err) {
      collectError = err;
    }
    assert.strictEqual(collectError, null, `ZERO_RESULT/다중페이지 타일이 섞였는데 collectCandidates가 throw함: ${collectError}`);
    assert.ok(result.list.length > 0, '결과가 비어있음(테스트 설계 문제 의심)');

    const callsByTile = (key) => mock.getCalls().filter((c) => identifyTile(c.options) === key);

    // ZERO_RESULT 타일: 1페이지만 호출되고 즉시 종료(빈 결과, throw 아님)
    const zeroCalls = callsByTile(zeroResultKey);
    assert.strictEqual(zeroCalls.length, 1, `ZERO_RESULT 타일이 1회 호출로 끝나지 않음(${zeroCalls.length}회)`);

    // 다중 페이지 타일: 정확히 2회 호출(1→hasNextPage:true, 2→hasNextPage:false)되고 두 페이지 데이터가 합쳐짐
    const multiCalls = callsByTile(multiPageKey);
    assert.strictEqual(multiCalls.length, 2, `다중 페이지 타일이 정확히 2회 호출되지 않음(${multiCalls.length}회)`);
    const multiPagesRequested = multiCalls.map((c) => c.options.page).sort();
    assert.deepStrictEqual(multiPagesRequested, [1, 2], `다중 페이지 타일의 page 값이 [1,2]가 아님: ${JSON.stringify(multiPagesRequested)}`);

    // 3페이지 상한 타일: 매번 hasNextPage:true를 주장해도 MAX_PAGES_PER_TILE(3)에서 멈춤(4페이지 요청 없음)
    const truncatedCalls = callsByTile(truncatedKey);
    assert.strictEqual(
      truncatedCalls.length,
      3,
      `hasNextPage:true를 계속 주장하는 타일이 MAX_PAGES_PER_TILE(3)에서 멈추지 않음(${truncatedCalls.length}회 호출)`,
    );
    const truncatedPages = truncatedCalls.map((c) => c.options.page).sort();
    assert.deepStrictEqual(truncatedPages, [1, 2, 3], `3페이지 상한 타일의 page 값이 [1,2,3]이 아님: ${JSON.stringify(truncatedPages)}`);

    // 병합 결과에 다중 페이지 타일의 두 place(kp1, kp2)가 모두 반영됐는지(페이지 데이터 유실 없음)
    const resultIds = new Set(result.list.map((p) => p.id));
    assert.ok(resultIds.has('kp1') && resultIds.has('kp2'), `다중 페이지 타일의 두 place가 최종 결과에 모두 반영되지 않음: ${JSON.stringify([...resultIds])}`);

    // ZERO_RESULT 타일도 places:[] 로 캐시에 남아야 한다(빈 결과도 캐시 대상 — 재검색 절감 효과가 가장 큰 쪽).
    const rawCache = JSON.parse(localStorageStub.getItem('lunch_tiles_v1'));
    assert.ok(rawCache[zeroResultKey], 'ZERO_RESULT 타일이 캐시에 아예 없음(빈 결과가 캐시 대상에서 빠짐)');
    assert.deepStrictEqual(rawCache[zeroResultKey].places, [], 'ZERO_RESULT 타일의 캐시된 places가 빈 배열이 아님');

    // localStorage 용량 초과(QuotaExceededError) — 캐시 저장 실패가 흡수되고 수집 자체는 성공해야 한다.
    clearTileCache();
    localStorageStub.clear();
    const mockQuota = createMockKakaoSdk({ dummyPlaces: DUMMY_PLACES });
    globalThis.window.kakao = mockQuota.kakao;
    localStorageStub.setQuotaExceeded(true);
    let quotaError = null;
    let quotaResult = null;
    try {
      quotaResult = await collectCandidates(center, 100, {});
    } catch (err) {
      quotaError = err;
    } finally {
      localStorageStub.setQuotaExceeded(false); // 다음 검사 오염 방지(항상 원복)
    }
    assert.strictEqual(quotaError, null, `localStorage 용량 초과 상황에서 collectCandidates가 throw함: ${quotaError}`);
    assert.ok(quotaResult && quotaResult.list.length > 0, '용량 초과 상황에서 수집 결과 자체가 비정상(빈 결과)');
    const cacheAfterQuota = localStorageStub.getItem('lunch_tiles_v1');
    assert.ok(
      !cacheAfterQuota,
      '용량 초과로 setItem이 실패해야 하는데도 lunch_tiles_v1이 저장됨(스텁이 실패를 흉내내지 못했거나 구현이 예외를 삼키지 않고 우회 저장)',
    );

    return {
      status: 'PASS',
      detail: `ZERO_RESULT 타일 1회호출+빈배열 캐시 확인, 다중페이지 타일 2회(page 1→2) 병합 확인, 3페이지 상한 타일 정확히 3회에서 멈춤 확인, 병합결과 kp1/kp2 모두 반영 확인; localStorage 용량초과 시 throw 없이 수집 성공(list=${quotaResult.list.length}건)+캐시 미기록 확인`,
    };
  },
);

// ─────────────────────────────────────────────────────────────────────────
// D31: GRID_ANCHOR_DEG 대역 경계를 걸치는 이동은 캐시 재사용률이 0%로 떨어짐을 의도적으로 박제.
//      D19b는 회사 반경 800m "내부"만 보므로 경계를 넘는 이동은 다루지 않는다 — 설계상 불가피한
//      한계(대역 경계 간격이 넓어 실사용에서 거의 안 밟히지만, 나중에 GRID_ANCHOR_DEG를 줄이면
//      영향 범위가 넓어진다는 사실 자체를 여기 남겨 둔다).
// ─────────────────────────────────────────────────────────────────────────
await runCheck(
  'D31',
  'GRID_ANCHOR_DEG 대역 경계 통과 이동은 캐시 재사용률이 0%(설계상 불가피 — 박제)',
  async () => {
    const company = { lat: 37.5451, lng: 127.0554 };
    const nearestAnchor = Math.round(company.lat / GRID_ANCHOR_DEG) * GRID_ANCHOR_DEG;
    const boundaryLat = nearestAnchor + GRID_ANCHOR_DEG / 2; // 회사 대역과 인접 대역의 경계
    const boundaryDistMeters = (boundaryLat - company.lat) * 111320;

    // 경계를 사이에 둔 두 지점(각각 대역 안쪽으로 살짝) — 서로 다른 앵커 스케일을 쓰게 된다.
    const beforeBoundary = { lat: boundaryLat - 0.001, lng: company.lng };
    const afterBoundary = { lat: boundaryLat + 0.001, lng: company.lng };
    const RADIUS = 800;

    const keysBefore = new Set(buildGridTiles(beforeBoundary, RADIUS, 400, { snap: true }).map(tileCacheKey));
    const keysAfter = new Set(buildGridTiles(afterBoundary, RADIUS, 400, { snap: true }).map(tileCacheKey));
    const intersect = [...keysBefore].filter((k) => keysAfter.has(k)).length;

    // 이 값이 갑자기 0이 아니게 되면(교집합 발생) GRID_ANCHOR_DEG 정의나 buildGridTiles의 스냅 로직이
    // 바뀐 것이니 — 그 자체는 나쁜 게 아니라(오히려 캐시 재사용 범위가 넓어진 것일 수 있다) "왜 바뀌었는지"를
    // 확인하라는 신호로 받아들이면 된다. 반대로 이 값이 0인 것은 실패가 아니라 이 대역 분할 설계의 알려진 특성이다.
    assert.strictEqual(
      intersect,
      0,
      `대역 경계(약 ${boundaryDistMeters.toFixed(0)}m 지점) 통과 이동인데 캐시 키 교집합이 0이 아님(${intersect}) — GRID_ANCHOR_DEG 로직이 바뀐 것으로 보임, 의도적 변경이면 이 오라클도 함께 갱신할 것`,
    );

    return {
      status: 'PASS',
      detail: `GRID_ANCHOR_DEG=${GRID_ANCHOR_DEG}, 회사 대역 경계(약 ${boundaryDistMeters.toFixed(0)}m 지점) 통과 이동 시 캐시 키 교집합=0 확인(설계상 불가피 — 실사용 영향은 경계 간격이 넓어 낮음, D19b는 대역 "내부" 이동만 검증)`,
    };
  },
);

// ─────────────────────────────────────────────────────────────────────────
// 결과 출력
// ─────────────────────────────────────────────────────────────────────────
console.log('');
console.log('=== 도메인 오라클 점검 결과 (D1~D31) ===');
console.log('');
let passed = 0;
let failed = 0;
let skipped = 0;
for (const r of results) {
  const idCol = r.id.padEnd(4);
  const statusCol = r.status.padEnd(5);
  console.log(`${idCol} ${statusCol} ${r.name} — ${r.detail}`);
  if (r.status === 'PASS') passed++;
  else if (r.status === 'FAIL') failed++;
  else skipped++;
}
console.log('');
console.log(`TOTAL: ${passed} passed, ${failed} failed, ${skipped} skipped`);

if (failed > 0) {
  process.exitCode = 1;
}
