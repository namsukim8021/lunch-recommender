# 📝 프롬프트 이력 (Prompt History)

이 프로젝트(점심 추천)에 요청한 프롬프트를 시간순으로 남긴다. (SDD 산출물 추적·재현용)
새 요청이 있을 때마다 맨 아래에 한 줄 추가한다.

> ⚠️ 이 레포는 **public** 이므로, 회사 내부 정보가 포함된 프롬프트/값(토큰·내부 URL·티켓키 등)은 여기에 기록하지 않는다.

| # | 날짜 | 요청(프롬프트) | 결과 / 산출물 |
|---|------|--------------------|----------------|
| 1 | 2026-07-08 | "SDD 기반의 회사 주변 점심식사 식당과 메뉴 추천해주는 웹사이트를 만들고 싶어. 어떤 순서로 하면 좋을지 플랜 먼저 세워줘." | SDD 로드맵(Phase 0~6) 제시 + 핵심 결정 질문 |
| 2 | 2026-07-08 | (결정) 데이터=Kakao 지도 JS SDK · 추천=랜덤+최근 안 겹치게 · 범위=개인용(정적·무료). "github.com에 개인 레포 하나 우선 만들고 진행하자. 내가 요청하는 프롬프트는 남기는 프롬프트 이력 히스토리 파일도 하나 만들어줘. 그 이후 kakao 지도 연동으로 진행해줘." | 레포 생성 + SDD 문서(constitution/spec/plan/tasks) + README + 본 이력 파일 |
| 3 | 2026-07-08 | "오늘은 스펙만 작성하고 실제 구현은 다음에 진행할거야." | Phase 0~4(스펙/설계)까지만 커밋. 구현(Kakao 연동·index.html)은 다음 세션 보류 |
| 4 | 2026-07-08 | "PROMPTS.md에 이번 대화 프롬프트 다 기록해줘" | 점심 프로젝트 대화 프롬프트(1~4) 정리 기록. 동일 세션의 사내 업무 요청은 public 레포라 제외(비공개 로그로 별도 보관 가능) |
| 5 | 2026-07-08 | "점심메뉴 추천이므로 점심영업 하는 식당만 리스트업되어야 한다. 그 제한 조건이 들어있는지 체크. 회사 주소=서울특별시 성동구 아차산로13길 11, 도보 15분 이내 식당만." | 체크 결과 미포함 확인 → spec/plan/tasks에 점심영업 제약(근사·한계 명시)·회사 주소·도보 15분 반경 반영 |

| 6 | 2026-07-08 | "스펙상 부족한 부분 한번 더 체크 + 파일별 리뷰. 업종/대표 카테고리 힌트로 메뉴를 더 추측하게 하고, red·yellow flag 개선점 모두 반영해줘." | 파일별 스펙 리뷰 후 🔴·🟡 반영: 메뉴 힌트 도출(리프+매핑), Kakao 45개 상한 격자분할 완화, 빈 후보 UX, 도보/직선 거리 정직표기, 지오코딩 실패 처리, 목표-스펙(메뉴) 일치, tasks/README 갱신 (🟢는 보류) |

| 7 | 2026-07-08 | 사내 위키(SDD 기초)대로 진행되는지 검토 후 "보완 진행해줘". | Harness 3계층 정렬: `CLAUDE.md`(상시 규약·Constrain/Inform) + `.claude/skills/sdd-cycle`(Verify·Correct 절차) 추가, 운영원칙(코드 직접수정 금지·스펙=oracle) 명문화, README/tasks 반영 |

| 8 | 2026-07-22 | 스터디 3회차(오라클 프레임워크: 바이너리/명세/도메인 오라클, 콜드 스타트) 발표자료 내용을 이 레포에 반영해줘. | `docs/oracle.md` 신설(3층 오라클·도메인 규칙 D1~D7·콜드 스타트·성숙도) + CLAUDE.md 검증원칙을 3층 오라클로 확장 + `sdd-cycle` VERIFY/CORRECT 단계 배선 + README/tasks 갱신. 현 오라클 성숙도 L0→L1(구현 수용 시 L2 목표) |

| 9 | 2026-07-22 | (오라클 PR 자체 리뷰) "자체 리뷰를 통해 개선할 부분 있다면 코멘트 남겨줘" → 이어 반영 진행. | 프레시 콜드 리뷰 후 반영: 성숙도 사다리를 **명세-우선**으로 재정의(현재 L1)·상태표기 ✅→3단계(📝/⏳/🔲)·golden **결정성 전제**(주입가능 PRNG, plan.md 설계 불변식)·**D8/D9 추가**(격자 피복·좌표 날조 금지)·D3를 측정가능하게 조임·UI/UX는 시각 스냅샷 오라클로 라우팅·"사람 눈 금지"를 회귀 한정으로 조건화·파이프라인 SPEC→LLD 정정 |

| 10 | 2026-08-12 | 스터디 4회차(검증 트랙 5종: Regression/Migration/Extension/Signal/Probabilistic + BluePill·Shadow Diff) 발표자료 내용을 고려해 이 레포도 개선하고 PR 생성해줘. | `docs/tracks.md` 신설(트랙 5종 ↔ 이 프로젝트, 트랙별 **선행 조건**과 현재 가부) + 갭 2건 반영: **Signal 관측점 부재** → plan.md 계측 설계(`elapsedMs`·`searchCalls`·`candidateCount`) · **Probabilistic 요구 부재** → spec §4·§6 분포 요구 + 도메인 **D10**(쏠림 없음). oracle.md 판정표에 트랙 열·미러 동기화, CLAUDE.md·sdd-cycle에 "트랙 선택" 단계, tasks Phase 4.6 신설 + 5.4/5.9에 선행 조건 명시 |
| 11 | 2026-08-25 | harness 기반으로 준비 중이던 이 레포에 대해 인터뷰 형식으로 미확정 사항(Kakao 앱키 보유 여부·구현 범위·`RADIUS` 값·자동 오라클 검증기 포함 여부)을 먼저 확인한 뒤, Phase 5(화면 구현: `config.js`/`lib/core.js`/`app.js`/`index.html`) 전체와 도메인 오라클 자동 검증기(`scripts/oracle-check.mjs`)를 함께 구현해줘. | 인터뷰로 미확정 항목 확정(앱키 보유·범위·RADIUS·오라클 자동검증 포함) 후 Phase 5 전체 구현(지도·격자검색·필터·메뉴힌트·난수원 주입·이력·계측) + `scripts/oracle-check.mjs`(도메인 D1~D10 자동 점검 + D10 분포 판정기) 동시 작성. tasks/README/CLAUDE.md/tracks.md/oracle.md 진행상태 갱신 |
| 12 | 2026-08-25 | 배포 확인 완료 후, 추천 로직을 궁금해하는 사용자를 위해 타이틀 옆 '?' 아이콘 → 클릭 시 레이어 팝업으로 추천 로직 설명(반경/야간업종 제외/최근이력 제외/랜덤선택/메뉴힌트 근거, config 값 기반 동적 생성)을 추가. | spec.md(UC5·성공기준)·plan.md(UI 절)·tasks.md(5.10) 갱신 |
| 13 | 2026-08-25 | 최상단 3개 탭 신설 요청(탭1 기본·탭2 모락모락 구내식당 오늘의 메뉴·탭3 점심메뉴 월드컵), 모락모락 조회 실패/빈 결과를 "준비중입니다"로 통합 처리 요구. 구현 후 push·PR 생성·머지까지 요청. | 착수 중 **로컬 클론의 `main`이 2026-08-19에 멈춰 있었고, 같은 날 별도 세션이 진짜 `origin/main`에 다른 아키텍처(lib/core.js+app.js, ES모듈)로 Phase 5를 재구현하고 팝업 기능까지 이미 머지**해둔 사실을 발견. 실제 `origin/main`을 진실로 채택하고 그 위에서 3탭 기능을 다시 계획·구현하기로 함(로컬 전용 이력은 `archive/*` 브랜치로 보관, push 안 함) |
| 14 | 2026-08-25 | (13의 재구현) | `docs/spec.md`(UC6·UC7·§4·§6)·`docs/plan.md`·`docs/oracle.md`(D12~D15)·`docs/tracks.md`·`docs/tasks.md`(Phase 5.5) 문서 갱신 → `lib/core.js`(`parseMoremoreResponse`·`buildWorldcupPool`·`pairMatches`·`nextRoundParticipants`)·`app.js`(탭3 재사용용 `window.__lunchTab1` getter 1블록만 추가, 그 외 무수정)·신규 `tabs.js`/`moremore.js`/`worldcup.js`·`index.html`/`config.js` 확장·`scripts/oracle-check.mjs`에 D12~D15 추가. 적대적 코드리뷰로 CSS 스코프 누락(탭2/3 스타일 미적용)·Kakao SDK 중복 로드 가드 부재를 발견해 보완. `node scripts/oracle-check.mjs` **17 passed / 0 failed** |
| 15 | 2026-08-25 | 탭2 모락모락이 배포 사이트에서 계속 안 뜨는 문제 조사 요청. 브라우저 직접 fetch가 CORS로 실제 차단됨을 진단 워크플로로 실측 확인한 뒤, 아키텍처를 서버사이드 크롤러 방식으로 전환. | GitHub Actions 예약 워크플로(`.github/workflows/moremore-fetch.yml`, 당초 평일 KST 09:00 1회) + `scripts/fetch-moremore.mjs`(서버사이드 fetch, 외부 의존성 0개)가 `data/moremore-latest.json`(`{fetchedDate, raw}`)을 커밋 → `moremore.js`는 같은 오리진 정적 파일만 fetch. `lib/core.js`에 `isFreshMoremoreData(fetchedDate, todayDate)` 추가로 날짜 불일치(4번째 실패 경로)를 판정. `config.js`에서 클라이언트가 더 이상 안 쓰는 모락모락 API 상수 제거. 진단용 워크플로 삭제. `docs/spec.md`·`docs/plan.md`·`docs/oracle.md`(D12 4경로 확장)·`docs/tasks.md`(Phase 5.6) 갱신 |
| 16 | 2026-08-26~27 | 배포 사이트에서 탭2가 계속 "준비중입니다"만 뜨는 문제 재조사 요청. GitHub Actions 예약(cron)이 실제로 드롭·지연됨을 실측 확인(2026-08-26 1시간 지연 발동, **2026-08-27 예약분은 발동 자체가 없었음**)한 뒤, 예약 갱신 신뢰성을 개선. 1차 조치(단일 슬롯 → 매시 다중 슬롯 재시도 + "하루 1커밋" 저장 게이트) 이후 적대적 리뷰에서 그 게이트의 정당화 근거가 자기모순(중복 커밋은 워크플로의 `git diff --staged --quiet`가 이미 막고 있음)이며 부분 게시 결함(이른 슬롯 1코너 커밋이 뒤 슬롯의 확정 메뉴 반영을 막음)이 있다는 지적을 받아 2차로 게이트를 단순화. | (1차) 스케줄을 평일 KST 07:05~13:05 매시로 다중화 + `lib/core.js`에 `shouldReplaceMoremoreData(existing, incoming, todayDate)` 추가. (2차) `shouldReplaceMoremoreData`를 `hasMoremoreItems(raw)`(빈/이상 응답이면 저장 안 함, 한 가지만 판정)로 축소·개명해 부분 게시 결함 제거 + 스케줄을 KST 07:13/08:29/09:41/10:07/11:23/12:37/13:51/15:17/17:33 9슬롯으로 재조정(분 단위까지 분산해 정시 큐 폭주로 인한 드롭 상관 완화, 오후 슬롯은 벤더의 당일 이미지 점진 업로드 대응) + 빈/이상 응답 시 워크플로를 `exitCode=1`로 실패시켜 유일한 이상 탐지 신호로 삼음(트레이드오프: 공휴일에도 워크플로가 붉게 뜸) + `concurrency`(cancel-in-progress: false)와 `git pull --rebase`로 슬롯 9개 동시 실행 방어. `scripts/oracle-check.mjs`의 D16을 `hasMoremoreItems` 기준으로 재작성(18/18 PASS). `docs/spec.md`(§8 미해결 항목 추가: KST 자정 경계·알림 수단 부재)·`docs/plan.md`·`docs/oracle.md`(D16)·`docs/tasks.md`(Phase 5.7)·`README.md`·`CLAUDE.md` 갱신 |
| 17 | 2026-08-27 | "일부 테이크아웃 메뉴는 이미지가 보이는데 중식·석식 메뉴는 이미지가 보이지 않는다. 이미지 영역 크기를 해상도 가로 세로 비율에 맞추고 좀 더 키워서 이미지로 메뉴 인지가 될 수 있도록 개선해달라." 이어 이 UI 변경(코드는 이미 반영됨)을 문서(spec/plan/oracle/tasks/CLAUDE.md/README.md)에 소급 반영 요청. | 원인 재조사 결과 파싱 버그·데이터 부재가 아니라 **벤더가 당일 중 이미지를 점진적으로 채우는 것**이 원인임을 실측 확인(KST 10:11 수집분 이미지 `null` → 11:12 재조회 시 업로드, 코너별 이미지 실측 해상도 비율 1.36~1.71로 상이). `index.html`/`moremore.js`의 카드를 세로형(이미지 상단 full-bleed, 원본 비율 렌더·크롭 없음)으로, 사진 부재/로드 실패는 "이미지 준비 전" 플레이스홀더로 폴백하도록 이미 반영돼 있던 코드를 확인 후 `docs/spec.md`(§4 요구+데이터 특성, §6 AC)·`docs/plan.md`(카드 UI 절 신설)·`docs/oracle.md`(AC 미러, 자동 오라클 부재를 정직 표기)·`docs/tasks.md`(Phase 5.8)·`CLAUDE.md`·`README.md`에 문서 소급 반영(코드 무변경) |

<!-- 다음 요청부터 아래에 이어서 기록 -->
