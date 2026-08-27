// fetch-moremore.mjs
// ─────────────────────────────────────────────────────────────────────────
// 목적: 풀무원 모락모락(구내식당) "오늘의 메뉴" API를 GitHub Actions 러너에서
// 서버사이드로 호출해 data/moremore-latest.json 에 저장한다.
// 브라우저 직접 fetch는 CORS로 차단됨을 실측 확인했음(docs/spec.md §8,
// .github/workflows/verify-moremore-fetch.yml 진단 결과) — 이 스크립트가
// 그 진단을 대체하는 실제 크롤러다. Node 내장 fetch만 사용(외부 의존성 0개,
// oracle-check.mjs와 같은 관례). 실행: node scripts/fetch-moremore.mjs
//
// 실행 주기: .github/workflows/moremore-fetch.yml 의 예약 = KST 평일 9슬롯
// (07:13 / 08:29 / 09:41 / 10:07 / 11:23 / 12:37 / 13:51 / 15:17 / 17:33,
// + workflow_dispatch 수동).
// GitHub 예약은 best-effort 라 드롭·지연되므로 슬롯을 다중화했고 분(minute)도 흩었다.
// 오후 슬롯이 있는 이유: 벤더가 당일 중 이미지·메뉴명을 점진적으로 채운다
// (실측 2026-08-27 — 10:11 수집분은 이미지가 null, 11:12 재조회 시 업로드돼 있었다).
// 하루 여러 번 실행되지만 같은 내용이면 워크플로의 `git diff --staged --quiet` 가
// 커밋을 막으므로, 이 스크립트는 "빈/이상 응답으로 기존 파일을 되돌리지 않는다" 하나만 지킨다.
// ─────────────────────────────────────────────────────────────────────────

import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

import { hasMoremoreItems, isFreshMoremoreData } from '../lib/core.js';

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

// 이미 저장된 파일의 fetchedDate 만 읽는다(저장 여부 판정용이 아니라 "마지막 슬롯 실패 판정"용).
// 파일 부재·파싱 실패·권한 오류 등 어떤 이유로든 읽지 못하면 null — 그 경우 "미확보"로 본다.
function readStoredFetchedDate() {
  try {
    const parsed = JSON.parse(readFileSync(OUTPUT_PATH, 'utf8'));
    return parsed && typeof parsed === 'object' ? parsed.fetchedDate : null;
  } catch (err) {
    console.warn(`[fetch-moremore] 기존 파일을 읽지 못함(${err && err.message ? err.message : String(err)}) — 미확보로 간주`);
    return null;
  }
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

  // 200 + 빈 data(또는 스키마가 깨진 data)는 저장하지 않는다 — 있는 데이터를 빈 것으로 되돌리지 않는다.
  //
  // 이때 워크플로를 실패시킬지는 슬롯에 따라 다르다. 벤더가 당일 중 데이터를 점진적으로
  // 채우므로(실측: 이미지가 KST 11:12 에 업로드됨) 이른 슬롯의 빈 응답은 "아직 미게시"라는
  // 정상 상태일 수 있다. 그걸 매번 실패로 띄우면 평일마다 빨간 잡이 쌓여 "빨간 워크플로 =
  // 이상 신호"라는 전제 자체가 죽는다(경보 피로). 그래서 실패 판정은 당일 마지막 슬롯
  // (MOREMORE_STRICT=1, 워크플로가 KST 17:33 슬롯에만 주입)에서만, 그것도 "하루가 끝났는데
  // 오늘 데이터를 끝내 확보하지 못했다"는 진짜 이상일 때만 한다.
  if (!hasMoremoreItems(raw)) {
    console.error('[fetch-moremore] 응답에 메뉴 항목이 없음 — 파일 유지(아직 미게시이거나 휴일일 수 있음)');
    if (process.env.MOREMORE_STRICT === '1') {
      if (isFreshMoremoreData(readStoredFetchedDate(), today)) {
        console.log('[fetch-moremore] 다만 오늘자 데이터는 앞선 슬롯이 이미 확보했다 — 실패로 보지 않는다');
      } else {
        console.error('[fetch-moremore] 당일 마지막 슬롯인데 오늘 데이터를 끝내 확보하지 못했다 — 실패 처리');
        process.exitCode = 1;
      }
    }
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
