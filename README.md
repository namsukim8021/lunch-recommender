# 🍚 점심 뭐 먹지 (lunch-recommender)

회사 주변 점심 식당을 **랜덤 + 최근 안 겹치게** 추천해주는 개인용 정적 웹사이트.

- **방식**: SDD(Spec-Driven Development) — 명세(WHAT/WHY) 먼저, 그로부터 설계·구현 파생
- **데이터**: Kakao 지도 JS SDK (카테고리 FD6 음식점 검색, 도메인 제한 JS키)
- **추천**: 반경 내 식당 랜덤 1곳, 최근 추천은 제외(localStorage)
- **호스팅**: GitHub Pages (정적·무료), 백엔드 없음

## Harness 구조 (SDD 3계층 — 사내 위키 정렬)
| 계층 | 파일 | 하네스 축 |
|---|---|---|
| 상시 규약·컨텍스트 | [`CLAUDE.md`](CLAUDE.md) | Constrain·Inform |
| 명세·설계·원칙·**정답기준**·**판정방법** | `docs/spec.md`(SPEC) · `docs/plan.md`(LLD) · `docs/constitution.md` · [`docs/oracle.md`](docs/oracle.md)(3층 오라클) · [`docs/tracks.md`](docs/tracks.md)(검증 트랙 5종) | Inform |
| 절차 표준화(생성→검증→보완) | `.claude/skills/sdd-cycle` | Verify·Correct |

**운영 원칙**: 코드를 직접 고치지 말고 **스펙을 보완해 재생성** · 생성물은 **3층 오라클**(명세·도메인·바이너리)로 판정하되, **어느 트랙으로 판정할지 착수 전에 정한다**. 상세는 [CLAUDE.md](CLAUDE.md) · [docs/oracle.md](docs/oracle.md) · [docs/tracks.md](docs/tracks.md).

## 무엇이 정답인가 — 3층 오라클 ([docs/oracle.md](docs/oracle.md))
"스펙대로 만들었나"에 더해 "**이 결과가 맞는지 뭘로 판정하나**"를 정의한다.
| 오라클 | 질문 | 이 레포에서 | 상태 |
|---|---|---|---|
| 명세 | "스펙대로인가?" | `spec §6` AC (전량 미러) | 📝 판정기준 확립(통과 코드는 Phase 5) |
| 도메인 | "상식적으로 맞나?" | 반경·야간제외·중복없음·창작금지·키안전·격자피복·좌표날조금지 등 불변식 D1~D10 | 📝 규칙 정의 · ✅ 자동점검 구현(scripts/oracle-check.mjs) |
| 바이너리 | "이전과 같나?" | 수용 시 golden 스냅샷 → 이후 regression | 🔲 콜드 스타트(구현 수용 후 생성) |

<sub>상태 범례: 📝 규칙/기준 정의됨(문서) · ⏳ 자동 점검 미구현(Phase 5) · 🔲 미생성. (아래 "SDD 진행 단계"의 ✅/🔲와는 별개 — 그건 Phase 완료 여부)</sub>

## 어떻게 판정하나 — 검증 트랙 5종 ([docs/tracks.md](docs/tracks.md))
오라클이 "정답의 출처"라면, 트랙은 "그 정답과 **언제 무엇을 비교하는가**"다. **트랙은 다 만든 뒤 고르는 메뉴가 아니라 코드를 쓰기 전으로 거슬러 오는 설계 제약**이다.
| 트랙 | 비교 | 이 레포에서 | 상태 |
|---|---|---|---|
| Extension | A + α vs Spec | `spec §6` AC + 도메인 D1~D10 | 📝 기준 확립(실행은 Phase 5) |
| Regression | A vs A′ | 수용 시 golden 박제 | 🔲 콜드 스타트 |
| Probabilistic | P(A) ≈ P(A′) | 추천 분포 쏠림 없음(D10) | ✅ 판정기 구현(scripts/oracle-check.mjs D10) |
| Signal | σ(A) vs σ(A′) | `elapsedMs`·`searchCalls`·`candidateCount` 계측 | 🔲 미착수 |
| Migration | A vs B | 지도 SDK 교체 시 발동 | ➖ 해당 없음 |

<sub>범례: 📝 기준 정의됨 · ⏳ 자동 점검 미구현 · 🔲 미생성 · ➖ 해당 없음</sub>

> **Regression·Probabilistic은 "난수원 주입"이라는 설계 결정 하나에 함께 걸려 있고, Signal은 계측 코드가 없으면 열리지 않는다.** 그래서 Phase 5 첫 구현에 ①난수원 주입 ②계측을 반드시 함께 넣는다.

**오라클 성숙도**(명세-우선 재정의): 현재 **L1**(명세 판정기준 확립 · 도메인 규칙 정의 · 바이너리 콜드 스타트) → 구현 **수용** 시 **L2**(명세+바이너리) → L3(3층+자동진화). 상세 [docs/oracle.md](docs/oracle.md).

## SDD 진행 단계
| Phase | 문서 | 상태 |
|---|---|---|
| 0. Constitution (원칙) | [docs/constitution.md](docs/constitution.md) | ✅ |
| 1. Specify (명세) | [docs/spec.md](docs/spec.md) | ✅ 초안 |
| 2. Clarify (모호성 해소) | spec 내 "미해결" 절 | ✅ 대부분 확정(위치·반경·점심영업·메뉴힌트·앱키) |
| 3. Plan (기술설계) | [docs/plan.md](docs/plan.md) | ✅ 초안 |
| 4. Tasks (작업분해) | [docs/tasks.md](docs/tasks.md) | ✅ |
| 4.5 Oracle (정답기준) | [docs/oracle.md](docs/oracle.md) | ✅ 문서 (자동점검은 Phase 5) |
| 4.6 Tracks (판정방법) | [docs/tracks.md](docs/tracks.md) | ✅ 문서 (판정기는 Phase 5) |
| 5. Implement (구현) | `index.html` 등 | ✅ 완료 |
| 5.5 3탭 확장(모락모락·월드컵) | [docs/tasks.md](docs/tasks.md) Phase 5.5 | ✅ 구현·검증 완료(오라클 D1~D15 17/17 PASS) |
| 5.6 모락모락 Actions 크롤러 전환 | [docs/tasks.md](docs/tasks.md) Phase 5.6 | ✅ 완료(CORS 실측 확인 → 서버사이드 크롤러 전환) |
| 5.7 모락모락 예약 갱신 신뢰성 개선 | [docs/tasks.md](docs/tasks.md) Phase 5.7 | ✅ 완료(9슬롯 다중화·`hasMoremoreItems` 저장 게이트·워크플로 실패 신호, 오라클 D1~D16 18/18 PASS) |
| 5.8 모락모락 카드 이미지 UI 개선 | [docs/tasks.md](docs/tasks.md) Phase 5.8 | ✅ 완료(원본 비율 렌더·플레이스홀더 폴백, 자동 오라클 없이 사람 판단으로 수용 — [docs/oracle.md](docs/oracle.md) §2) |
| 5.9 모락모락 적대적 리뷰 반영 | [docs/tasks.md](docs/tasks.md) Phase 5.9 | ✅ 완료(실패신호 당일 마지막 슬롯 한정·캐시 재검증·이미지 hang 타임아웃·"사진 없음" 문구 정정, 오라클 18/18 PASS) |
| 6. Deploy | GitHub Pages | 🔲 |

## 프롬프트 이력
이 프로젝트에 요청한 프롬프트는 [PROMPTS.md](PROMPTS.md)에 시간순으로 기록한다.

## 다음 할 일
- 확정됨: 회사 위치(`아차산로13길 11`), 거리(도보 15분≈1km), 점심영업 필터(근사), 메뉴 힌트 방식, Kakao JS 앱키
- **Phase 5 구현 완료.** 남은 것은 **Phase 6 배포**(GitHub Pages 활성화 + Kakao 콘솔에 배포 도메인/필요 시 localhost 등록)
자세한 내용은 [docs/tasks.md](docs/tasks.md) 참고.
