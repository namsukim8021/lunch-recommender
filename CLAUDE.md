# CLAUDE.md — lunch-recommender 상시 컨텍스트/규약

이 파일은 세션마다 AI에 **항상 주입**되는 프로젝트 규약이다(Harness의 **Constrain·Inform** 계층). 상세 명세는 `docs/`를 따른다.

## 프로젝트
회사(`서울특별시 성동구 아차산로13길 11`) 주변 점심 식당을 **랜덤 + 최근 안 겹치게** 추천하는 개인용 **정적**(무료) 웹. 데이터 = **Kakao 지도 JS SDK**.

## Harness 3계층 (본 레포)
| 계층 | 파일 | 하네스 축 |
|---|---|---|
| 상시 규약·컨텍스트 | **CLAUDE.md**(이 파일) | Constrain · Inform |
| 명세(무엇)·설계(어떻게)·원칙·**정답기준**·**판정방법** | `docs/spec.md`(SPEC) · `docs/plan.md`(LLD) · `docs/constitution.md` · `docs/oracle.md`(3층 오라클) · `docs/tracks.md`(검증 트랙 5종) | Inform |
| 절차 표준화(생성→검증→보완) | `.claude/skills/sdd-cycle` | Verify · Correct |

## SDD 운영 원칙 (반드시 준수)
1. **스펙이 1차 산출물.** 기능은 먼저 `docs/spec.md`(무엇)·`docs/plan.md`(어떻게)에 기술한 뒤 생성한다.
2. **코드를 직접 손보지 말 것.** 결함·변경은 코드가 아니라 **스펙(문서)을 보완한 뒤 재생성**한다(문서 보완 후 재생성 루프).
3. **정답기준 = 3층 오라클.** 생성물은 (회귀·재검증 기준으로) 사람 눈이 아니라 [`docs/oracle.md`](docs/oracle.md)의 **① 명세 오라클**(`spec §6` AC)·**② 도메인 오라클**(스펙에 없어도 당연한 불변식 D1~D10)·**③ 바이너리 오라클**(golden regression, 수용 후 생성) **대비로 판정**한다(최초 수용 1회는 사람 판단 허용 — oracle.md §2). 변경 시 "이 정답은 뭘로 정해졌나(golden/AC/도메인규칙)"를 먼저 답한다.
4. **판정 방법 = 검증 트랙.** 오라클이 "무엇이 정답인가"라면 [`docs/tracks.md`](docs/tracks.md)는 "그 정답과 **언제 무엇을 비교하는가**"다. 변경 착수 전 **어느 트랙으로 판정할지 먼저 정한다** — 트랙마다 선행 조건(결정성·계측)이 달라 구현 후에는 열 수 없다.
5. **파이프라인**(스펙 우선): SPEC(`spec.md`) → LLD(`plan.md`) → CODE → TEST → **VALIDATE(3층 오라클 × 트랙)**.

## 하드 제약 (constitution.md 요약)
- 정적·무료(GitHub Pages), **백엔드 없음**. 개인정보는 **localStorage만**, 서버 저장/계정 없음.
- 키는 **도메인 제한 Kakao JS 앱키만**. REST 키·시크릿은 레포/코드에 넣지 않는다.
- **창작 금지**: 없는 식당·메뉴·영업시간을 지어내지 않는다. 근사(거리 직선·점심영업 추정 등)는 "근사/추정"으로 **정직 표기**.
- 한국어 · 모바일 우선.

## 커밋 규칙
- AI 공동저자 트레일러는 정확히: `Co-Authored-By: Claude <noreply@anthropic.com>` (모델명·버전 등 변형 금지).
- 요청 프롬프트는 `PROMPTS.md`에 누적한다. **public 레포**이므로 사내 기밀·시크릿은 기록 금지.

## 현재 상태
Phase 0~4.6(스펙/설계/오라클/트랙) 문서화 완료 + **Phase 5(구현) 완료** — `config.js`/`lib/core.js`/`app.js`/`index.html` 생성, 난수원 주입(`pickRandom(list, rng)`)·계측(`elapsedMs`/`searchCalls`/`candidateCount`) 배선됨. 도메인 오라클(D1~D10) 자동 점검기 + 분포 판정기(D10) = `scripts/oracle-check.mjs`. **Phase 6(배포) 미착수** — GitHub Pages 미활성화, golden 스냅샷 미박제(바이너리 오라클은 여전히 콜드 스타트).

**3탭 확장** — 탭2 모락모락(구내식당 오늘의 메뉴, 브라우저 직접 fetch)·탭3 점심메뉴 월드컵(탭1 실제 후보 재사용 16강 토너먼트) 관련 문서(`docs/spec.md`·`docs/plan.md`·`docs/oracle.md`·`docs/tracks.md`·`docs/tasks.md` Phase 5.5) 갱신 완료(신규 AC·도메인 D12~D15 정의, [oracle.md](docs/oracle.md)·[tracks.md §3-3](docs/tracks.md)). **구현·검증 완료(오라클 D1~D15 17/17 PASS)** — `lib/core.js`/`app.js`(getter 노출 1줄)/`moremore.js`/`worldcup.js`/`tabs.js`/`index.html`/`config.js`/`scripts/oracle-check.mjs` 반영됨.

**모락모락 Actions 크롤러 전환(Phase 5.6) 완료** — 브라우저 직접 fetch가 CORS로 실제 차단됨을 실측 확인해, 아키텍처를 "브라우저 직접 fetch"에서 "**GitHub Actions 예약 크롤러**(`scripts/fetch-moremore.mjs`, `.github/workflows/moremore-fetch.yml` — 당초 평일 KST 09:00 1회, Phase 5.7에서 다중 슬롯으로 재조정됨)가 서버사이드로 수집해 `data/moremore-latest.json`(`{fetchedDate, raw}`)으로 커밋 → `moremore.js`가 같은 오리진 정적 파일을 fetch"로 전환했다. 진단용이었던 `.github/workflows/verify-moremore-fetch.yml`은 삭제. `lib/core.js`에 순수함수 `isFreshMoremoreData(fetchedDate, todayDate)` 추가로 날짜 불일치(4번째 경로)를 판정하며, `moremore.js`는 `ready && isFreshMoremoreData(...)` 모두 참일 때만 렌더한다(오라클 D12 4경로 확장). `config.js`에서 클라이언트가 더 이상 쓰지 않는 `MOREMORE_API_URL`/`MOREMORE_SRCH_OPER_CD`/`MOREMORE_SRCH_ASSIGN_CD`를 제거했고(값은 `scripts/fetch-moremore.mjs`에 상수로 이동), `data/moremore-latest.json`을 실데이터로 최초 커밋해뒀다.

**모락모락 예약 갱신 신뢰성 개선(Phase 5.7) 완료** — 배포 사이트에서 탭2가 "준비중입니다"만 뜨는 문제를 조사한 결과, GitHub Actions 예약(cron) 워크플로가 **best-effort**라 지연·드롭됨을 실측 확인했다(2026-08-26 예약분은 1시간 지연 발동, **2026-08-27 예약분은 발동 자체가 없었음**). `.github/workflows/moremore-fetch.yml`의 스케줄을 단일 슬롯(평일 KST 09:00 1회)에서 **평일 KST 07:13/08:29/09:41/10:07/11:23/12:37/13:51/15:17/17:33 9슬롯**으로 다중화했다(`workflow_dispatch` 유지) — 분(minute)까지 슬롯마다 흩은 이유는 드롭의 주원인이 정시 직후 큐 폭주라 같은 분에 몰리면 드롭이 상관돼 다중화 효과가 줄기 때문이고, 오후 슬롯(15:17/17:33)은 벤더가 당일 중 이미지·메뉴명을 점진적으로 채우는 것(실측: 이미지가 KST 11:12에 업로드됨)에 대응한다. 저장 게이트는 애초 "하루 1커밋" 판정으로 `shouldReplaceMoremoreData(existing, incoming, todayDate)`를 도입했다가, 워크플로 커밋 스텝의 `git diff --staged --quiet`가 바이트 동일 응답의 중복 커밋을 **이미** 막고 있어 그 판정이 불필요했고 오히려 부분 게시 결함(이른 슬롯이 1코너만 받아 커밋하면 뒤 슬롯의 확정 메뉴가 반영 안 됨)이 있음을 확인해, **`hasMoremoreItems(raw)`로 축소·개명**했다 — "응답에 저장할 항목이 최소 1개 있는가"만 판정하고, 있으면 코너 수와 무관하게 항상 반영한다(부분 게시도 정상 반영). 워크플로에 `concurrency`(group=moremore-fetch, cancel-in-progress=false)를 추가하고 push 직전 `git pull --rebase`를 넣어 슬롯 9개가 겹쳐 돌 때의 동시 실행/논-패스트포워드를 방어했다(단, 이 `git pull --rebase`가 충돌로 실패하면 그 슬롯 수집분은 유실되고 다음 슬롯이 메운다 — 재시도 루프 없음). 빈/스키마 깨진 응답이면 처음엔 슬롯과 무관하게 매번 `scripts/fetch-moremore.mjs`가 `exitCode=1`로 워크플로를 실패시켰으나, 적대적 리뷰에서 cron 9슬롯이 UTC `0-4`/`1-5` 조합으로 **KST 월~금에만** 발동해 주말엔 실행 자체가 없다는 점(따라서 "주말에도 붉게 뜬다"는 서술은 오류)과, 이른 슬롯의 빈 응답까지 매번 실패로 잡으면 경보 피로가 생긴다는 지적을 받아 **실패 판정을 당일 마지막 슬롯(KST 17:33)으로 한정**했다 — 워크플로가 환경변수 `MOREMORE_STRICT`를 그 슬롯일 때만 `1`로 주입하고, 신설한 `readStoredFetchedDate()`로 저장된 파일의 `fetchedDate`가 오늘이 아닐 때만(=하루가 끝났는데 오늘 데이터를 끝내 확보 못함) `exitCode=1`로 실패시킨다. 이로써 능동 알림 수단이 없는 상태의 유일한 탐지 신호는 유지하면서 **공휴일 오탐이 하루 최대 9건에서 1건으로** 줄었다. **클라이언트의 당일 정확 일치(freshness) 조건은 완화하지 않았다** — 어제 메뉴를 오늘 메뉴로 보여주는 것은 constitution의 창작 금지/정직 표기 위반이며, 갱신이 끝내 실패하면 종전대로 "준비중입니다"로 안내한다(주말은 cron 미실행이라 준비중 표시가 정상 동작). `scripts/oracle-check.mjs`의 D16이 `hasMoremoreItems` 기준으로 갱신됐다(`node scripts/oracle-check.mjs` 18/18 PASS). **미해결로 남은 것**: KST 자정 경계 근처 `workflow_dispatch` 수동 실행 시 요청 날짜와 응답 날짜를 대조하지 않아 어제 메뉴에 오늘 라벨이 붙어 커밋될 수 있는 경로(예약 슬롯 07:13~17:33에서는 발생하지 않으며, 저장 게이트가 "항목 1개 이상이면 항상 저장"만 판정해 이 경로에 방어막이 없음), 능동 알림 수단 부재(빨간 워크플로 외 없음), `git pull --rebase` 실패 시 슬롯 유실 — 전부 `docs/spec.md` §8에 명시. moremore.js/index.html의 이미지 카드 레이아웃(전면 사진·로드 실패 플레이스홀더)도 이 개선과 함께 바뀌었다.

**모락모락 카드 이미지 UI 개선(Phase 5.8) 완료** — "일부 테이크아웃 메뉴는 이미지가 보이는데 중식·석식은 안 보인다"는 지적을 조사한 결과, **이미지 부재의 원인은 파싱 버그·데이터 부재가 아니라 벤더(풀무원 모락모락)가 당일 중 이미지를 점진적으로 채우기 때문**임을 실측 확인했다(KST 10:11 수집분은 백반·스페셜 이미지가 `null`, 11:12 재조회 시 업로드됨 — 라면·석식처럼 코너에 따라 끝내 `null`로 남는 경우도 있음). `index.html`(`.mm-*` CSS)·`moremore.js`(`renderItems()`)를 카드 세로형(이미지 상단 full-bleed) 레이아웃으로 바꾸고, 실측 이미지 비율이 코너마다 제각각(1.36~1.71)이라 고정 크롭 대신 `.mm-photo{width:100%;height:auto}`로 원본 비율 그대로 렌더한다. 로드 전 레이아웃 점프는 `min-height` 스켈레톤으로, 사진 없음/로드 실패는 외부 이미지 없이 `.mm-media-ph`("사진 없음") 플레이스홀더로 폴백한다(창작 금지). `docs/spec.md`(§4 요구+데이터 특성, §6 AC)·`docs/plan.md`(카드 UI 절)·`docs/oracle.md`(AC 미러, 자동 오라클 부재를 정직 표기 — 이 판정은 도메인 D 규칙이 아니라 사용자 육안 요구에 대한 [oracle.md §2](docs/oracle.md) "최초 수용 1회는 사람 판단 허용" 예외)·`docs/tasks.md`(Phase 5.8)에 소급 반영했다.

**모락모락 적대적 리뷰 반영(Phase 5.9) 완료** — Phase 5.7~5.8 산출물에 대한 적대적 코드리뷰의 MAJOR/MINOR 지적을 커밋 직전에 반영했다. 서버측 실패신호 정밀화는 위 Phase 5.7 단락에 통합 기술. 클라이언트(`moremore.js`) 쪽: ① `fetch('data/moremore-latest.json', { cache: 'no-cache' })`로 캐시 재검증(벤더가 당일 중 갱신하는데 GitHub Pages 캐시 수명 동안 낡은 파일이 잡히면 갱신분이 사용자에게 도달하지 않는 문제 방지). ② 이미지 요청이 응답도 에러도 없이 매달리면 `onload`/`onerror`가 발화하지 않아 스켈레톤이 영구 잔존하는 결함을 발견해 `IMAGE_TIMEOUT_MS = 8000` 후 `img.complete`가 false인 사진에 `is-failed`를 붙여 플레이스홀더로 넘기도록 보완. ③ 플레이스홀더 문구를 "이미지 준비 전" → **"사진 없음"**으로 정정(`aria-label` 포함) — 라면(TAKEOUT)·석식처럼 끝내 이미지가 제공되지 않는 코너가 있어 "준비 전"은 오지 않을 사진을 약속하는 정직 표기 위반이었다. ④ `<img class="mm-photo">`의 `alt`를 `alt=""`(장식 이미지)로 변경 — 바로 아래 `.mm-name-ko`가 메뉴명을 텍스트로 이미 보여주므로 스크린리더 중복 낭독 방지. `node scripts/oracle-check.mjs` 18/18 PASS(회귀 없음), 크롤러 게이트 조합 검증 10/0·`renderItems` 마크업 검증 11/0(둘 다 1회성, `scripts/oracle-check.mjs`에 상시 편입 안 됨). `docs/spec.md`·`docs/plan.md`·`docs/oracle.md`·`docs/tasks.md`(Phase 5.9)·`PROMPTS.md`(표 병합 오류 정정)에 반영. 헤드리스 브라우저가 없어 실제 브라우저 렌더는 미검증.
