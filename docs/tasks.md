# Tasks — 작업 분해 (WBS)

[spec.md](spec.md) → [plan.md](plan.md)에서 파생한 작업. 체크박스로 진행 추적.

## Phase 0~4 — 스펙/설계 (오늘)
- [x] 레포 생성 + README
- [x] Constitution(원칙) 작성
- [x] Spec(명세) 초안 작성
- [x] Plan(기술설계) 초안 작성
- [x] Tasks(WBS) 작성
- [x] 프롬프트 이력 파일(PROMPTS.md)

## Clarify — 구현 전 사용자 확정 필요 (blocker)
- [x] **회사 위치** 확정 → `서울특별시 성동구 아차산로13길 11` (Geocoder로 좌표 변환)
- [x] **거리 제한** 확정 → 도보 15분(직선 ≈ 1,000m 근사, config `RADIUS`)
- [x] **점심 영업만** 요구 반영 → 근사 방식 확정(카페/야간업종 제외 + 수동 오버라이드). ⚠️ Kakao 영업시간 미제공으로 100% 보장 불가(사용자 고지)
- [x] **Kakao Developers JS 앱키** 발급 + 배포 도메인 등록 → `config.js`
- [x] "메뉴" 범위 최종 확정(카테고리 수준 위임 vs 큐레이션 DB) — spec.md §8에 카테고리 기반 힌트로 확정, plan.md/config.js `CATEGORY_MENU_HINTS`로 구현됨

## Phase 4.5 — 오라클 정의 (정답기준)
- [x] **3층 오라클 문서화**([docs/oracle.md](oracle.md)) — 명세·도메인·바이너리 오라클, 콜드 스타트, 성숙도
- [x] **도메인 오라클 규칙(D1~D10)** 정의 — 반경·야간제외·중복없음·창작금지·localStorage·키안전·후보0
- [x] CLAUDE.md·sdd-cycle·README에 3층 오라클 배선
- [x] (구현과 함께) **도메인 오라클 자동 점검** — 고정 시드/모의 Kakao 응답에 대량·랜덤 입력 → D1~D10 위반 산출 탐지 (`scripts/oracle-check.mjs`)
- [ ] (수용 시) **바이너리 오라클 golden 박제** — 모의 응답 기준 〈추천·메뉴힌트·거리표기〉 스냅샷 → 이후 regression 기준
- [x] (구현과 함께) **분포 판정기** — 고정 시드·고정 후보집합 대량 시행 → D10(쏠림 없음) 검정(Probabilistic Track) (`scripts/oracle-check.mjs`)

## Phase 4.6 — 검증 트랙 정의 (판정 방법)
- [x] **검증 트랙 5종 문서화**([docs/tracks.md](tracks.md)) — 레퍼런스 × 판정 시점, 트랙별 선행 조건, 이 프로젝트의 트랙별 가부
- [x] **오라클 ↔ 트랙 매핑** — oracle.md §4 판정표에 트랙 열 추가
- [x] **분포 요구 신설** — `spec §4`·§6 + 도메인 규칙 **D10**(추천 쏠림 없음). D3(단기 중복)와 별개 축으로, 선택 메커니즘의 구조적 편향을 본다
- [x] **계측 설계**([plan.md](plan.md) 계측) — `elapsedMs`·`searchCalls`·`candidateCount` (Signal Track 관측점)
- [x] CLAUDE.md·sdd-cycle에 트랙 선택 단계 배선

## Phase 5 — 구현 (다음 세션)
> 구현은 `.claude/skills/sdd-cycle` 절차를 따른다: **코드 직접 수정 금지**, [`docs/oracle.md`](oracle.md)의 **3층 오라클(명세 AC·도메인 D1~D10·바이너리 golden)로 대비 검증**, 불일치 시 **스펙/규칙 보완 후 재생성**.
>
> ⚠️ **트랙 선행 조건 — 5.4·5.9를 빠뜨리면 Regression·Probabilistic·Signal 세 트랙이 닫힌다**([tracks.md §3](tracks.md)). 나중에 추가하려면 프로덕션 코드를 다시 뜯어야 하므로 첫 구현에 함께 넣는다.
- [x] 5.1 Walking skeleton: 지도 표시 + 주소 지오코딩(CENTER) — **실패 시 임의 좌표 금지·안내** + 반경 FD6 검색 결과 콘솔
- [x] 5.2 후보 수집·dedupe + **`distance <= RADIUS`(도보 15분) 필터**
- [x] 5.2b **격자 분할 검색(rect 타일 합집합)** — Kakao 45개 상한 극복(전수 수집)
- [x] 5.3 **점심 영업 필터**: 카페(CE7) 제외 + `EXCLUDE_CATEGORY_KEYWORDS`(야간업종) 제외 + `EXCLUDE/INCLUDE_PLACE_IDS` 오버라이드
- [x] 5.3b **메뉴 힌트 도출**: `category_name` 리프 우선 + `CATEGORY_MENU_HINTS` 매핑 폴백(업종 기반 추정 표기)
- [x] 5.4 **난수원 주입**(`pickRandom(list, rng = Math.random)`) 기반 랜덤 추천 1곳 + 결과 카드(이름·업종·**메뉴 힌트**·**거리(직선·도보 N분)**·카카오맵 링크·마커) + "영업·메뉴는 카카오맵 확인" 안내
- [x] 5.5 최근 안 겹치게(localStorage) + "다른 곳" + 이력 순환
- [x] 5.6 이력 보기/초기화
- [x] 5.7 **후보 0 UX**(안내 + 반경 확대/이력 초기화) · 모바일·다크모드 · 에러 폴백(키 미설정/지오코딩·검색 실패)
- [x] 5.8 (선택) 카테고리 필터(한식/양식 등)
- [x] 5.9 **계측 배선** — `elapsedMs`·`searchCalls`·`candidateCount`를 `localStorage["lunch_metrics"]` 링버퍼에 기록(Signal Track 관측점, [plan.md](plan.md) 계측)
- [x] 5.10 (추가) 추천 로직 설명 팝업 — 타이틀 옆 '?' 아이콘 → 레이어 팝업, config 값 기반 동적 설명

## Phase 5.5 — 3탭 확장(모락모락·월드컵)
> Extension 트랙([tracks.md §3-3](tracks.md))으로 판정 — 레퍼런스는 `spec §6` 신규 AC + 도메인 D12~D15([oracle.md](oracle.md)). 지금은 문서(spec/plan/oracle/tracks/tasks/CLAUDE.md/README.md) 갱신만 진행, 구현은 다음 단계.
- [x] 문서화 — spec.md(UC6/UC7·§4·§6·§7·§8)·plan.md(아키텍처·모락모락 데이터소스·월드컵·config 예시·테스트 관점)·oracle.md(AC 미러·D12~D15)·tracks.md(§3-3)·tasks.md(이 절)·CLAUDE.md·README.md 갱신
- [x] `lib/core.js`에 순수 함수 추가(모락모락 응답 파싱/3경로 통합, 월드컵 참가 풀 구성, 브래킷 라운드 진행 등 — 상세 시그니처는 구현 착수 시 plan.md에 먼저 반영)
- [x] `app.js`에 `window.__lunchTab1` getter 노출 1줄 추가(기존 로직·동작 무수정)
- [x] `moremore.js` 신설 — 모락모락 API fetch + 3경로 통합 파싱 + 코너별 카드 렌더
- [x] `worldcup.js` 신설 — 탭1 재사용/자체 수집 + 브래킷 진행 + 매치 UI 렌더
- [x] `tabs.js` 신설 — 3탭 전환(hidden 토글, 라우팅 없음)
- [x] `index.html`에 3탭 마크업 + 탭별 컨테이너 추가
- [x] `config.js`에 `MOREMORE_API_URL`·`MOREMORE_SRCH_OPER_CD`·`MOREMORE_SRCH_ASSIGN_CD`·`WORLDCUP_POOL_SIZE`·`WORLDCUP_CATEGORY_EMOJI` 추가
- [x] `scripts/oracle-check.mjs`에 D12~D15 점검 추가(`runCheck` 패턴)

## Phase 5.6 — 모락모락 CORS 우회(Actions 크롤러)
> 배경: 브라우저 직접 fetch는 CORS로 실제 차단됨을 실측 확인(응답에 `Access-Control-Allow-Origin` 없음), GitHub Actions 러너에서 서버사이드로 호출하면 정상 조회됨을 실측 검증(HTTP 200, 실 데이터 수신 — `.github/workflows/verify-moremore-fetch.yml`). 아키텍처를 "브라우저 직접 fetch"에서 "GitHub Actions 예약 워크플로가 서버사이드로 수집해 `data/moremore-latest.json`으로 커밋 → `moremore.js`가 같은 오리진에서 fetch"로 전환한다(spec.md §4/§8, plan.md 모락모락 데이터소스, oracle.md D12 4경로 확장). Extension 트랙([tracks.md §3-3](tracks.md))으로 판정 — 구현·검증 완료(node scripts/oracle-check.mjs 17 passed / 0 failed).
- [x] `scripts/fetch-moremore.mjs` 작성 — Node 내장 fetch만 사용(외부 의존성 0개, `scripts/oracle-check.mjs`와 같은 관례), 풀무원 API 서버사이드 호출 → `data/moremore-latest.json`(`{fetchedDate, raw}`) 작성
- [x] `.github/workflows/moremore-fetch.yml` 작성(당초 평일 KST 09:00 cron `0 0 * * 1-5` + `workflow_dispatch`, `permissions: contents: write`, `scripts/fetch-moremore.mjs` 실행 → 변경분 커밋) — 진단용 `.github/workflows/verify-moremore-fetch.yml` 교체. ⚠️ 이 단일 슬롯 스케줄은 Actions 예약의 best-effort 드롭이 실측되어 Phase 5.7에서 다중 슬롯으로 재조정했다(아래)
- [x] `lib/core.js`에 `isFreshMoremoreData(fetchedDate, todayDate)` 순수함수 추가(둘 다 "YYYYMMDD" 문자열, 동일하면 true)
- [x] `moremore.js` 데이터소스 전환 — `puls2.pulmuone.com` 직접 fetch 제거, 같은 오리진 `data/moremore-latest.json` fetch + `ready && isFreshMoremoreData(...)` 모두 참일 때만 렌더(4경로 통합 실패처리)
- [x] `data/moremore-latest.json` 최초 커밋(Actions 워크플로 최초 1회 실행 또는 수동)
- [x] `scripts/oracle-check.mjs` D12 확장 — 4경로(기존 3경로 + 날짜 불일치) 판정 + `isFreshMoremoreData` 계약 점검 추가

## Phase 5.7 — 모락모락 예약 갱신 신뢰성 개선(다중 슬롯 재시도 + 저장 게이트 축소)
> 배경: GitHub Actions 예약(cron) 워크플로는 **best-effort**라 지연·드롭된다. 실측 확인 — 2026-08-26 예약분은 1시간 지연(UTC 01:02) 발동, **2026-08-27 예약분은 발동 자체가 없었음**. 그 결과 `data/moremore-latest.json`의 `fetchedDate`가 어제 날짜로 남아 `isFreshMoremoreData`의 당일 정확 일치 조건에 걸려 탭2가 "준비중입니다"만 보여줬다(4번째 경로 — 날짜 불일치). Extension 트랙([tracks.md §3-3](tracks.md))으로 판정 — 클라이언트의 당일 정확 일치(freshness) 조건은 **완화하지 않는다**(어제 메뉴를 오늘 메뉴로 보여주면 constitution의 창작 금지/정직 표기 위반). 대신 서버측 갱신 기회를 늘려 대응한다.
- [x] (1차) `.github/workflows/moremore-fetch.yml` 스케줄을 단일 슬롯(`0 0 * * 1-5`)에서 평일 KST 07:05~13:05 매시 재시도(`'5 22-23 * * 0-4'` + `'5 0-4 * * 1-5'`)로 다중화, `workflow_dispatch` 유지
- [x] (1차) `lib/core.js`에 순수 함수 `shouldReplaceMoremoreData(existing, incoming, todayDate)` 추가(기존 파일·오늘 날짜까지 비교하는 "하루 1커밋" 판정) — 이후 아래 2차 수정에서 `hasMoremoreItems`로 대체됨(부분 게시 결함 발견)
- [x] (2차 M1: 게이트 축소) `shouldReplaceMoremoreData`를 `hasMoremoreItems(raw)`로 축소·개명 — 워크플로 커밋 스텝의 `git diff --staged --quiet`가 바이트 동일 재수집의 중복 커밋을 이미 막고 있어 "하루 1커밋" 판정이 불필요했고, 오히려 "기존이 오늘 데이터면 갱신 생략" 규칙이 부분 게시(이른 슬롯 1코너 커밋 → 뒤 슬롯 5코너 확정 메뉴 미반영) 결함을 만들었다. 새 함수는 "응답에 저장할 항목이 최소 1개 있는가" 하나만 판정하고, 있으면 코너 수·기존 파일과 무관하게 항상 반영한다
- [x] (2차 M2: 슬롯 분산) `.github/workflows/moremore-fetch.yml` 스케줄을 평일 KST **07:13/08:29/09:41/10:07/11:23/12:37/13:51/15:17/17:33 9슬롯**으로 재조정 — 분(minute)까지 슬롯마다 흩어 정시 직후 큐 폭주로 인한 드롭 상관을 줄이고, 오후 슬롯(15:17/17:33)으로 벤더의 당일 이미지 점진 업로드(실측: KST 11:12 업로드 확인)에 대응
- [x] (2차 M3: 실패 신호) `scripts/fetch-moremore.mjs`가 `hasMoremoreItems(raw)`가 `false`이면 파일을 건드리지 않고 `process.exitCode = 1`로 워크플로를 실패시킴 — 능동 알림 수단이 없는 상태에서 유일한 이상 탐지 신호(트레이드오프: 실제로 메뉴가 없는 주말·공휴일에도 워크플로가 붉게 뜬다) — 이후 아래 **3차 M5**에서 실패 판정을 당일 마지막 슬롯으로 한정하도록 정밀화됨
- [x] (2차 M4: 동시 실행 방어) `.github/workflows/moremore-fetch.yml`에 `concurrency: { group: moremore-fetch, cancel-in-progress: false }` 추가 + 커밋 스텝의 `git push` 직전 `git pull --rebase` 추가 — 슬롯 9개가 겹쳐 돌 때의 동시 실행·non-fast-forward 실패 방지
- [x] (3차 M5: 실패 신호 정밀화) 적대적 리뷰 지적(주중 cron 9슬롯 조합상 주말엔 실행 자체가 없어 "주말에도 붉게 뜬다"는 서술이 오류였고, 이른 슬롯의 빈 응답까지 매번 실패로 잡으면 경보 피로가 생긴다는 점)을 반영해 실패 판정을 **당일 마지막 슬롯(KST 17:33)으로 한정**했다. 워크플로가 환경변수 `MOREMORE_STRICT`를 주입(17:33 슬롯일 때만 `1`, 그 외 슬롯·`workflow_dispatch`는 `0`)하고, `scripts/fetch-moremore.mjs`에 `readStoredFetchedDate()` 헬퍼를 추가해 `hasMoremoreItems(raw)`가 `false`이고 `MOREMORE_STRICT=1`이며 **저장된 파일의 `fetchedDate`가 오늘이 아닐 때만** `exitCode=1`로 실패시킨다(앞선 슬롯이 이미 오늘 데이터를 확보했다면 실패로 보지 않음). 공휴일 오탐이 하루 최대 9건에서 **하루 최대 1건**으로 줄었다
- [x] `scripts/oracle-check.mjs`의 D16을 `hasMoremoreItems` 기준으로 재작성([oracle.md](oracle.md)) — `node scripts/oracle-check.mjs` 18 passed / 0 failed 확인. `MOREMORE_STRICT`/`readStoredFetchedDate` 조합(빈/깨진 응답 × STRICT 0·1 × 기존파일 신선/낡음/파손)은 fetch 스텁으로 실제 스크립트를 실행하는 별도 검증으로 확인(10 passed / 0 failed) — `scripts/oracle-check.mjs`에 상시 편입되지는 않은 1회성 검증
- [ ] **미해결로 남김**: KST 자정 경계 근처 `workflow_dispatch` 수동 실행 시 요청 날짜와 응답 날짜를 대조하지 않아 어제 메뉴에 오늘 라벨이 붙어 커밋될 수 있는 경로(예약 슬롯 07:13~17:33에서는 미발생, 저장 게이트가 "항목 1개 이상이면 항상 저장"만 판정해 이 경로에 방어막이 없음), 능동 알림 수단 부재(빨간 워크플로 외 없음), `git pull --rebase` 실패 시 그 슬롯 수집분 유실(재시도 루프 없음, 다음 슬롯이 메움) — `docs/spec.md` §8에 명시

## Phase 5.8 — 모락모락 카드 이미지 UI 개선(원본 비율·플레이스홀더)
> 배경: "일부 테이크아웃 메뉴는 이미지가 보이는데 중식·석식은 안 보인다, 이미지 영역을 해상도 비율에 맞춰 키워달라"는 요청 조사 결과, **이미지 부재의 원인은 파싱 버그·데이터 부재가 아니라 벤더(풀무원 모락모락)가 당일 중 이미지를 점진적으로 채우기 때문**임을 실측 확인했다(KST 10:11 수집 시 백반·스페셜 이미지 `null` → 11:12 재조회 시 업로드됨, 메뉴명도 갱신됨). 라면(TAKEOUT)·석식처럼 코너에 따라 끝내 `null`로 남는 경우도 확인됨. 실측 이미지 해상도(백반 1024×686, 스페셜 1024×752, TAKEOUT 781×479/760×445)가 코너마다 제각각(비율 1.36~1.71)이라 고정 크롭 대신 원본 비율 렌더로 결정. [oracle.md §2](oracle.md) "최초 수용 1회는 사람 판단 허용"에 해당하는 시각 요구라 자동 오라클 대신 사람 판단으로 수용됐다(도메인 D 번호 미부여, [oracle.md](oracle.md) 참고). 코드(`index.html`/`moremore.js`)는 이미 반영돼 있었고 본 Phase는 **그 반영을 문서(spec/plan/oracle/tasks/CLAUDE.md/README.md/PROMPTS.md)에 소급 반영**한 것이다.
- [x] `index.html` `.mm-*` CSS — 카드 세로형 레이아웃(이미지 상단 full-bleed), `.mm-photo`(원본 비율, 크롭 없음) + 로딩 스켈레톤(`:not(.is-loaded)` min-height) + `.mm-media-ph` 플레이스홀더(고정 3:2 비율, 그라데이션+이모지+"사진 없음" — 이 문구는 애초 "이미지 준비 전"이었다가 아래 **Phase 5.9**에서 정정됨)
- [x] `moremore.js` `renderItems()` — 카드마다 `.mm-media-ph`를 항상 렌더(사진 유무 무관), `onload`/`onerror`로 `is-loaded`/`is-failed` 클래스 토글, 인접 형제 선택자(CSS)로 사진/플레이스홀더 표시 전환
- [x] `docs/spec.md`(§4 모락모락 사진 표시 요구 + 데이터 특성 사실, §6 AC 추가) · `docs/plan.md`(카드 UI 절 신설) · `docs/oracle.md`(AC 미러 + 자동판정 부재 정직 표기) · `docs/tasks.md`(이 절) · `CLAUDE.md`(현재 상태 정정) · `README.md`(SDD 진행표) · `PROMPTS.md`(요청 이력) 문서 소급 갱신

## Phase 5.9 — 모락모락 적대적 리뷰 반영(실패신호 정밀화 + 클라이언트 견고성)
> 배경: Phase 5.7~5.8 산출물에 대한 적대적 코드리뷰에서 MAJOR/MINOR 지적을 받아 커밋 직전에 반영했다. 서버측은 위 Phase 5.7의 **3차 M5**(실패 판정을 당일 마지막 슬롯으로 한정)로 반영됐고, 아래는 클라이언트(`moremore.js`) 쪽 반영이다.
- [x] **클라이언트 캐시 재검증**: `moremore.js`의 `fetch('data/moremore-latest.json', { cache: 'no-cache' })` — 벤더가 당일 중 갱신하고 크롤러가 그때마다 파일을 다시 커밋하는데, GitHub Pages 캐시 수명 동안 낡은 파일이 잡히면 갱신분이 사용자에게 도달하지 않는 문제를 막는다
- [x] **이미지 hang 타임아웃 폴백**: 이미지 요청이 응답도 에러도 없이 매달리면 `onload`/`onerror`가 모두 발화하지 않아 로딩 스켈레톤이 영구 잔존하는 결함을 발견해, `IMAGE_TIMEOUT_MS = 8000` 후 `img.complete`가 `false`인 사진에 `is-failed`를 붙여 플레이스홀더로 넘기도록 보완
- [x] **플레이스홀더 문구 정정**: "이미지 준비 전" → **"사진 없음"**(`aria-label` 포함) — 라면(TAKEOUT)·석식처럼 끝내 이미지가 제공되지 않는 코너가 있어 "준비 전"은 오지 않을 사진을 약속하는 정직 표기 위반이라는 지적 반영
- [x] **접근성**: `<img class="mm-photo">`의 `alt`를 `alt=""`(장식 이미지)로 변경 — 바로 아래 `.mm-name-ko`가 같은 메뉴명을 텍스트로 이미 보여주므로 스크린리더 중복 낭독 방지
- [x] `docs/spec.md`(§4 사진 표시 문구·§6 AC·§8 미해결 정정) · `docs/plan.md`(카드 UI 절·크롤러 워크플로 절·데이터소스 절) · `docs/oracle.md`(AC 미러) · `docs/tasks.md`(이 절 + Phase 5.7 3차 M5) · `CLAUDE.md`(현재 상태) · `PROMPTS.md`(표 병합 오류 정정) 문서 갱신
- **검증**: `node scripts/oracle-check.mjs` 18 passed / 0 failed(회귀 없음 확인). 크롤러 게이트 조합(빈/깨진 응답 × `MOREMORE_STRICT` 0·1 × 기존파일 신선/낡음/파손, fetch 스텁으로 실제 스크립트 실행) 10 passed / 0 failed. `renderItems` 마크업(DOM 스텁, 오늘 실데이터 6행) 11 passed / 0 failed(cards=6, photos=2, placeholders=6) — 이 두 건은 `scripts/oracle-check.mjs`에 상시 편입되지는 않은 1회성 검증이다. **한계**: 헤드리스 브라우저가 없어 실제 브라우저 렌더·레이아웃(이미지 hang 타임아웃 체감 등)은 미검증, 사내망 차단으로 벤더 API 직접 호출 경로는 Actions 러너에서만 확인 가능

## Phase 6 — 배포
- [ ] `.nojekyll` + GitHub Pages 활성화(main / root)
- [ ] Kakao 앱키 허용 도메인에 Pages 도메인 등록
- [ ] 실기기(모바일) 확인 → 성공기준(spec §6) 검증

> 문서 범위: **Phase 0~4 + 4.5 + 4.6 + 5(구현) + 5.5(3탭 확장) + 5.6(모락모락 Actions 크롤러 전환) 완료**. **Phase 5.7(모락모락 예약 갱신 신뢰성 개선) 완료**(9슬롯 스케줄 다중화·`hasMoremoreItems` 저장 게이트·워크플로 실패 신호(3차 M5로 당일 마지막 슬롯 한정까지 정밀화)·`concurrency`/`git pull --rebase`·`scripts/oracle-check.mjs` D16 재작성, 18/18 PASS. 자정 경계·알림 수단 부재·`git pull --rebase` 실패 시 슬롯 유실은 미해결로 명시). **Phase 5.8(모락모락 카드 이미지 UI 개선) 완료**(원본 비율 렌더·로딩 스켈레톤·플레이스홀더 폴백을 문서에 소급 반영, 자동 오라클 없이 사람 판단으로 수용). **Phase 5.9(모락모락 적대적 리뷰 반영) 완료**(캐시 재검증·이미지 hang 타임아웃·플레이스홀더 문구 "사진 없음" 정정·`alt=""` 접근성, 오라클 18/18 PASS + 1회성 검증 10/0·11/0). Phase 6(배포)은 다음 단계.
