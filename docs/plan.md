# Plan — 기술 설계 (HOW)

> [spec.md](spec.md)를 만족하는 최소 기술안. [constitution.md](constitution.md)의 원칙(정적·무료·키안전) 준수.
> ⚠️ 이 문서는 설계까지만. **실제 구현 코드는 다음 세션에 작성**한다.

## 아키텍처
순수 정적 SPA(단일 `index.html` + 바닐라 JS). 프레임워크·빌드 없음. 서버 없음.

```
[브라우저]
  index.html + app.js + config.js
      │
      ├─ Kakao Maps JS SDK (libraries=services)  → 반경 내 음식점(FD6) 검색
      ├─ localStorage                            → 최근 추천 이력(안 겹치게)
      └─ 지도 렌더 + 결과 카드 + 카카오맵 링크
```

## 데이터 소스: Kakao Maps JS SDK
- 로드: `//dapi.kakao.com/v2/maps/sdk.js?appkey={JS_KEY}&libraries=services&autoload=false`
- 검색: `kakao.maps.services.Places().categorySearch('FD6', cb, { location: LatLng(center), radius, sort:'distance' })`
  - `FD6` = 음식점 카테고리. 페이지네이션으로 후보 모아 dedupe(`place.id` 기준).
  - 결과 필드 활용: `place_name`, `category_name`, `distance`, `road_address_name`, `x/y`(경위도), `place_url`.
- **키**: 도메인 제한된 **JS 앱키**만 사용(Kakao Developers에서 배포 도메인 등록). REST 키 미사용 → 정적으로 안전.

## 추천 로직 (랜덤 + 최근 안 겹치게)
1. 반경 내 후보 리스트 수집(dedupe).
2. `localStorage["lunch_recent"]`(최근 place.id 배열, 최대 `RECENT_LIMIT`)에 있는 항목 제외.
3. 남은 후보에서 `Math.random()`으로 1곳 선택. (전부 소진되면 이력 순환: 가장 오래된 것부터 후보 복원)
4. 선택 id를 recent 앞에 push, 길이 초과분 truncate.
5. "다른 곳"은 방금 선택분도 제외하고 2~4 재실행.

## UI (모바일 우선)
- 상단: 타이틀 + "🍚 오늘 점심 추천" 버튼
- 결과 카드: 식당명 / 업종 / 거리 / "카카오맵에서 보기"(place_url) / 지도 미니맵(마커)
- 하단: "다른 곳" · "최근 추천 보기/초기화"
- 다크·라이트 대응(prefers-color-scheme)

## 설정 (`config.js`)
```js
window.LUNCH_CONFIG = {
  KAKAO_JS_KEY: "<도메인 제한 JS 앱키>",
  CENTER: { lat: 00.000000, lng: 000.000000 }, // 회사 사옥 좌표 — 확정 필요
  RADIUS: 500,        // m
  RECENT_LIMIT: 10,   // 최근 제외 개수
};
```

## 호스팅
- GitHub Pages(정적). `.nojekyll` 포함. **public 레포**(무료 Pages 조건).
- 배포 도메인(`namsukim8021.github.io`)을 Kakao 앱키 허용 도메인에 등록.

## 한계 / 결정
- Kakao Local은 **개별 메뉴·가격 미제공** → 메뉴는 카테고리 수준 제안 + 카카오맵 링크 위임(spec §8).
- 실시간 영업여부 미제공 → 표시하지 않음(창작 금지 원칙).

## 테스트 관점(구현 시)
- 이력 제외가 실제로 중복을 막는가(연속 N회 서로 다름).
- 후보 0/소수일 때 순환·안내 처리.
- 키 미설정·검색 실패 시 사용자 안내(에러 폴백).
