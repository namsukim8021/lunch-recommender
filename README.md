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
| 명세·설계·원칙 | `docs/spec.md`(SPEC) · `docs/plan.md`(LLD) · `docs/constitution.md` | Inform |
| 절차 표준화(생성→검증→보완) | `.claude/skills/sdd-cycle` | Verify·Correct |

**운영 원칙**: 코드를 직접 고치지 말고 **스펙을 보완해 재생성** · 스펙(성공기준)을 **검증 oracle**로 사용. 상세는 [CLAUDE.md](CLAUDE.md).

## SDD 진행 단계
| Phase | 문서 | 상태 |
|---|---|---|
| 0. Constitution (원칙) | [docs/constitution.md](docs/constitution.md) | ✅ |
| 1. Specify (명세) | [docs/spec.md](docs/spec.md) | ✅ 초안 |
| 2. Clarify (모호성 해소) | spec 내 "미해결" 절 | ✅ 대부분 확정(위치·반경·점심영업·메뉴힌트) — 앱키만 남음 |
| 3. Plan (기술설계) | [docs/plan.md](docs/plan.md) | ✅ 초안 |
| 4. Tasks (작업분해) | [docs/tasks.md](docs/tasks.md) | ✅ |
| 5. Implement (구현) | `index.html` 등 | 🔲 다음 (Kakao 연동) |
| 6. Deploy | GitHub Pages | 🔲 |

## 프롬프트 이력
이 프로젝트에 요청한 프롬프트는 [PROMPTS.md](PROMPTS.md)에 시간순으로 기록한다.

## 다음 할 일 (구현 전 필요물)
- 확정됨: 회사 위치(`아차산로13길 11`), 거리(도보 15분≈1km), 점심영업 필터(근사), 메뉴 힌트 방식
- **남은 유일한 blocker**: **Kakao Developers JS 앱키** 발급 + 배포 도메인(`namsukim8021.github.io`) 등록 → `config.js`에 주입
자세한 내용은 [docs/tasks.md](docs/tasks.md) 참고.
