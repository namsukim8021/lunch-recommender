// config.js — 점심 추천 정적 사이트 설정 (docs/plan.md "설정(config.js)" 절 그대로)
// 이 파일은 <script src="config.js"></script>(모듈 아님, index.html에서 app.js보다 먼저 로드)로 읽힌다.
window.LUNCH_CONFIG = {
  KAKAO_JS_KEY: "6122c5bb23958f7b7f90838499ccb923",
  COMPANY_ADDRESS: "서울특별시 성동구 아차산로13길 11",
  CENTER: null,
  WALK_MINUTES: 15,
  RADIUS: 1000,
  RECENT_LIMIT: 10,
  EXCLUDE_CATEGORY_KEYWORDS: ["술집","호프","바(BAR)","포장마차","요리주점","이자카야","야식"],
  EXCLUDE_PLACE_IDS: [],
  INCLUDE_PLACE_IDS: [],
  CATEGORY_MENU_HINTS: {
    "양식": ["파스타","스테이크"], "중식": ["짜장면","짬뽕"], "일식": ["초밥","돈카츠","우동"],
    "분식": ["떡볶이","김밥"], "한식": ["백반","찌개","비빔밥"], "아시아음식": ["쌀국수","팟타이"],
  },
};
