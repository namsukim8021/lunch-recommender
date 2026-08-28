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

## Phase 6.0 — 반경 800m·"내 위치" 버튼·Kakao 호출 절감
> 배경: (1) 추천 반경을 도보 15분(≈1,000m)에서 도보 10분(≈800m)으로 좁혀달라, (2) "내 위치" 버튼으로 기준점을 회사↔사용자 위치로 전환하게 해달라, (3) Kakao 지도 API 호출수 제한이 있으니 낭비·호출수를 줄여달라는 요청. [tracks.md §3-4](tracks.md)로 판정 — 반경·내위치는 Extension(신설 `spec §6` AC + D21), 호출 절감은 Signal(관측점 확장, 아직 배포 후 베이스라인 없음) + 상시 도메인 안전망(D17~D20, D22~D24).
- [x] `config.js` — `RADIUS: 1000→800`, `WALK_MINUTES: 15→10`
- [x] `app.js` — `WALK_METERS_PER_MIN: 67→80`(보행 4.8km/h, 국내 "도보 1분=80m" 관행). 근거: 67을 유지하면 800m가 화면에 "도보 약 12분"으로 표기돼 "800m=도보 10분" 요구와 어긋남(정직 표기 위반) — 반경이 아니라 근사 상수 쪽을 조정
- [x] `index.html` — `#my-location-btn`("📍 내 위치" ↔ "🏢 회사 기준") 추가(`다른 곳`/`최근 추천 보기`/`이력·캐시 초기화` 줄 맨 앞, 2026-08-29: "이력 초기화" 라벨을 "이력·캐시 초기화"로 변경 — 아래 적대적 리뷰 항목 참고)
- [x] `app.js` — `handleMyLocation`(기준점 토글) + `originMode`(`'company'|'geo'`) 상태 + `window.__lunchTab1.originMode` getter 추가. geolocation 옵션 `{enableHighAccuracy:false, timeout:10000, maximumAge:300000}`
- [x] `lib/core.js` — 신규 순수함수 `normalizeGeoPosition`·`describeGeolocationError`·`originLabel` (위치정보 창작 금지 + 정직 표기)
- [x] `app.js`(`buildHelpItems`) — 도움말 문구가 `originMode`를 받아 "회사에서"/"내 위치에서"를 실제 기준점에 맞춰 생성
- [x] `lib/places.js` 신설 — SDK 로드(`loadKakaoSdk`, 싱글턴)·지오코딩(`resolveCompanyCenter`, 캐시 `lunch_geocode_v1` TTL 30일)·후보 수집(`collectCandidates`, 타일 캐시 `lunch_tiles_v1` TTL 6시간·최대 120엔트리(2026-08-29: 200→120, 아래 참고) + 원 밖 타일 프루닝 + in-flight dedupe + 거리 자체 재계산)을 탭1·탭3 공유 모듈로 분리
- [x] `worldcup.js` — 자체 재구현하던 SDK 로드·지오코딩·격자 검색(`loadKakaoSdk`/`waitForExistingKakaoSdk`/`categorySearchPage`/`searchTile`/`collectCandidatesOwn`)을 전부 제거하고 `lib/places.js` 공유 함수로 대체
- [x] `lib/core.js` — 신규 순수함수 `haversineMeters`·`isTileOutsideRadius`·`tileCacheKey`·`isFreshTileCache`·`evictOldestTiles`
- [x] `lib/core.js`(`buildGridTiles`) — 4번째 인자 `{snap?: boolean}` 추가(기본 `false`는 기존 3-인자 호출과 바이트 단위로 동일, D8 무영향) + 신규 상수 `export const GRID_ANCHOR_DEG = 0.5`(구현 중 발견: `0.1`이면 앵커 대역 경계가 도보 반경 안(회사 기준 북쪽 545m)에 걸려 캐시 재사용률이 0%로 떨어지는 문제를 실측 — `0.5`로 조정해 경계를 북 22.8km/남 32.9km 밖으로 밀어냄, `cos` 오차 0.28%)
- [x] `app.js`(`recordMetrics`) — `cachedTiles`/`fetchedTiles` 계측 추가, `searchCalls`는 실제 네트워크 호출만 카운트
- [x] `scripts/oracle-check.mjs` — 도메인 오라클 D17~D24(+D19b) 추가(원 밖 타일 프루닝 무손실/스냅 격자 커버리지/스냅 격자 캐시 키 재사용+앵커 대역 경계 회귀(D19b)/거리 계산 기준점 독립성/위치정보 창작 금지+오류 매핑/타일 캐시 정합성/캐시 스키마 무오염/TTL 만료 재수집+in-flight dedupe)
- [x] 문서화 — `docs/spec.md`(UC8·§4·§6 AC·§8 미해결)·`docs/plan.md`(거리 제한/기준점 전환/Kakao 호출 절감 절)·`docs/oracle.md`(D17~D24)·`docs/tracks.md`(§3-4)·`docs/tasks.md`(이 절)·`CLAUDE.md`·`README.md`·`PROMPTS.md` 갱신

## Phase 6.0b — 1차 적대적 코드리뷰 반영 (실제 결함 2건 + 신뢰성/프라이버시 보강)
> 배경: Phase 6.0 구현 직후 적대적 코드리뷰에서 **후보가 조용히 사라지던 실제 결함 2건**이 발견됐다(기존 도메인 오라클이 통과시키고 있었음). 코드는 별도 code-writer/test-writer 에이전트가 수정했고, 이 절은 그 결과를 문서에 동기화한 것이다. D 번호 체계는 유지하되 D21의 계약이 확장되고 D25~D28이 신설됐다.

**결함 (a) 프루닝 거리함수 불일치** — `isTileOutsideRadius`(등장방형 근사)와 최종 `filterByRadius`(하버사인)가 서로 다른 거리 함수를 써서, 최근접점 하버사인 799.70m(≤800m, 반경 안)인 타일이 프루닝으로 검색 자체에서 빠지는 반례가 있었다(`center={lat:37.54638305542474,lng:127.06547994871624}`, R=800). **수정**: 프루닝 판정을 하버사인으로 통일 + `PRUNE_SAFETY_MARGIN_METERS=2`(항상 "덜 프루닝"하는 보수 방향으로만 작동) 추가. 전환 비용은 R=800/1200/1800 전 조합에서 **+0~1타일**로 사실상 없었다.

**결함 (b) 스냅 격자 커버리지 구멍** — snap 모드가 `radiusLng`(원의 실제 크기)를 `center.lat`이 아니라 **앵커 위도** 스케일로 잘못 계산해, 앵커보다 북쪽 center에서 bbox가 안쪽으로 줄어드는 경우가 있었다. `center={lat:37.74457997,lng:126.90778388}`의 정동 800m 지점(하버사인 799.10m)이 bbox 동단보다 2.38m 바깥이라 **어떤 타일에도 포함되지 않았다**. **⚠️ 이전에 이 문서(plan.md)에 쓴 "snap은 bbox를 바깥으로만 확장하므로 D8 커버리지 불변"이라는 서술은 사실이 아니었다** — 앵커 스케일로 경도 반경을 계산한 것이 원인이었다([docs/plan.md](plan.md) "Kakao API 호출 절감" 절 1번, [docs/oracle.md](oracle.md) D18에 정정 반영). **수정**: `radiusLat`/`radiusLng`는 **center.lat 기준**으로 분리 계산하고 **격자 정렬에만 앵커 스케일**을 쓰며, 스냅 전 bbox에 **타일 1칸 여유**를 추가. 그 결과 원시 타일이 25→**49**로 늘지만(여유 타일은 전부 원 밖이라 프루닝이 걷어냄) **실제 호출 경로의 타일 수는 23 그대로**다. **함정**: 프루닝 없이 `snap:true`만 쓰는 새 호출자가 생기면 타일 수가 2배(25→49)가 된다(§8에 명시).

**정직 표기·프라이버시**
- [x] `normalizeGeoPosition` 반환 계약 확장 — `{lat, lng, accuracy: number|null} | null`. `accuracy`가 추천 반경보다 크면(데스크톱 WiFi/IP 측위가 ±20km도 준다) 전환은 진행하되 화면에 경고를 표시(무단 거부보다 고지가 낫다는 판단).
- [x] 도움말 모달 항목 5 → **8개**로 확장 — 캐시 최대 6시간(`TILE_CACHE_TTL_MS` 직접 읽어 표기)/geolocation `maximumAge` 최대 5분 전 위치 재사용+저정확도 경고/검색 결과가 이 기기에만 저장되고 서버 전송 없음(+"이력·캐시 초기화"로 삭제 가능).
- [x] 결과 카드 도보 문구에 근거 표기 추가 — `"도보 1분=${WALK_METERS_PER_MIN}m 관행 기준 근사"`.
- [x] 헤더(`#app-subtitle`)가 기준점을 추종 — "회사 주변에서, 최근이랑 안 겹치게 골라드려요" ↔ "내 위치 주변에서, …". 헤더는 짧은 라벨, 도움말은 `originLabel`로 전체 주소(공간 제약과 정확성 분리).
- [x] 월드컵 화면에 `#worldcup-origin` 기준점 표기 추가.
- [x] **설계 결정 정정(이전 서술 뒤집힘)** — 최초 구현은 `handleResetHistory`가 `clearTileCache()`를 의도적으로 호출하지 않았다("이력 초기화 때마다 콜드 재수집 강제 → 호출 절감 무력화" 우려). **뒤집혔다**: 타일 캐시 키가 절대 좌표라 사용자가 있던 위치가 최대 6시간 남는데 지울 수단이 없었다(프라이버시 결함). `handleResetHistory`에 `clearTileCache()`를 연결하고 버튼 라벨을 **"이력·캐시 초기화"**로 변경. 캐시 삭제는 사용자가 명시적으로 누를 때만 일어나므로 절감 효과는 유지되고, 위치 데이터 통제권이 새로 생긴다.

**신뢰성**
- [x] SDK 싱글턴 검사 순서 수정 — `autoload=false`면 `services` 없는 스텁 상태에서 두 번째 호출자가 잘못 resolve되던 결함(로딩 중 탭3 클릭 → TypeError → `loadedOnce=true`로 새로고침 전까지 탭3 영구 사망) 수정. 이제 싱글턴을 먼저 검사하고 `services` 존재까지 확인.
- [x] `Promise.all` → `Promise.allSettled` — 타일 1개 실패로 성공분 전체가 폐기되던 문제 수정. 검증: 23타일 중 3타일 실패 시 20타일 캐시 적재, 재시도 추가 호출 3회(실패분만).
- [x] 탭3 기준점 추종 — `__lunchTab1.originMode` getter가 죽은 코드였던 결함(탭3를 먼저 열고 탭1에서 내 위치로 바꾸면 탭3가 회사 기준으로 계속 진행) 수정. 수집 시점 기준점 서명을 기억해 불일치 시 풀 무효화·재수집. `loadedOnce` → `collectedOrigin`/`collecting`으로 교체(실패 후 재시도 가능).

**세부**
- [x] 캐시 엔트리 캡 `200 → 120`(200 ≈ 3.4MB/UTF-16, 5MB 한도에 여유 30%뿐 — 초과 시 `saveRecent`가 조용히 실패해 "최근 10곳 제외"가 죽을 수 있음 → 120 ≈ 2MB).
- [x] in-flight dedupe 키를 소수 5자리 반올림(원시 부동소수라 탭1·탭3가 같은 스냅 타일 집합을 원해도 dedupe가 안 걸렸다).
- [x] 캐시 write를 read-modify-write로 변경(겹친 두 수집 중 나중 것이 먼저 것의 신규 타일을 날리던 경합 수정).
- [x] `categorySearch`의 `location` 파라미터 제거(bounds와 함께 쓰면 정렬에 영향을 줘 캐시 오염 경로가 될 수 있음. distance는 하버사인으로 직접 계산).
- [x] `lib/places.js`가 `TILE_CACHE_TTL_MS` export — 도움말 문구가 상수를 직접 읽어 표기 드리프트 방지.
- [x] `toCachedPlace` 필드 변경 시 캐시 키 버전을 올려야 한다는 규칙 주석 추가.
- [x] 후보 0건 조기 반환 시 계측이 유실·전이되던 문제 수정(`recordSearchMetrics`).
- [x] `config.js` `WALK_MINUTES`에 "코드 미사용 참고값" 주석(실제 계산은 `WALK_METERS_PER_MIN`).
- [x] 내 위치 토글 버튼에 `aria-pressed` 배선, SDK 로드 실패 시 `<script>` 태그 제거.
- [x] `scripts/oracle-check.mjs`에 D25(`evictOldestTiles` 경계 계약)·D26(`Promise.allSettled` 부분 실패 보존)·D27(SDK 싱글턴 순서)·D28(in-flight dedupe 키 반올림) 추가.
- [x] 문서화 — `docs/spec.md`(UC4/UC5/UC8·§6 AC·§8 신규 4건)·`docs/plan.md`(정정 2건 + 신뢰성 보강 목록)·`docs/oracle.md`(D17/D18/D21 계약 정정, D25~D28 신설)·`docs/tracks.md`(D-번호 갱신)·`docs/tasks.md`(이 절)·`CLAUDE.md`·`README.md`·`PROMPTS.md` 갱신

**실측 수치(회사 좌표 근사값 `{lat:37.5451, lng:127.0554}` 기준, 코드 직접 실행 확인)**:
- 타일 수(반경 800m, 프루닝 후 실제 검색 대상): `snap:false` 18개(최대 54회) vs 실제 경로 `snap:true` 23개(최대 69회, 격자 원시는 결함 수정 후 25→**49**로 늘었지만 프루닝이 걷어내 검색 대상은 23 그대로) — **절대 격자 정렬이 콜드(첫 방문) 호출 수를 오히려 27.8% 늘린다.**
- 캐시 재사용률(기준점 이동 후 `tileCacheKey` 교집합, 24방향 평균, 커버리지 결함 수정 반영): 5m 100.0% / 100m 98.4% / 300m 84.6% / 600m 67.1% / 800m 54.7% — `snap:false`는 전부 0.0%
- 모의 SDK 종단 시뮬레이션(실제 Kakao 호출 횟수 환산): 같은 기준점 재방문(6시간 내, 23/23 히트) 0회, 137m 이동 재수집 16회→2회
- 커버리지 몬테카를로: **최초 좌표당 표본 2,000점으로는 위 결함(b) 반례(정동 800m 지점)를 놓쳤다**(정직하게 남긴다) — 표본을 좌표당 **20,000점**(총 약 500만점)으로 올리고 실측 반례 2곳을 회귀 케이스로 고정한 뒤 재실행하면 회사/앵커 대역 경계 위아래/반례 좌표 전부 미포함 0건(D18)

**미해결/트레이드오프(§8에 명시, Phase 6.0b 시점)**: 콜드 방문 호출 순증(+27.8%), 앵커 위도 대역(`GRID_ANCHOR_DEG=0.5`) 경계를 사이에 둔 두 기준점은 캐시 미공유(경계 간격 ~55km라 실사용에서 거의 안 밟힘), `GRID_ANCHOR_DEG`를 다시 줄이면 캐시 무효화 퇴행 재발(D19b가 회귀 방지), `PRUNE_SAFETY_MARGIN_METERS`를 0 이하로 낮추면 프루닝 유실 재발 위험, 프루닝 없이 `snap:true`만 쓰는 호출자가 생기면 타일 수 2배, 타일 캐시 TTL(6시간) 동안 신규 개업/폐업 미반영, geolocation은 HTTPS/localhost 전용, 저정확도 경고는 상태줄 1회성(→ **Phase 6.0c에서 해결**), `accuracy` 음수는 걸러지지 않음(→ **Phase 6.0c에서 해결**), 실기기 위치 권한 팝업·`aria-pressed` 낭독은 헤드리스 환경 부재로 자동 검증 불가, localStorage 용량 초과 시 캐시가 조용히 비워질 수 있음.

## Phase 6.0c — 2차 적대적 코드리뷰 반영 (코드 확정)
> 배경: Phase 6.0b 산출물을 한 번 더 적대적으로 리뷰해 새 결함·개선을 반영했다. **이 라운드를 끝으로 Phase 6.0 코드는 확정됐다**(더 이상 바뀌지 않는다). 이 절은 그 결과를 문서에 동기화한 것이다.

- [x] **초기화 경합(2중 방어)** — 검색 진행 중 "이력·캐시 초기화"를 눌러도 수집 완료 시점의 read-modify-write가 방금 지운 엔트리를 되살리던 결함(실측: 초기화 후 23개 재기록) 수정. `setBusy()`가 초기화 버튼도 잠그고, `lib/places.js`에 캐시 세대 카운터(`cacheGeneration`)를 둬 수집 중 초기화가 있었으면 그 수집분 저장을 건너뛴다(2중 방어). 수정 후 잔존 엔트리 0개
- [x] **캐시 캡을 소프트 캡으로 전환** — 캡(120)이 단일 수집 타일 수보다 작아지는 반경(R=2700→172타일) 구간에서 자기 수집분이 스스로 밀려나 곧장 콜드 재요청(`fetchedTiles=52`)이 나던 역전 수정. `evictOldestTiles(cacheMap, maxEntries, protectedKeys=[])`에 3번째 인자(보호 키) 추가(미지정 시 기존 동작 그대로, D25 무영향; 동률 `ts`는 나중에 삽입된 키 생존). 수정 후 R=2700 재수집 `fetchedTiles=0`/`cachedTiles=172`; 800→1200→1800 누적 확대 후 R=800 재수집도 `fetchedTiles=0`
- [x] **탭3 재수집 규칙 정교화** — 기준점 서명에 `radius` 포함, 수집 중 들어온 탭 활성화를 `pendingActivate`로 보관 후 완료 시 재확인, 재수집 조건을 `current.radius > collected.radius`로 한정, 탭3 자체 수집 경로 반경 소스를 `CONFIG.RADIUS`→`__lunchTab1.radius || CONFIG.RADIUS`로 변경(안 그러면 탭 전환마다 재수집 반복). 검증: 탭1 800→1200 후 탭3 복귀 시 SDK 호출 23→42(19만 신규), 조건 변화 없는 4회 왕복은 23→23
- [x] **탭3 반경 확대 더블클릭 방지** — 연타 시 표기가 의도 반경(미완성 풀)을 보여주던 정직 표기 위반 + 늦은 수집이 진행 중 토너먼트를 리셋하던 문제 수정. 수집 중 버튼 잠금 + 표기는 `collectedOrigin.radius`(실제 풀)만 사용
- [x] **저정확도 경고를 상시 배지로 분리** — 상태줄 겸용이 검색 실패 안내를 덮어쓰고 1회성이던 문제 해결. 전용 `#geo-accuracy-notice`(`role="status"`)로 `originMode==='geo' && accuracy>currentRadius`인 동안 계속 표시
- [x] **접근성 정정(WAI-ARIA APG)** — `aria-pressed`가 라벨 토글(`🏢 회사 기준`)과 겹쳐 내 위치 활성 시 "회사 기준 버튼, 눌림"으로 낭독(실제와 정반대)되던 결함 수정. 라벨 `📍 내 위치` 고정 + `aria-pressed`/`.is-active`/헤더 문구로만 상태 전달
- [x] **삭제 범위·문구 정합** — `handleResetHistory`에 `clearMetrics()`(→ `lunch_metrics`) 추가, `lunch_geocode_v1`(회사 주소, 개인 위치 아님)은 예외로 유지하고 도움말에 그 예외 명시
- [x] **데드 코드 제거** — `worldcup.js`의 미사용 `escapeHtml`, `app.js`의 미사용 `geoCenter`, 즉시 덮이던 상태 문구. `#worldcup-origin`은 비었을 때 `hidden`
- [x] `scripts/oracle-check.mjs`에 **D29**(`resolveCompanyCenter` 지오코딩 캐시 콜드/웜/TTL만료/시계뒤틀림/`config.CENTER`우선/실패시 캐시미기록 — 이전 스텁이 항상 ZERO_RESULT라 이 경로들이 한 줄도 실행되지 않고 있었음을 2차 리뷰가 지적), **D30**(다중 페이지/ZERO_RESULT/`MAX_PAGES_PER_TILE`상한/`QuotaExceededError` 흡수), **D31**(`GRID_ANCHOR_DEG` 대역 경계를 사이에 둔 두 좌표의 캐시 키 교집합이 정확히 0임을 의도적으로 박제 — 실패가 아니라 설계상 알려진 특성) 추가
- [x] **D17 픽스처 보강** — 기존 반례 하나로는 "haversine에서 등장방형으로 되돌리되 마진(2m)은 남긴" 유형의 회귀를 놓친다(최근접점 등장방형 800.613m가 800+2 미만이라 통과)는 점을 발견해, 이 유형을 잡는 조합을 국내 좌표대(위도 33~43N×경도 126~129E)×반경(800~8000m)에서 탐색 — **실사용 반경(800/1200/1800m)에서는 그런 조합이 0건**(500건 발견, 전부 반경 2500m 이상)이라는 사실을 정직하게 기록하고, 최종 회귀 케이스로 `center={lat:35,lng:129}, radius=8000`(haversine 7999.89m ≤ 8000, 등장방형 8010.11m > 8002) 채택
- [x] **스텁 충실도 보강** — `QuotaExceededError`를 던지는 localStorage 스텁, `parentNode`를 가진 document 스텁 추가로 이전엔 검증 없이 통과하던 저장 실패·SDK 재시도(D27 3번째 시나리오) 경로까지 실제로 확인
- [x] `docs/tasks.md`·`docs/spec.md`(§6 AC·§8 정리 — "저정확도 경고 1회성" 해결로 정정 + 소프트 캡·pending 잔존 항목 신규)·`docs/plan.md`(2차 적대적 리뷰 반영 절 신설)·`docs/oracle.md`(D29~D31, D17 픽스처 보강)·`docs/tracks.md`·`CLAUDE.md`·`README.md`·`PROMPTS.md` 문서 갱신

**최종 확정 검증치(2회 실행 stdout 동일 = 결정적, 더 이상 바뀌지 않음)**: `node scripts/oracle-check.mjs` → **`TOTAL: 34 passed, 0 failed, 0 skipped`**(D1~D16 18건 + D17~D24 8건 + D19b 1건 + D25~D31 7건)

**§8 최종 정리**: "저정확도 경고 1회성" 항목은 **해결됨**으로 정정. 신규 — 캐시 소프트 캡(R=2700 직후 구간 추정 2.9MB, 5MB 한도 대비 여유 가장 얇음), `pendingActivate`가 수집 **실패** 경로에서 남지만 다음 실제 activate에서 정상 처리(무한 재수집 없음). 유지 — 헤드리스 환경 부재로 실제 렌더·위치 권한 프롬프트·`aria-pressed` 낭독·배지 표시·버튼 비활성은 스텁 수준까지만 검증(실기기 확인은 사람 몫), 45개 상한에 걸리는 밀집 타일에서 `location` 파라미터 제거로 어느 45개가 오는지 달라질 수 있고 `isPageTruncated`는 `console.warn`만 하며 화면 고지 없음(자동 오라클 없음).

## Phase 6 — 배포
- [ ] `.nojekyll` + GitHub Pages 활성화(main / root)
- [ ] Kakao 앱키 허용 도메인에 Pages 도메인 등록
- [ ] 실기기(모바일) 확인 → 성공기준(spec §6) 검증

> 문서 범위: **Phase 0~4 + 4.5 + 4.6 + 5(구현) + 5.5(3탭 확장) + 5.6(모락모락 Actions 크롤러 전환) 완료**. **Phase 5.7(모락모락 예약 갱신 신뢰성 개선) 완료**(9슬롯 스케줄 다중화·`hasMoremoreItems` 저장 게이트·워크플로 실패 신호(3차 M5로 당일 마지막 슬롯 한정까지 정밀화)·`concurrency`/`git pull --rebase`·`scripts/oracle-check.mjs` D16 재작성, 18/18 PASS. 자정 경계·알림 수단 부재·`git pull --rebase` 실패 시 슬롯 유실은 미해결로 명시). **Phase 5.8(모락모락 카드 이미지 UI 개선) 완료**(원본 비율 렌더·로딩 스켈레톤·플레이스홀더 폴백을 문서에 소급 반영, 자동 오라클 없이 사람 판단으로 수용). **Phase 5.9(모락모락 적대적 리뷰 반영) 완료**(캐시 재검증·이미지 hang 타임아웃·플레이스홀더 문구 "사진 없음" 정정·`alt=""` 접근성, 오라클 18/18 PASS + 1회성 검증 10/0·11/0). **Phase 6.0(반경 800m·"내 위치" 버튼·Kakao 호출 절감) 완료**(`WALK_METERS_PER_MIN` 67→80·`lib/places.js` 신설(SDK/지오코딩/타일 캐시 공유)·`buildGridTiles` `{snap}`+`GRID_ANCHOR_DEG=0.5`·원 밖 타일 프루닝·in-flight dedupe·거리 자체 재계산). **Phase 6.0b(1차 적대적 코드리뷰 반영) 완료** — 도메인 오라클이 통과시키고 있던 실제 결함 2건(프루닝 거리함수 등장방형/하버사인 불일치, 스냅 격자 커버리지 구멍) 수정 + 정확도 경고·헤더/월드컵 기준점 추종·"이력·캐시 초기화"(설계 결정 뒤집힘)·SDK 싱글턴/`Promise.allSettled`/read-modify-write 등 신뢰성 보강. 오라클 D17~D28(+D19b)로 확장. **Phase 6.0c(2차 적대적 코드리뷰 반영) 완료** — 초기화 경합 2중 방어(캐시 세대 카운터)·캐시 소프트 캡(`evictOldestTiles` `protectedKeys`)·탭3 반경 인지 재수집 규칙·반경 확대 더블클릭 방지·저정확도 상시 배지 분리·`aria-pressed` 접근성 정정(WAI-ARIA APG)·삭제 범위 정합(`clearMetrics`+지오코딩 예외)·데드 코드 제거. 오라클 D29~D31 추가(D29 지오코딩 캐시 전체 계약, D30 다중페이지/ZERO_RESULT/용량초과, D31 앵커 대역 경계 캐시 미공유 박제) + D17 픽스처 보강. **이 라운드를 끝으로 Phase 6.0 코드는 확정됐다** — `node scripts/oracle-check.mjs` **34 passed / 0 failed / 0 skipped**(2회 실행 동일, 확정값). 콜드 호출 순증(+27.8%)·소프트 캡 구간 캐시 팽창(~2.9MB) 등 트레이드오프는 §8에 명시. Phase 6(배포)은 다음 단계.
