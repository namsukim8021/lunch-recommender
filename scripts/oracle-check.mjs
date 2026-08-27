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
import { fileURLToPath } from 'node:url';
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
  const candidateFiles = ['app.js', 'lib/core.js', 'config.js'].map((f) => path.join(REPO_ROOT, f));
  const existingFiles = candidateFiles.filter((f) => existsSync(f));
  if (existingFiles.length === 0) {
    return { status: 'SKIP', detail: 'app.js/lib/core.js/config.js 모두 아직 없음(병렬 작성 중)' };
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
// 결과 출력
// ─────────────────────────────────────────────────────────────────────────
console.log('');
console.log('=== 도메인 오라클 점검 결과 (D1~D16) ===');
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
