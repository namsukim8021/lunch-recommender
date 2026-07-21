# CLAUDE.md — lunch-recommender 상시 컨텍스트/규약

이 파일은 세션마다 AI에 **항상 주입**되는 프로젝트 규약이다(Harness의 **Constrain·Inform** 계층). 상세 명세는 `docs/`를 따른다.

## 프로젝트
회사(`서울특별시 성동구 아차산로13길 11`) 주변 점심 식당을 **랜덤 + 최근 안 겹치게** 추천하는 개인용 **정적**(무료) 웹. 데이터 = **Kakao 지도 JS SDK**.

## Harness 3계층 (본 레포)
| 계층 | 파일 | 하네스 축 |
|---|---|---|
| 상시 규약·컨텍스트 | **CLAUDE.md**(이 파일) | Constrain · Inform |
| 명세(무엇)·설계(어떻게)·원칙·**정답기준** | `docs/spec.md`(SPEC) · `docs/plan.md`(LLD) · `docs/constitution.md` · `docs/oracle.md`(3층 오라클) | Inform |
| 절차 표준화(생성→검증→보완) | `.claude/skills/sdd-cycle` | Verify · Correct |

## SDD 운영 원칙 (반드시 준수)
1. **스펙이 1차 산출물.** 기능은 먼저 `docs/spec.md`(무엇)·`docs/plan.md`(어떻게)에 기술한 뒤 생성한다.
2. **코드를 직접 손보지 말 것.** 결함·변경은 코드가 아니라 **스펙(문서)을 보완한 뒤 재생성**한다(문서 보완 후 재생성 루프).
3. **정답기준 = 3층 오라클.** 생성물은 사람 눈이 아니라 [`docs/oracle.md`](docs/oracle.md)의 **① 명세 오라클**(`spec §6` AC)·**② 도메인 오라클**(스펙에 없어도 당연한 불변식 D1~D7)·**③ 바이너리 오라클**(golden regression, 수용 후 생성) **대비로 판정**한다. 변경 시 "이 정답은 뭘로 정해졌나(golden/AC/도메인규칙)"를 먼저 답한다.
4. **파이프라인**: LLD(`plan.md`) → SPEC(`spec.md`) → CODE → TEST → **VALIDATE(3층 오라클 대비)**.

## 하드 제약 (constitution.md 요약)
- 정적·무료(GitHub Pages), **백엔드 없음**. 개인정보는 **localStorage만**, 서버 저장/계정 없음.
- 키는 **도메인 제한 Kakao JS 앱키만**. REST 키·시크릿은 레포/코드에 넣지 않는다.
- **창작 금지**: 없는 식당·메뉴·영업시간을 지어내지 않는다. 근사(거리 직선·점심영업 추정 등)는 "근사/추정"으로 **정직 표기**.
- 한국어 · 모바일 우선.

## 커밋 규칙
- AI 공동저자 트레일러는 정확히: `Co-Authored-By: Claude <noreply@anthropic.com>` (모델명·버전 등 변형 금지).
- 요청 프롬프트는 `PROMPTS.md`에 누적한다. **public 레포**이므로 사내 기밀·시크릿은 기록 금지.

## 현재 상태
Phase 0~4(스펙/설계) 완료. **구현(Phase 5, Kakao 연동) 미착수.** 유일 blocker = Kakao JS 앱키.
