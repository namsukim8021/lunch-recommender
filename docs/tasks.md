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

## Phase 6 — 배포
- [ ] `.nojekyll` + GitHub Pages 활성화(main / root)
- [ ] Kakao 앱키 허용 도메인에 Pages 도메인 등록
- [ ] 실기기(모바일) 확인 → 성공기준(spec §6) 검증

> 문서 범위: **Phase 0~4 + 4.5 + 4.6 + 5(구현) 완료**. Phase 6(배포)은 다음 단계.
