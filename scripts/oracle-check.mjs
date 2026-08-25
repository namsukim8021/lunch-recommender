// oracle-check.mjs
// ─────────────────────────────────────────────────────────────────────────
// 목적: docs/oracle.md 의 도메인 오라클 D1~D10 을 자동으로 점검한다.
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
// 결과 출력
// ─────────────────────────────────────────────────────────────────────────
console.log('');
console.log('=== 도메인 오라클 점검 결과 (D1~D10) ===');
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
