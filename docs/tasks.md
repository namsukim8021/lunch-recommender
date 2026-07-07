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
- [ ] **Kakao Developers JS 앱키** 발급 + 배포 도메인 등록 → `config.js` (남은 유일한 blocker)
- [ ] "메뉴" 범위 최종 확정(카테고리 수준 위임 vs 큐레이션 DB)

## Phase 5 — 구현 (다음 세션)
- [ ] 5.1 Walking skeleton: `index.html`에 Kakao 지도 표시 + 주소 지오코딩(CENTER) + 반경 FD6 검색 결과 콘솔 출력
- [ ] 5.2 후보 수집·dedupe(페이지네이션) + **`distance <= RADIUS`(도보 15분) 필터**
- [ ] 5.3 **점심 영업 필터**: 카페(CE7) 제외 + `EXCLUDE_CATEGORY_KEYWORDS`(야간업종) 제외 + `EXCLUDE/INCLUDE_PLACE_IDS` 오버라이드
- [ ] 5.4 랜덤 추천 1곳 + 결과 카드 UI(이름·업종·거리·카카오맵 링크·마커) + "영업여부 카카오맵 확인" 안내
- [ ] 5.5 최근 안 겹치게(localStorage) + "다른 곳" + 이력 순환
- [ ] 5.6 이력 보기/초기화
- [ ] 5.7 모바일·다크모드 마감, 에러 폴백(키 미설정/검색 실패/후보 0)
- [ ] 5.8 (선택) 카테고리 필터(한식/양식 등)

## Phase 6 — 배포
- [ ] `.nojekyll` + GitHub Pages 활성화(main / root)
- [ ] Kakao 앱키 허용 도메인에 Pages 도메인 등록
- [ ] 실기기(모바일) 확인 → 성공기준(spec §6) 검증

> 오늘 범위: **Phase 0~4(스펙/설계)까지**. Phase 5 이후는 다음 세션.
