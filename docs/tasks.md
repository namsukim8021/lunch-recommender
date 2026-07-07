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
- [ ] **회사 중심 좌표(위도·경도) + 반경(m)** 확정 → `config.js`
- [ ] **Kakao Developers JS 앱키** 발급 + 배포 도메인 등록 → `config.js`
- [ ] "메뉴" 범위 최종 확정(카테고리 수준 위임 vs 큐레이션 DB)

## Phase 5 — 구현 (다음 세션)
- [ ] 5.1 Walking skeleton: `index.html`에 Kakao 지도 표시 + 반경 FD6 검색 결과 콘솔 출력
- [ ] 5.2 후보 수집·dedupe(페이지네이션)
- [ ] 5.3 랜덤 추천 1곳 + 결과 카드 UI(이름·업종·거리·카카오맵 링크·마커)
- [ ] 5.4 최근 안 겹치게(localStorage) + "다른 곳" + 이력 순환
- [ ] 5.5 이력 보기/초기화
- [ ] 5.6 모바일·다크모드 마감, 에러 폴백(키 미설정/검색 실패)
- [ ] 5.7 (선택) 카테고리 필터

## Phase 6 — 배포
- [ ] `.nojekyll` + GitHub Pages 활성화(main / root)
- [ ] Kakao 앱키 허용 도메인에 Pages 도메인 등록
- [ ] 실기기(모바일) 확인 → 성공기준(spec §6) 검증

> 오늘 범위: **Phase 0~4(스펙/설계)까지**. Phase 5 이후는 다음 세션.
