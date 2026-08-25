// fetch-moremore.mjs
// ─────────────────────────────────────────────────────────────────────────
// 목적: 풀무원 모락모락(구내식당) "오늘의 메뉴" API를 GitHub Actions 러너에서
// 서버사이드로 호출해 data/moremore-latest.json 에 저장한다.
// 브라우저 직접 fetch는 CORS로 차단됨을 실측 확인했음(docs/spec.md §8,
// .github/workflows/verify-moremore-fetch.yml 진단 결과) — 이 스크립트가
// 그 진단을 대체하는 실제 크롤러다. Node 내장 fetch만 사용(외부 의존성 0개,
// oracle-check.mjs와 같은 관례). 실행: node scripts/fetch-moremore.mjs
// ─────────────────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.join(__dirname, '..');
const OUTPUT_PATH = path.join(REPO_ROOT, 'data', 'moremore-latest.json');

const MOREMORE_API_URL = 'https://puls2.pulmuone.com/src/sql/menu/today_sql.php';
const MOREMORE_SRCH_OPER_CD = 'O000002';
const MOREMORE_SRCH_ASSIGN_CD = 'S000758';

// KST(UTC+9) 기준 YYYYMMDD를 실행 시점 동적 생성(러너 타임존과 무관하게 정확히 계산).
function getKstYyyymmdd() {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const kst = new Date(utcMs + 9 * 60 * 60000);
  const y = kst.getFullYear();
  const m = String(kst.getMonth() + 1).padStart(2, '0');
  const d = String(kst.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function buildRequestBody(today) {
  const requestParam = {
    srchOperCd: MOREMORE_SRCH_OPER_CD,
    srchAssignCd: MOREMORE_SRCH_ASSIGN_CD,
    srchCurDay: today,
    srchCurShopclsCd: '',
    custCd: '',
  };
  const params = new URLSearchParams();
  params.set('requestId', 'search_schMenu');
  params.set('requestUrl', '/src/sql/menu/today_sql.php');
  params.set('requestMode', '1');
  params.set('requestParam', JSON.stringify(requestParam));
  return params.toString();
}

async function main() {
  const today = getKstYyyymmdd();
  console.log(`[fetch-moremore] Requesting for date: ${today}`);

  let res;
  try {
    res = await fetch(MOREMORE_API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
        Accept: 'application/json, text/javascript, */*; q=0.01',
        Origin: 'https://puls2.pulmuone.com',
        Referer: 'https://puls2.pulmuone.com/src/php/menu/today.php',
        'X-Requested-With': 'XMLHttpRequest',
      },
      body: buildRequestBody(today),
    });
  } catch (err) {
    console.error(`[fetch-moremore] 네트워크 오류: ${err && err.message ? err.message : String(err)}`);
    process.exitCode = 1;
    return;
  }

  if (!res.ok) {
    console.error(`[fetch-moremore] 비2xx 응답: HTTP ${res.status}`);
    process.exitCode = 1;
    return;
  }

  let raw;
  try {
    const text = await res.text();
    raw = JSON.parse(text);
  } catch (err) {
    console.error(`[fetch-moremore] JSON 파싱 실패: ${err && err.message ? err.message : String(err)}`);
    process.exitCode = 1;
    return;
  }

  const dataDir = path.join(REPO_ROOT, 'data');
  if (!existsSync(dataDir)) {
    mkdirSync(dataDir, { recursive: true });
  }

  const output = { fetchedDate: today, raw };
  writeFileSync(OUTPUT_PATH, JSON.stringify(output, null, 2) + '\n');
  console.log(`[fetch-moremore] 저장 완료: ${OUTPUT_PATH} (fetchedDate=${today})`);
}

main();
