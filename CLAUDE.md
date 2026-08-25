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

**모락모락 Actions 크롤러 전환(Phase 5.6) 완료** — 브라우저 직접 fetch가 CORS로 실제 차단됨을 실측 확인해, 아키텍처를 "브라우저 직접 fetch"에서 "**GitHub Actions 예약 크롤러**(`scripts/fetch-moremore.mjs`, 평일 KST 09:00 `.github/workflows/moremore-fetch.yml`)가 서버사이드로 수집해 `data/moremore-latest.json`(`{fetchedDate, raw}`)으로 커밋 → `moremore.js`가 같은 오리진 정적 파일을 fetch"로 전환했다. 진단용이었던 `.github/workflows/verify-moremore-fetch.yml`은 삭제. `lib/core.js`에 순수함수 `isFreshMoremoreData(fetchedDate, todayDate)` 추가로 날짜 불일치(4번째 경로)를 판정하며, `moremore.js`는 `ready && isFreshMoremoreData(...)` 모두 참일 때만 렌더한다(오라클 D12 4경로 확장, `scripts/oracle-check.mjs` 17/17 PASS 유지). `config.js`에서 클라이언트가 더 이상 쓰지 않는 `MOREMORE_API_URL`/`MOREMORE_SRCH_OPER_CD`/`MOREMORE_SRCH_ASSIGN_CD`를 제거했고(값은 `scripts/fetch-moremore.mjs`에 상수로 이동), `data/moremore-latest.json`을 실데이터로 최초 커밋해뒀다.
