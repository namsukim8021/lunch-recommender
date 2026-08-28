# Plan — 기술 설계 (HOW)

> [spec.md](spec.md)를 만족하는 최소 기술안. [constitution.md](constitution.md)의 원칙(정적·무료·키안전) 준수.
> ⚠️ 이 문서는 설계까지만. **실제 구현 코드는 다음 세션에 작성**한다.

## 아키텍처
순수 정적 SPA(단일 `index.html` + 바닐라 JS). 프레임워크·빌드 없음. 서버 없음.

```
[GitHub Actions 예약 워크플로 (평일 KST 9슬롯 재시도 cron + workflow_dispatch)]
  scripts/fetch-moremore.mjs → 풀무원 모락모락 API 서버사이드 호출 → data/moremore-latest.json 커밋(hasMoremoreItems 게이트 — 빈/이상 응답이면 미갱신+워크플로 실패)
      │ (같은 오리진 정적 파일)
      ▼
[브라우저]
  index.html + app.js + config.js + lib/places.js(2026-08-28 신설, 탭1·탭3 공유 수집 모듈)
      │
      ├─ Kakao Maps JS SDK (libraries=services)  → 반경 내 음식점(FD6) 검색 — SDK 로드·지오코딩·격자 검색은 lib/places.js가 캐시(타일 6h·지오코딩 30일)와 함께 담당
      ├─ localStorage                            → 최근 추천 이력(안 겹치게) + 타일/지오코딩 캐시(lunch_tiles_v1/lunch_geocode_v1)
      ├─ data/moremore-latest.json fetch          → 탭2 모락모락 오늘의 메뉴(같은 오리진, CORS 없음)
      ├─ navigator.geolocation (2026-08-28 신설)   → "내 위치" 버튼 — 실패 시 좌표 창작 없이 회사 기준 유지
      └─ 지도 렌더 + 결과 카드 + 카카오맵 링크
```

### 탭 구조 (3패널, 라우팅 없음)
```
[브라우저 — 3탭 구조, 라우팅 없음(단일 index.html, hidden 토글)]
  index.html
    ├─ config.js                          → 전역 설정(window.LUNCH_CONFIG)
    ├─ 탭1(기본, hidden 토글) — app.js     → 위 다이어그램 그대로(2026-08-28: "내 위치" 버튼·lib/places.js 위임으로 변경 — 아래 "기준점 전환"·"Kakao API 호출 절감" 절)
    │     └─ window.__lunchTab1 getter 노출 (candidates/center/radius/hasSearchedOnce/originMode)
    ├─ 탭2 모락모락(hidden 토글) — moremore.js → 같은 오리진 data/moremore-latest.json fetch(Actions 크롤러가 커밋, 무변경)
    └─ 탭3 월드컵(hidden 토글) — worldcup.js   → window.__lunchTab1 재사용 우선, 없으면 lib/places.js 공유 모듈로 자체 수집(2026-08-28부터 — 이전에는 이 파일 안에서 독자 재구현)
  tabs.js                                  → 탭 전환(활성 탭만 표시, 페이지 이동/라우팅 없음)
```
**신규 파일**: `tabs.js`(탭 전환) · `moremore.js`(모락모락 데이터소스+렌더) · `worldcup.js`(월드컵 풀 구성+브래킷+렌더) · `lib/places.js`(2026-08-28 신설 — SDK 로드·지오코딩·격자 검색 공유 + 캐시, 아래 "Kakao API 호출 절감" 절). 기존 `app.js`/`lib/core.js`/`config.js`/`index.html`의 파일 구조 원칙(ES 모듈, 단일 파일)은 유지한다.

## 모락모락(탭2) 데이터소스
- **아키텍처 전환 배경**: 브라우저에서 `puls2.pulmuone.com`을 직접 `fetch()`하면 **CORS로 실제 차단됨을 실측 확인**(응답에 `Access-Control-Allow-Origin` 헤더 없음). 반대로 **GitHub Actions 러너에서 서버사이드로 호출하면 정상 조회됨을 실측 검증**(HTTP 200, 실 데이터 수신 — `.github/workflows/verify-moremore-fetch.yml`). 그래서 데이터소스를 아래처럼 바꾼다.
  ```
  [GitHub Actions 예약 워크플로 (평일 KST 9슬롯 재시도 cron + workflow_dispatch)]
        │ scripts/fetch-moremore.mjs 실행 — 서버사이드 fetch(Node 내장 fetch만 사용, 외부 의존성 0개) + hasMoremoreItems 로 빈/이상 응답 저장 방지
        ▼
  [data/moremore-latest.json 레포 커밋]   { fetchedDate: "YYYYMMDD"(KST), raw: {data: [...]} }
        │ (같은 오리진 정적 파일 — CORS 문제 자체가 사라짐)
        ▼
  [moremore.js]  fetch('data/moremore-latest.json') → parseMoremoreResponse(raw) + isFreshMoremoreData(fetchedDate, today) → 화면
  ```
  - `moremore.js`는 더 이상 `puls2.pulmuone.com`을 직접 호출하지 않는다. 같은 오리진의 정적 파일 `data/moremore-latest.json`을 fetch할 뿐이다 — 백엔드 없음 원칙(constitution 1)은 유지된다. GitHub Actions는 요청마다 응답하는 상시 서버가 아니라 **예약 빌드 작업**이기 때문이다(spec §7).
  - 아래 엔드포인트·요청바디·필드 인덱스 매핑은 그대로 유효하다. 다만 이 호출은 이제 브라우저가 아니라 **`scripts/fetch-moremore.mjs`(Actions 워크플로 안)에서** 일어난다.
- 엔드포인트: `https://puls2.pulmuone.com/src/sql/menu/today_sql.php` (POST, **Actions 워크플로의 `scripts/fetch-moremore.mjs`가 서버사이드에서 호출**).
- 요청 바디(`application/x-www-form-urlencoded`): `requestId=search_schMenu&requestUrl=%2Fsrc%2Fsql%2Fmenu%2Ftoday_sql.php&requestMode=1&requestParam=<JSON을 url-encode>`.
  - `requestParam` JSON: `{"srchOperCd":"O000002","srchAssignCd":"S000758","srchCurDay":"<실행 시점 YYYYMMDD, KST, 매 실행 동적생성>","srchCurShopclsCd":"","custCd":""}`.
- 응답: `{"data":[[...],...]}`. 사용 필드(배열 인덱스, 0-based) — 아래 표 외 인덱스는 미사용(창작 금지, constitution 3):

| 인덱스 | 의미 | 비고 |
|---|---|---|
| 1 | 메뉴명(한글) | |
| 2 | kcal | 문자열("887"/"1,324"/"0") — "0"이거나 파싱 불가면 `null` 처리 |
| 3 | 이미지 base URL | 없으면 `null` |
| 4 | 이미지 파일명 | 없으면 `null`. 실제 이미지 URL = index3 + index4 |
| 5 | 사이드메뉴 | `" / "` 구분, `null` 가능 |
| 6 | 코너명 | 백반/스페셜/TAKEOUT 등 |
| 12 | 영문명 | `null` 가능 |

- **저장 형식**: `scripts/fetch-moremore.mjs`가 위 API 원본 응답을 감싸 `data/moremore-latest.json`에 커밋한다 — `{ fetchedDate: "YYYYMMDD"(KST, 실행 시점), raw: {data: [...]} }`. `raw`는 풀무원 API 원본 응답 그대로(가공 없음) — 파싱(`parseMoremoreResponse`)은 여전히 브라우저(`moremore.js`) 쪽 책임이다.
- **4경로 통합 실패처리**(기존 3경로 + 날짜 불일치 신설): 아래 네 경로 모두 동일한 하나의 "준비중입니다" 안내로 귀결한다.
  1. fetch 실패(네트워크 오류·비2xx 응답) — 대상이 같은 오리진 정적 파일로 바뀌어 CORS 차단 경로는 사실상 사라졌지만, 파일 부재·네트워크 오류는 여전히 가능
  2. 응답은 200이지만 `raw.data`가 빈 배열
  3. 파싱 중 예외(필드 형식이 기대와 다름 등)
  4. **날짜 불일치** — `fetchedDate !== 오늘(KST) 날짜`. 신규 순수함수 `isFreshMoremoreData(fetchedDate, todayDate)`(둘 다 "YYYYMMDD" 문자열, 동일하면 `true`)로 판정한다. Actions 갱신이 실패·지연되면 구 데이터가 파일에 남아있어도 "오늘 메뉴"로 오인시키지 않기 위함(창작 금지)
  - 파싱 함수(`parseMoremoreResponse`)는 **절대 throw하지 않고** 항상 `{ ready: boolean, items: [...] }` 형태를 반환한다(호출부가 성공/실패를 분기하지 않고 `ready` 하나만 보면 되게). `isFreshMoremoreData`는 파싱과 별개의 순수함수이며, `moremore.js`는 `ready && isFreshMoremoreData(fetchedDate, todayKst)` 모두 참일 때만 정상 렌더한다.
- **클라이언트 캐시 재검증**: `moremore.js`의 `fetch('data/moremore-latest.json', { cache: 'no-cache' })`는 캐시를 쓰되 매번 서버에 재검증한다. 벤더가 당일 중 이미지·메뉴명을 갱신하고 크롤러가 그때마다 파일을 다시 커밋하는데, GitHub Pages의 캐시 수명 동안 낡은 파일이 브라우저 캐시에 잡히면 갱신분이 사용자에게 도달하지 않기 때문이다.
- 화면: 코너별 카드(이미지·kcal·한글/영문명·사이드메뉴). 만족도 평가·저장 등은 범위 밖(백엔드 없음, spec §7).

## 모락모락 카드 UI — 사진 표시 (`moremore.js` renderItems / `index.html` `.mm-*`)
- **배경**: 일부 코너(테이크아웃 등)만 이미지가 보이고 중식·석식은 안 보인다는 사용자 지적을 조사한 결과, **파싱 버그나 데이터 부재가 아니라 벤더가 당일 중 이미지를 점진적으로 채우기 때문**임을 실측 확인했다(위 크롤러 워크플로 절 참조 — KST 10:11 수집분은 백반·스페셜 이미지가 `null`, 11:12 재조회 시 업로드됨). 코너에 따라(라면·석식 등) 끝내 `null`로 남을 수도 있다(spec §4). 이 실측 과정에서 실제 이미지 해상도도 확인했다 — 백반 1024×686(비율 1.49), 스페셜 1024×752(1.36), TAKEOUT_1 781×479(1.63), TAKEOUT_2 760×445(1.71): **비율이 코너마다 제각각**이라 고정 비율 크롭 박스를 쓰면 원본을 왜곡한다.
- **카드 레이아웃 변경**: 기존 가로형(72×72 정사각 썸네일 + 우측 텍스트)에서 **세로형**(이미지 상단 full-bleed, 텍스트는 `.mm-body`로 하단 배치)으로 바꿔 사진으로 메뉴를 인지하기 쉽게 키웠다. 카드(`.mm-card`)는 `border-radius:16px` + `overflow:hidden`으로 이미지 모서리를 카드에 맞춰 자른다.
- **자연 비율 렌더(크롭 없음)**: `.mm-photo { display:block; width:100%; height:auto; }` — 위 실측 비율 편차 때문에 고정 `aspect-ratio`+`object-fit:cover`를 쓰지 않고 원본 해상도 비율 그대로 렌더한다(`img` 자체가 브라우저 기본 비율 유지 렌더링을 따름).
- **로딩 스켈레톤(레이아웃 점프 완화)**: `height:auto`인 `<img>`는 로드 전 높이가 0이라 콘텐츠가 로드 순간 아래로 튄다. `.mm-photo:not(.is-loaded) { min-height:180px; background:var(--border); }`로 로드 전 자리·배경을 잡아두고, `<img onload="this.classList.add('is-loaded')">`로 로드 완료 시 `is-loaded` 클래스를 붙여 `min-height` 제약을 해제한다 — 해제 후엔 자연 비율(`height:auto`)이 그대로 살아남아 스켈레톤이 실제 비율을 침해하지 않는다.
- **플레이스홀더 폴백(`.mm-media-ph`)**: `imageUrl`이 없거나(`null`) `<img>` 로드가 실패하면(`onerror="this.classList.add('is-failed')"`) 외부 이미지·가짜 사진을 쓰지 않고 고정 `aspect-ratio:3/2` + `linear-gradient(135deg, var(--card-bg), var(--border))` 배경 + 🍽️ 이모지 + **"사진 없음"** 문구(`.mm-ph-emoji`/`.mm-ph-text`, `aria-label="사진 없음"`)로 대체한다(창작 금지 — 실제 사진이 아님이 사용자에게 명시된다). 문구는 애초 "이미지 준비 전"이었으나, 라면(TAKEOUT)·석식처럼 **끝내 이미지가 제공되지 않는 코너**가 있어 "준비 전"은 오지 않을 사진을 약속하는 표현이 되므로 "사진 없음"으로 정정했다.
- **이미지 hang 타임아웃 폴백**: 이미지 요청이 응답도 에러도 없이 매달리면(CDN 지연·방화벽 drop) `onload`/`onerror`가 모두 발화하지 않아 로딩 스켈레톤이 영구히 남는다. `moremore.js`는 `renderItems()` 렌더 직후 `window.setTimeout(..., IMAGE_TIMEOUT_MS)`(`IMAGE_TIMEOUT_MS = 8000`)로 `img.mm-photo` 전체를 순회해 그때까지 `img.complete`가 `false`인 사진에 `is-failed` 클래스를 붙여 위 플레이스홀더 대체 영역으로 넘긴다.
- **접근성(`alt`)**: `<img class="mm-photo">`의 `alt`는 빈 문자열(`alt=""`)로 둔다 — 사진 바로 아래 `.mm-name-ko`가 같은 메뉴명을 텍스트로 이미 보여주므로, 사진을 장식 이미지로 처리해 스크린리더의 메뉴명 중복 낭독을 피한다.
- **마크업 계약(인접 형제 선택자로 표시 전환)**: `renderItems()`는 카드마다 `.mm-media-ph`를 **항상 1개** 렌더한다(사진 유무와 무관). 표시 여부는 JS 분기가 아니라 CSS가 결정한다:
  - `<img>`가 없는 카드(imageUrl null)는 `.mm-photo` 자체가 마크업에 없으므로 `.mm-media-ph`가 기본으로 보인다.
  - `<img>`가 있는 카드는 `.mm-photo + .mm-media-ph { display:none; }`로 평소 플레이스홀더를 숨기고, 로드 실패 시에만 `.mm-photo.is-failed { display:none; }` + `.mm-photo.is-failed + .mm-media-ph { display:flex; }`로 사진을 숨기고 플레이스홀더를 대신 띄운다.
- **텍스트 확대**: 한글 메뉴명(`.mm-name-ko`)을 `1rem`에서 `1.2rem`으로 키워 사진 축소 없이도 메뉴 인지도를 보강했다.
- **검증 방식(정직한 표기)**: 이 변경은 자동 오라클(`scripts/oracle-check.mjs`)에 판정 항목이 없다 — 시각적 요구(사용자 육안 확인)라 [oracle.md §2](oracle.md) "최초 수용 1회는 사람 판단 허용"에 해당한다([oracle.md §4](oracle.md) "UI/UX 변경" 행 참고).

## 모락모락 크롤러 워크플로 (`.github/workflows/moremore-fetch.yml`)
- **스케줄**: GitHub Actions 예약(cron) 워크플로는 **best-effort**라 지연·드롭될 수 있음을 실측으로 확인했다 — 2026-08-26 예약분은 1시간 지연(UTC 01:02) 발동, **2026-08-27 예약분은 발동 자체가 없었다**. 단일 슬롯(평일 KST 09:00 1회, `cron: '0 0 * * 1-5'`)이면 그 날 크론이 드롭되는 순간 하루 종일 갱신 기회가 사라진다. 그래서 평일 KST **07:13/08:29/09:41/10:07/11:23/12:37/13:51/15:17/17:33 9슬롯**으로 다중화한다(`workflow_dispatch` 유지 — 즉시 갱신·디버깅용). 분(minute)까지 슬롯마다 흩은 이유는 드롭의 주원인이 **정시 직후 큐 폭주**라, 같은 분(예: 전부 `:05`)에 몰아두면 드롭이 서로 상관돼 다중화 효과가 줄기 때문이다. 오후 슬롯(15:17/17:33)이 있는 이유는 벤더가 당일 중 이미지·메뉴명을 점진적으로 채우기 때문(실측: 2026-08-27 10:11 수집분은 이미지가 `null`, 11:12 재조회 시 업로드돼 있었음) — 오전 슬롯이 텍스트만 있는 응답을 저장해도 오후 슬롯이 이미지 채워진 응답으로 갱신한다.
- **권한**: 워크플로 상단에 `permissions: contents: write`를 명시한다. 레포 기본 워크플로 토큰 권한이 read이므로, 이 워크플로가 `data/moremore-latest.json`을 커밋하려면 명시적으로 write를 열어야 한다.
- **동시 실행 방어**: 슬롯이 9개로 늘면서 겹쳐 도는 실행(지연 발동 + 다음 슬롯 정시 발동, 또는 수동 `workflow_dispatch`)이 가능해졌다. `concurrency: { group: moremore-fetch, cancel-in-progress: false }`로 직렬화한다(`cancel-in-progress: false`인 이유: 진행 중인 수집을 죽이면 그날의 유일한 성공 슬롯을 날릴 수 있어서). 커밋 스텝의 `git push` 직전에 `git pull --rebase`를 추가해, 체크아웃 이후 다른 슬롯·사람이 먼저 push했을 때의 non-fast-forward 실패를 방지한다. **주의**: 이 `git pull --rebase`가 리베이스 충돌로 실패하면 그 슬롯의 수집분은 커밋되지 못하고 유실된다 — 재시도 루프는 없고, 다음 슬롯이 다시 수집을 시도해 메우는 것으로만 완충된다(§8).
- **실행 흐름**:
  1. 체크아웃
  2. Node로 `scripts/fetch-moremore.mjs` 실행 — 위 절의 엔드포인트/요청바디로 풀무원 API를 서버사이드 fetch. `hasMoremoreItems`(아래)로 저장 가능한 항목이 있는지만 판정하고, 있으면 기존 파일 내용과 무관하게 `{ fetchedDate, raw }` 형태로 `data/moremore-latest.json`에 쓴다. 없으면(빈/스키마 깨진 응답) 파일을 건드리지 않되, 워크플로 자체를 실패시킬지는 `MOREMORE_STRICT`(아래 실패 신호 절)로 슬롯마다 다르게 판정한다
  3. `git add` + `git diff --staged --quiet`가 바이트 동일 응답(내용 변화 없음)이면 커밋을 막는다 → 변경분이 있을 때만 commit, `git pull --rebase` 후 push
- **저장 게이트 — `hasMoremoreItems`(단일 판정으로 축소)**: 애초 "하루 1커밋"을 위해 `shouldReplaceMoremoreData(existing, incoming, todayDate)`(기존 파일 내용·오늘 날짜까지 비교)를 두었으나, 위 3단계의 `git diff --staged --quiet`가 **바이트 동일 응답의 중복 커밋을 이미 막고 있어** 그 판정이 실질적으로 기여하는 가치가 없었다. 오히려 "기존이 오늘 데이터면 갱신 생략" 규칙 때문에 **부분 게시 결함**이 있었다 — 이른 슬롯이 1코너만 받아 먼저 커밋하면, 뒤 슬롯이 5코너 확정 메뉴를 받아와도 "오늘자 데이터가 이미 있다"는 이유로 반영되지 못했다. 그래서 `lib/core.js`의 순수 함수 `hasMoremoreItems(raw)`로 축소·개명했다 — 판정 기준은 하나뿐이다: **응답(`raw`)에 저장할 수 있는 항목이 최소 1개라도 있는가**(`parseMoremoreResponse`와 동일한 항목 판정: 배열 행 + `row[1]`이 비어있지 않은 문자열). 기존 파일이나 오늘 날짜는 보지 않으므로 인자에서 뺐다. **이 게이트는 "저장할지"만 판정하며, "워크플로를 실패시킬지"는 아래 실패 신호 절이 별도로 판정한다.**

  | incoming(raw) | `hasMoremoreItems` | 저장 동작 | 이유 |
  |---|---|---|---|
  | `data` 없음/빈 배열/스키마 깨짐(유효 행 0개) | `false` | 파일 유지(워크플로 실패 여부는 아래 실패 신호 절 참조) | 있는 데이터를 빈/이상 응답으로 되돌리지 않는다(창작 금지의 역방향 보호) |
  | 유효 행 1개 이상(코너 수 무관, 1코너든 5코너든) | `true` | 기존 파일 내용과 무관하게 저장 | 부분 게시도 최신 응답이 정답이므로 항상 반영(코너 수 증감 모두 허용) — 실제 중복 커밋 방지는 `git diff --staged --quiet`가 담당 |

- **실패 신호 — `MOREMORE_STRICT` + `readStoredFetchedDate()`(당일 마지막 슬롯으로 한정)**: 처음에는 `hasMoremoreItems`가 `false`이면(빈/이상 응답) 슬롯과 무관하게 매번 `process.exitCode = 1`로 워크플로를 실패시켰다. 그런데 벤더가 당일 중 데이터를 점진적으로 채우므로(§ 위 스케줄) **이른 슬롯(07:13/08:29 등)의 빈 응답은 "아직 미게시"라는 정상 상태일 수 있다** — 매번 실패로 띄우면 평일마다 빨간 잡이 슬롯 수만큼 쌓여 "빨간 워크플로 = 이상 신호"라는 전제 자체가 죽는다(경보 피로). 그래서 실패 판정을 **당일 마지막 슬롯으로 한정**했다.
  - 워크플로가 환경변수 `MOREMORE_STRICT`를 주입한다 — `github.event.schedule == '33 8 * * 1-5'`(KST 17:33 슬롯)일 때만 `'1'`, 그 외 슬롯과 `workflow_dispatch`는 `'0'`.
  - `scripts/fetch-moremore.mjs`의 `readStoredFetchedDate()`는 이미 저장된 `data/moremore-latest.json`의 `fetchedDate`만 읽는다 — **"저장 여부"를 게이트하기 위해서가 아니라(그 역할은 위 `hasMoremoreItems`가 이미 담당) "당일 마지막 슬롯이 실패인지"를 판정하기 위한 읽기**다(파일 부재·파싱 실패 등 어떤 이유로 못 읽어도 `null`로 "미확보"로 간주).
  - `hasMoremoreItems(raw)`가 `false`일 때: `MOREMORE_STRICT !== '1'`이면 아무 것도 하지 않는다(파일 유지, 워크플로 성공). `MOREMORE_STRICT === '1'`이면 `isFreshMoremoreData(readStoredFetchedDate(), today)`로 **오늘 데이터를 앞선 슬롯이 이미 확보해뒀는지**를 확인해, 확보했다면 실패로 보지 않고(마지막 슬롯의 빈 응답은 "이미 끝난 하루"일 뿐), 확보하지 못했다면 그제서야 `process.exitCode = 1`로 실패시킨다.
  - 즉 실패 신호의 의미가 "이 슬롯이 빈 응답을 받았다"에서 **"하루가 끝났는데 오늘 데이터를 끝내 확보하지 못했다"**로 정밀해졌다.
  - **트레이드오프(갱신)**: 빈 응답을 워크플로 실패로 잡는 한, **실제로 메뉴가 없는 공휴일에는 여전히 워크플로가 붉게 뜬다.** 다만 실패 판정이 당일 마지막 슬롯 1개로 한정되면서 **공휴일 오탐이 하루 최대 1건**으로 줄었다(이전엔 9슬롯 전부가 매번 오탐이었다). 능동 알림(Slack 등)이 없는 이 프로젝트에서 "빨간 워크플로"가 유일한 이상 탐지 수단이므로, 남은 공휴일 오탐(하루 1건)은 감수하고 정직한 신호를 우선했다.
- **기존 진단용 워크플로와의 관계**: `.github/workflows/verify-moremore-fetch.yml`(Actions 러너에서 서버사이드 호출이 실제로 되는지 1회성으로 확인한 진단 워크플로, `workflow_dispatch`만·커밋 없음)은 위 CORS 실증 배경조사에 쓰였다. `moremore-fetch.yml`은 이를 대체하는 **운영용** 예약 워크플로다(스케줄 + 실제 데이터 커밋까지 포함).
- **미해결(§8 참조)**: `workflow_dispatch`를 KST 00:0x 근처(자정 경계)에 수동 실행하면 `getKstYyyymmdd()`는 새 날짜를 반환하지만 벤더 API는 아직 어제 메뉴를 줄 수 있다 — 응답 안의 날짜와 요청 날짜를 대조하지 않으므로 어제 메뉴에 오늘 날짜 라벨이 붙어 커밋될 수 있다(예약 슬롯은 **07:13~17:33**이라 이 경로에 해당하지 않는다). 저장 게이트(`hasMoremoreItems`)는 "항목이 1개 이상이면 항상 저장"만 판정해 날짜 자체는 보지 않으므로, 이 경로에는 저장 단계의 방어막이 없다.

## 점심메뉴 월드컵(탭3)
- 참가 16개, 16강(8경기)→8강(4경기)→4강(2경기)→결승(1경기), 총 15경기.
- **참가 풀 구성**: 새 Kakao API 호출을 추가하지 않는다. 탭1이 수집한 실제 후보 식당을 재사용해 각 후보에 `lib/core.js`의 `deriveMenuHint`로 메뉴 힌트를 붙인 `(place, menuText)` 쌍의 풀을 만들고, **유효한 힌트가 있는 쌍만** 참가 후보로 삼는다. 그 풀에서 주입 가능 `rng`로 16개를 비복원 추출한다(런타임 기본값 `Math.random`, 검증 시 고정 시드 PRNG — 탭1 추천 로직의 결정성 불변식과 같은 원칙).
- **탭1 재사용 방식(getter 노출)**: `app.js`는 `let candidates` / `let center` / `let originMode` / `let currentRadius` / `let hasSearchedOnce` 선언부 바로 아래에 작은 getter 객체를 둔다(그 외 app.js의 기존 로직·동작은 바꾸지 않는다):
  ```js
  window.__lunchTab1 = {
    get candidates() { return candidates; },
    get center() { return center; },
    get radius() { return currentRadius; },
    get hasSearchedOnce() { return hasSearchedOnce; },
    get originMode() { return originMode; }, // 2026-08-28 추가 — 탭3가 기준점 변경(회사↔내 위치)을 인지
  };
  ```
  `worldcup.js`는 `window.__lunchTab1.hasSearchedOnce && window.__lunchTab1.candidates.length > 0`이면 그 후보를 그대로 재사용해 Kakao 검색을 중복 호출하지 않는다. 아직 없으면(탭1 미검색 상태로 탭3에 먼저 진입) `lib/places.js`의 `loadKakaoSdk`/`resolveCompanyCenter`/`collectCandidates`를 그대로 가져와 자체 수집한다(2026-08-28부터 — 이전에는 `worldcup.js`가 SDK 로드·지오코딩·격자 검색을 자체 재구현했으나, "Kakao API 호출 절감" 절의 공유 모듈 `lib/places.js`로 그 중복을 제거했다). 이때도 `window.__lunchTab1.center`가 이미 있으면(탭1이 "내 위치" 모드로 먼저 확정해둔 경우 포함) 그 좌표를 그대로 쓰고, 없을 때만 `resolveCompanyCenter`로 회사 좌표를 구한다.
- **후보 부족 처리**: 유효 힌트 보유 후보가 16개 미만이면 지어내지 않고 "대표 메뉴가 16개 미만입니다 — 반경을 넓혀보세요" 안내 + 반경 확대 버튼을 보여준다.
- **브래킷 진행(순수 함수)**: 매 라운드 참가자 수는 정확히 절반, 승자만 다음 라운드에 진출(패자 재등장 없음), 각 매치는 서로 다른 두 참가자로 구성한다.
- **매치 UI**: 좌/우로 카테고리 이모지(실사진 아님을 명시)·메뉴명·식당명을 보여준다. 최종 우승 시 실제 식당명과 카카오맵 링크(`place.place_url` — 이 레포 필드명은 snake_case `place_url`)로 연결한다.

## 데이터 소스: Kakao Maps JS SDK
- 로드: `https://dapi.kakao.com/v2/maps/sdk.js?appkey={JS_KEY}&libraries=services&autoload=false`(`lib/places.js`의 `loadKakaoSdk`, 2026-08-28: 프로토콜 상대 `//` 대신 `https://` 명시 — `index.html`을 `file://`로 직접 열어도 `file://dapi.kakao.com`으로 깨지지 않도록 함. GitHub Pages 배포본은 원래 https라 영향 없음). SDK 로드는 모듈 스코프 싱글턴 프로미스라 탭1·탭3가 몇 번 부르든 script 태그는 1개다(위 "Kakao API 호출 절감" 절 3번).
- **중심 좌표(주소→좌표)**: 회사 주소 `서울특별시 성동구 아차산로13길 11` 을 `kakao.maps.services.Geocoder().addressSearch(addr, cb)` 로 지오코딩해 CENTER 로 사용(하드코딩 좌표 대신 주소 기준 → 창작 금지 준수). `config.CENTER`가 이미 채워져 있으면 그 값을 그대로 쓰고, 없으면 **localStorage 지오코딩 캐시(`lunch_geocode_v1`, TTL 30일)** → 미스일 때만 Geocoder를 1회 호출한다(`lib/places.js`의 `resolveCompanyCenter`, 2026-08-28 — 위 "Kakao API 호출 절감" 절 2번). **실패/무결과 시**에는 임의 좌표로 진행하지 않고 사용자에게 안내 후 중단한다(D9).
- 검색: `kakao.maps.services.Places().categorySearch('FD6', cb, { location: LatLng(CENTER), radius: RADIUS, sort:'distance' })`
  - `FD6` = 음식점 카테고리(카페 CE7 은 애초에 제외됨). 페이지네이션으로 후보 모아 dedupe(`place.id` 기준).
  - 결과 필드 활용: `place_name`, `category_name`, `distance`(직선 m), `road_address_name`, `x/y`(경위도), `place_url`.
- **키**: 도메인 제한된 **JS 앱키**만 사용(Kakao Developers에서 배포 도메인 등록). REST 키 미사용 → 정적으로 안전.

## 후보 수집 상한 & 완화 (Kakao 검색 45개 제한)
- ⚠️ `categorySearch`/`keywordSearch` 는 한 검색당 **최대 45개(15개×3페이지)** 만 접근 가능(`pagination.totalCount` 가 더 커도 나머지는 못 받음). 성수 지역은 반경 800m~1km만 돼도 음식점이 45개를 초과할 가능성이 커, 단순 1회 검색이면 **일부 식당이 후보에서 조용히 누락**되어 랜덤 대표성이 훼손된다.
- 완화(택1·조합):
  1. **격자 분할 검색(기본)**: 검색 영역을 `rect`(bounding box) 타일로 쪼개 각 타일을 개별 검색한 뒤 `place.id` 로 합집합·dedupe. 각 타일이 45개 미만이 되도록 크기를 잡으면 사실상 전수 수집. (`distance <= RADIUS` 로 원형 보정)
  2. **반경 축소**: `RADIUS` 를 줄여 결과를 45개 이내로(도보 10분 취지 범위 내).
  3. **표본 고지**: 위 완화 없이 45개 표본만 쓸 경우, "주변 일부에서 추천"임을 UI에 명시(과장·창작 금지).
- 기본 전략은 **격자 분할**로 반경 내 전수 수집을 지향(개인용 트래픽이라 JS SDK 쿼터 내에서 충분).

## 거리 제한: 도보 10분 (근사)
- Kakao 는 보행 소요시간을 주지 않고 `radius`/`distance` 는 **직선거리**다. 따라서 도보 10분을 직선거리로 근사한다.
- **2026-08-28 조정(15분/1,000m → 10분/800m)**: `config.RADIUS`를 1000→800, `config.WALK_MINUTES`를 15→10으로 낮췄다. 반경을 800m로 좁히면서, 결과 카드·도움말에 쓰는 근사 상수 `WALK_METERS_PER_MIN`(app.js)도 함께 조정해야 했다 — 기존 `67`(보행 4km/h 근사)을 그대로 두면 `800m / 67m분 ≈ 11.9분`이 반올림돼 화면에 **"도보 약 12분"**으로 표기되는데, 이는 "800m = 도보 10분"이라는 요구·§4 거리 제한과 어긋난다. constitution의 정직 표기 원칙상 실제 계산과 다른 숫자를 화면에 쓸 수 없으므로, 반경이 아니라 **근사 상수 쪽을 조정**했다: `WALK_METERS_PER_MIN = 80`(보행 4.8km/h ≈ 국내에서 흔히 쓰는 "도보 1분 = 80m" 관행) → `800m / 80m분 = 10.0분`이 정확히 맞아떨어진다. 이는 **근사 기준 자체의 변경**이며, 표기는 여전히 "약 N분(근사)"로 근사임을 밝힌다.
- 산정: 보행 4.8km/h ≈ 80m/분 → 10분 ≈ 보행경로 약 800m. 도로 우회를 엄격히 반영하려면 직선 반경을 더 줄인다.
- **기본값 `RADIUS = 800`(m)**. 후보는 `distance <= RADIUS` 로 한 번 더 거른다. `WALK_METERS_PER_MIN`(80)은 `config.js`가 아니라 `app.js`의 상수다(config에 없는 이유는 기존 관례와 동일 — RADIUS처럼 사용자가 직접 튜닝하는 값이 아니라 표기용 환산 상수이기 때문).
- **부수 효과(격자 타일 수)**: 반경이 줄면 격자 타일 수도 준다. 단순 산식(`center ± radius` 정사각 바운딩박스를 400m 타일로 나눈다고 가정, 타일 한 변 개수 = `ceil(2·radius / 400)`)으로는 `radius=1000`이면 `ceil(2000/400)=5` → 5×5=25타일, `radius=800`이면 `ceil(1600/400)=4` → 4×4=16타일이라고 예상하기 쉽다. **그러나 이 산식은 실제 `buildGridTiles` 실행 결과와 다르다** — `Math.ceil((east-west)/tileSizeLng)`가 `radiusLng`/`tileSizeLng`를 각각 별도로 부동소수 나눗셈한 값을 쓰기 때문에, 수학적으로는 정수(예: 2.0)가 나와야 할 비율이 실제로는 `2.0000000000000004` 같은 값으로 계산돼 `ceil`이 한 칸을 더 얹는 경우가 실측된다(이 레포 회사 좌표 근사값 `{lat:37.5451, lng:127.0554}`로 직접 실행 확인, 2026-08-28). 이 오차는 이번 변경이 만든 게 아니라 `buildGridTiles`(Phase 5부터 존재)의 기존 부동소수 특성이며, 반경 값이 타일 크기의 정확한 배수에 가까울 때 더 잘 드러난다 — `RADIUS`가 `1000`에서 `800`으로 바뀌며 처음으로 실측·문서화됐다. 실행 결과(`snap` 옵션 없이, 프루닝도 없이 — 즉 이번 변경 이전 `app.js`가 실제로 쓰던 경로 그대로): `radius=1000`은 6×6=**36타일**(단순 산식의 25가 아니다), `radius=800`은 대체로 4×5=**20타일**(단순 산식의 16이 아니다). 이 문서는 이제부터 **단순 산식은 "직관용 근사치"로만** 표기하고, 실제로 쓰이는 경로(아래 `snap:true` + 프루닝)의 수치는 실행 확인값으로 표기한다.
- **실제로 쓰이는 수집 경로의 타일 수(실측, 2026-08-29 최종)**: `lib/places.js`는 `buildGridTiles(center, radius, 400, { snap: true })` + `isTileOutsideRadius` 프루닝을 함께 쓴다(아래 "Kakao API 호출 절감" 절). 회사 좌표(`{lat:37.5451, lng:127.0554}`)·`radius=800`으로 직접 실행 확인:

  | 경로 | 원시 타일 | 프루닝 후(실제 검색 대상) | 콜드 최대 호출(×3페이지) |
  |---|---|---|---|
  | `snap:false`(프루닝만 추가, 참고용) | 20 | **18** | 54 |
  | `snap:true`(실제 `lib/places.js` 경로) | **49**(적대적 리뷰 반영 전 25 — 아래 "Kakao API 호출 절감" 절 1번의 커버리지 결함·수정 참고) | **23** | 69 |

  `snap:true`의 원시 타일이 `snap:false`보다 훨씬 많은 것은 (a) 절대 격자 정렬을 위해 바운딩박스를 바깥쪽으로 `floor`/`ceil` 확장하고, (b) 적대적 리뷰로 발견된 커버리지 구멍을 막기 위해 스냅 전 bbox에 **타일 1칸 여유**를 추가로 더했기 때문이다(원시 타일이 25→49로 뛰었다). 다만 이 여유 타일은 전부 원 밖이라 `isTileOutsideRadius` 프루닝이 걷어내므로, **실제 검색 대상(23개)은 여유 추가 전후로 변하지 않는다** — 단 **프루닝 없이 `snap:true`만 쓰는 호출자가 생기면 원시 타일이 25→49로 정확히 2배가 된다**는 함정이 있다(§8에 명시). 즉 **이번 변경만으로 첫 방문(콜드) 호출 수가 극적으로 줄지는 않는다** — 반경 축소(1000→800)와 프루닝 자체는 호출을 어느 정도 줄이지만, `snap:true`+프루닝 경로의 타일 수(23)가 이론상 최솟값(16)보다 여전히 많다. 이번 변경의 호출 절감은 **콜드 수치보다 재방문·반경확대·내 위치 전환 시의 캐시 재사용률**에서 크게 온다(아래 "캐시 재사용률" 참고) — 탭1을 한 번만 쓰고 떠나는 세션은 이 차이(18→23, +27.8%)만큼 순증(더 많은 호출)이 될 수 있음을 §8에 정직하게 남긴다.
- (정확한 보행시간은 별도 길찾기 API가 필요 → 정적·무료 범위 밖, 도입 시 재검토)

## 기준점 전환 — "내 위치" 버튼 (`originMode`)
- **UI**: 탭1 하단 버튼 줄(`다른 곳`/`최근 추천 보기`/`이력·캐시 초기화`) 맨 앞에 `#my-location-btn`을 추가한다(`index.html`). **⚠️ 정정(2차 적대적 리뷰)**: 처음엔 라벨을 `📍 내 위치` ↔ `🏢 회사 기준`으로 뒤집었는데, `aria-pressed`와 겹쳐 내 위치 활성 상태에서 "회사 기준 버튼, 눌림"으로 낭독되는(실제와 정반대) 문제가 있었다(WAI-ARIA APG는 토글 버튼의 접근 가능한 이름을 상태로 바꾸지 말라고 명시한다). 지금은 **라벨을 `📍 내 위치`로 고정**하고, 상태는 `.secondary-btn.is-active`(시각) + `aria-pressed`(스크린리더) + 헤더 문구로만 전달한다.
- **토글**: `app.js`의 모듈 스코프 상태 `originMode`(`'company'|'geo'`)로 관리한다. `company → geo` 전환 시 `navigator.geolocation.getCurrentPosition`으로 현재 위치를 얻어 `center`를 그 좌표로 바꾸고 `hasSearchedOnce=false`로 재검색을 트리거한다. `geo → company` 전환은 위치 권한을 다시 묻지 않고, 이미 확정해 둔 `companyCenter`(부트스트랩 시 지오코딩된 값)로 즉시 복귀한다.
- **geolocation 옵션**: `{ enableHighAccuracy: false, timeout: 10000, maximumAge: 300000 }`. `maximumAge`(5분)로 OS/브라우저의 위치 캐시를 재사용해, 매번 새로 측위하지 않고 불필요한 GPS 기동을 줄인다.
- **실패 시 창작 금지(D9/D21)**: 권한 거부·확인 불가·시간 초과·미지원 어느 경우든 좌표를 임의로 만들지 않고 `originMode`를 바꾸지 않는다(회사 기준 유지). 실패 사유는 한국어로 안내한다.
- **저정확도 좌표 경고(정직 표기, 적대적 리뷰 반영)**: `normalizeGeoPosition`의 반환 계약이 `{lat, lng} | null`에서 **`{lat, lng, accuracy: number|null} | null`**로 바뀌었다. 데스크톱 WiFi/IP 기반 측위는 `accuracy`가 ±20,000m(20km)까지도 나오는데, 최초 구현은 이 값을 무시하고 그대로 "내 위치"로 단정해 800m 반경을 검색했다 — 근거 없는 정밀도를 사실처럼 보여주는 것이라 constitution의 창작 금지·정직 표기 정신에 어긋난다. 수정 후 `accuracy > currentRadius`(측위 오차가 추천 반경보다 큼)면 전환은 그대로 진행하되(무단으로 거부하기보다 사실을 고지하는 편이 낫다는 판단) 상태줄에 "정확도가 낮아 추천이 부정확할 수 있다"는 경고를 띄운다. **한계**: 이 경고는 상태줄에 1회만 뜨고 이후 "다른 곳"을 누르면 사라진다(상시 배지는 미구현, §8).
- **신규 순수함수(`lib/core.js`)**:
  - `normalizeGeoPosition(position)` — `GeolocationPosition`을 `{lat, lng, accuracy}`로 정규화. `coords`가 없거나 `latitude`/`longitude`가 유한수가 아니거나 위경도 유효범위(`[-90,90]`/`[-180,180]`)를 벗어나면 `null`(좌표를 지어내지 않는다). `accuracy`는 유한수면 그대로 보존하고 아니면 `null`(부분 좌표를 만들지 않는다 — 위경도가 무효면 `accuracy`가 있어도 전체를 `null`로 버린다).
  - `describeGeolocationError(code)` — `GeolocationPositionError.code`(1=권한거부/2=확인불가/3=시간초과, 그 외/undefined는 기본 문구)를 한국어 안내 문자열로 매핑. 절대 throw하지 않는다. 미지원 브라우저(`navigator.geolocation` 자체가 없음)는 `app.js`가 별도 메시지로 처리한다(코드가 없는 경우라 `describeGeolocationError`의 매핑 대상이 아님).
  - `originLabel(mode, companyAddress)` — `mode==='geo'`면 `'내 위치'`, 아니면 `` `회사(${companyAddress})` ``. 결과 카드·도움말 문구를 만드는 단일 지점으로 써서, 기준점과 문구가 어긋나는 것을 구조적으로 막는다.
- **정직 표기 연동(2군데)**: (1) 도움말(`?`) 모달의 조건 설명(`buildHelpItems`)이 `currentRadius`뿐 아니라 `originMode`도 인자로 받아 `originLabel(mode, ...)`로 "회사(주소)에서" / "내 위치에서" 문구를 그때그때 만든다. (2) **헤더 부제(`#app-subtitle`)도 기준점을 추종한다** — 회사 기준에서는 "회사 주변에서, 최근이랑 안 겹치게 골라드려요", 내 위치 기준에서는 "내 위치 주변에서, …"로 바뀐다. 헤더는 공간 제약상 짧은 라벨(`회사`/`내 위치`)만 쓰고, 정확한 주소 전체 표기는 도움말 모달의 `originLabel`이 담당한다 — **짧은 헤더가 잡아야 할 거짓은 "기준점이 바뀌었는데 회사라고 말하는 것"이지 주소 생략이 아니므로**, 공간 제약(모바일 우선, 주소를 넣으면 2줄로 감김)과 정확성을 이렇게 분리했다.
- **도움말 항목 8개로 확장**: 기존 5개(반경·야간업종·이력제외·랜덤선택·메뉴힌트)에 3개가 추가됐다 — 타일 캐시 최대 보관 시간(`TILE_CACHE_TTL_MS`를 직접 읽어 "최대 N시간"으로 표기), geolocation `maximumAge`(최대 5분 전 위치를 재사용할 수 있음+ 저정확도 시 화면에 알림), 그리고 "검색 결과는 이 기기에만 저장되고 서버로 전송되지 않으며 '이력·캐시 초기화'로 지울 수 있다"는 프라이버시 고지. 세 문구 모두 상수를 직접 읽어 계산하므로(하드코딩 금지) 상수가 바뀌면 문구도 같이 바뀐다.
- **탭3 연동**: `window.__lunchTab1`에 `get originMode()` getter를 추가해, `worldcup.js`가 탭1의 현재 기준점(회사/내 위치)을 인지한다. 월드컵 화면에도 `#worldcup-origin`으로 지금 기준점을 표시한다. **적대적 리뷰로 발견된 결함**: 이 getter는 최초 구현에서 **죽은 코드**였다 — `worldcup.js`가 후보를 수집한 시점의 기준점을 기억해두지 않아서, 탭3를 먼저 열어 후보를 수집한 뒤 탭1에서 "내 위치"로 전환해도 탭3는 계속 **회사 기준 후보로 월드컵을 진행**했다(수집 당시와 지금의 기준점이 달라도 무효화되지 않음). 수정 후 `worldcup.js`는 수집 시점의 기준점 서명(`{mode, lat, lng, radius}` — `radius`는 2차 리뷰에서 추가, 아래 "2차 적대적 리뷰 반영" 절 참고)을 기억해두고, 사용자가 탭1에서 기준점을 바꾼 뒤 탭3로 돌아오면 서명 불일치를 감지해 참가 풀을 무효화·재수집한다.

## Kakao API 호출 절감 (Phase 6.0)
> 배경: Kakao JS 앱키는 호출수 제한이 있고, 지금까지 구조에는 명백한 낭비가 여러 군데 있었다. 아키텍처 변경이라 이 절에서 별도로 기술한다.

### 진단(실측·코드 근거)
| 낭비 | 근거 |
|---|---|
| 결과 캐시 부재 | 새로고침·재방문마다 격자 전량 재검색. 대상 식당 집합은 시간 단위로 변하지 않는다 |
| 지오코딩 매 로드 | `CONFIG.CENTER=null`이라 로드마다 Geocoder 1회 — 회사 주소는 사실상 불변인데도 매번 호출됐다 |
| 탭3 완전 중복 수집 | 기존 `worldcup.js`는 SDK 로드·지오코딩·격자 검색을 `app.js`와 별개로 자체 구현하고 있었다 — 탭1 미검색 상태로 탭3에 먼저 들어가면 같은 타일 세트를 탭1과 별도로 한 번 더 검색했다 |
| 반경 확대 시 전량 폐기 | `handleExpandRadius`가 `hasSearchedOnce=false`로 되돌리고 `handleRecommend`를 다시 태워, 이전에 이미 받은 타일 결과를 버리고 확대된 격자를 전부 재검색했다 |
| 원 밖 타일 검색 | `filterByRadius`가 100% 버릴 타일까지 매번 검색했다. 타일 크기 400m 기준 `√2·(R−400) > R`이 성립하는 반경(약 **1,366m** 이상, 예: 기본 800m에서 두 번 "반경 확대"(×1.5×1.5=1,800m)한 뒤)부터 코너 타일이 원과 아예 겹치지 않는 경우가 생긴다 |

### 대책
1. **타일 단위 localStorage 캐시** — `lunch_tiles_v1`, 엔트리 `{ts, places}`, **TTL 6시간**(`export const TILE_CACHE_TTL_MS = 21600000`, `lib/places.js` — 도움말 문구가 이 상수를 직접 읽어 "최대 N시간"을 표기한다, 하드코딩하면 상수를 바꿀 때 화면 안내만 낡아 거짓 표기가 되기 때문), 최대 **120엔트리**(`TILE_CACHE_MAX_ENTRIES`, 2026-08-29: 200→120으로 하향 — 아래 "세부 보강" 참고, 초과 시 `ts`가 오래된 것부터 제거), 저장 실패(QuotaExceededError 등)는 흡수하고 캐시 없이 계속 진행한다.
   - 캐시 키(`tileCacheKey(tile)`)는 타일의 경계값(`swLat/swLng/neLat/neLng`, 소수 5자리 고정 — 부동소수 흔들림 방지, 5자리 ≈ 1.1m 해상도)을 그대로 직렬화한다. **따라서 동일한 (center, radius) 재요청은 타일 경계가 정확히 일치해 항상 캐시 히트다**(D22가 보는 것도 이 경우다).
   - **타일 자체를 절대 격자에 정렬(`buildGridTiles(..., { snap: true })`)** — 구현 중 발견된 결함 대응이다. `snap` 없는(=`false`) 기존 격자는 **center 상대**라 기준점이 1m만 달라져도 타일 경계가 통째로 어긋나 캐시 히트가 0이 된다 — "내 위치" 버튼은 GPS 오차로 클릭마다 좌표가 미세하게 달라지므로, 이대로면 캐시가 사실상 무용지물이 되고 localStorage만 부풀 뻔했다. 그래서 `buildGridTiles`에 4번째 인자 `{ snap: true }`를 추가했다. `snap`이 없거나 `false`면 기존 3-인자 호출과 바이트 단위로 동일한 결과다(D8 무영향).
   - **`GRID_ANCHOR_DEG` 값 선택 근거(`export const GRID_ANCHOR_DEG = 0.5`, `lib/core.js`)**: 처음 `0.1`로 뒀더니 앵커 대역 경계가 회사(위도 37.5451) 기준 **북쪽 545m**에 놓였다 — 이는 도보 반경(800m) **안**이라, 그 경계를 넘나드는 이동만으로도 캐시 재사용률이 0%로 떨어지는 문제가 실측됐다(회귀 테스트 D19b가 이 실측 결함을 박제한 것). `0.5`로 넓히자 경계가 회사 기준 **북쪽 22.8km·남쪽 32.9km** 밖으로 밀려나 도보 반경 안에서는 경계를 넘을 일이 없어졌고, 경도 스케일 오차(`cos` 오차)도 앵커(37.5)와 대역 끝(37.75) 사이에서 `cos 0.7934` vs `cos 0.7912` = **0.28%**(400m 타일에서 약 1.1m 차이)로 무시할 수 있는 수준이다. `1.0`은 과교정으로 봤다 — 한국 전역이 한 대역으로 묶이면서 위도 끝단(제주 33도 등)의 `cos` 오차가 약 5%(타일 20m 어긋남)까지 커진다. **`GRID_ANCHOR_DEG`를 다시 줄이거나 없애면 도보 반경 안에서 캐시가 무효화되는 이 문제가 재발한다**(D19b가 회귀를 잡는다).
   - **⚠️ 정정 — "스냅은 bbox를 바깥으로만 확장하므로 커버리지가 항상 보존된다"는 서술은 사실이 아니었다(적대적 리뷰 발견 결함 b)**. 최초 구현은 격자 정렬용 앵커 위도로 계산한 경도 스케일(`metersPerDegLngGrid`)을 **원의 크기(`radiusLng`) 계산에도 그대로 재사용**했다 — 문제는 앵커보다 **북쪽**에 있는 center에서는 `cos(anchorLat) < cos(center.lat)`이라 `radiusLng`가 실제보다 **작게** 나온다는 것이다. 즉 bbox가 "바깥으로만 확장"되기는커녕 **경도 방향으로 안쪽으로 줄어드는** 경우가 있었다. 실측 반례(적대적 리뷰): `center = {lat: 37.74457997, lng: 126.90778388}`(앵커 위도 38.0)의 **정동 800m 지점**(하버사인 실측 799.10m — 반경 800m 안)이 스냅된 bbox 동쪽 끝보다 **2.38m 바깥**에 있어 **어떤 타일에도 포함되지 않았다** — 반경 안 후보가 검색 자체에서 빠지는 정보 손실(D8/D18이 원래 잡으려던 것과 정확히 같은 종류의 결함인데, 이 케이스는 몬테카를로 표본 밀도(타일당 2,000점)로는 못 잡고 리뷰가 좌표를 직접 골라 찾아냈다).
     - **수정**: `radiusLat`/`radiusLng`(원의 실제 크기)는 **항상 `center.lat` 기준**으로 계산하고, **격자 정렬(타일 폭·경계 스냅)에만 앵커 위도 스케일**을 쓰도록 두 스케일을 분리했다(`metersPerDegLngCenter` vs `metersPerDegLngGrid`). 그리고 등장방형↔하버사인 근사 차이 등 남은 오차를 흡수하도록 **스냅 전 bbox에 타일 1칸 여유**(`marginLat`/`marginLng = tileSizeLat/tileSizeLng`)를 더했다. 수정 후 그 반례 지점은 bbox 안쪽 약 795.0m 위치로 들어온다(D18 회귀 테스트로 박제).
     - 이 수정의 결과로 원시 타일 수가 늘었다 — 위 "거리 제한: 도보 10분" 절 표 참고(`snap:true` 원시 25→**49**, 프루닝 후는 23 그대로). **함정**: 이 여유 타일은 프루닝이 전제이므로, `isTileOutsideRadius` 없이 `{snap:true}`만 쓰는 새 호출자가 생기면 원시 타일이 25→49로 **정확히 2배**가 된다(§8).
   - **이 설계가 실제로 여는 것**: 절대 격자이므로 (a) 같은 위도 대역·같은 반경이면 center가 몇 m 움직여도(예: "내 위치" GPS 오차로 클릭마다 좌표가 미세하게 흔들리는 경우) 타일 경계 상당수가 그대로 유지돼 캐시가 재사용된다. (b) 격자선이 반경과 무관한 고정 좌표선이라, 반경이 늘어나 바운딩박스가 커지면 새 바운딩박스는 기존 타일들의 격자선을 **대부분 포함하는 초집합**이 된다 — 작은 반경에서 이미 캐시된 타일 상당수가 반경을 키운 뒤에도 같은 키로 재사용되고, 새로 늘어난 바깥쪽 타일만 캐시 미스로 남는 경향을 만든다.
   - **첫 방문 원시 타일 수 증가(트레이드오프)**: `snap:true`+프루닝 경로의 검색 대상 타일(23개/최대 69회)이 `snap:false`+프루닝(18개/최대 54회)보다 많다(위 "거리 제한: 도보 10분" 절 표 참고). **탭1을 한 번만 쓰고 떠나는 세션(캐시가 전혀 없는 콜드 방문)은 이 차이(+27.8%)만큼 순증(더 많은 Kakao 호출)이다** — 이 변경의 이득은 재방문·반경확대·내 위치 전환처럼 **같은 위도 대역 안에서 center/radius가 달라지는 재수집**에서 나온다(§8에 이 트레이드오프를 정직하게 남긴다).
   - **캐시 재사용률 실측(24방향 평균, 커버리지 수정 반영 최종치)** — 회사 좌표에서 다양한 방향·거리로 이동한 뒤 `tileCacheKey` 교집합 비율을 잰 결과:

     | 이동 거리 | `snap:false` | `snap:true` |
     |---|---|---|
     | 5m(GPS 흔들림 수준) | 0.0% | **100.0%** |
     | 100m | 0.0% | **98.4%** |
     | 300m | 0.0% | **84.6%** |
     | 600m | 0.0% | **67.1%** |
     | 800m | 0.0% | **54.7%** |

     `scripts/oracle-check.mjs`의 D19(단일 방향 100m/300m 이동, 스냅 원시 타일이 49개로 늘어 교집합 42/49=85.7%)·D19b(반경 800m 내 40개 임의 표본, 최소 재사용률 61.2%)도 같은 결론을 자동 회귀로 재확인한다 — 이 두 자동 판정 값은 위 표(사람이 24방향으로 별도 측정한 값)와 표본·방향 구성이 달라 숫자가 정확히 일치하지는 않지만, 둘 다 "`snap:true`는 항상 `> 0%`, `snap:false`는 사실상 0%"라는 같은 결론을 가리킨다.
   - **모의 SDK 종단 시뮬레이션(실측)** — 실제 Kakao 호출 횟수로 환산하면: 같은 기준점 재방문(6시간 내)은 23/23 캐시 히트로 **0회**, 회사 수집 후 137m 이동해 재수집하면 **16회 → 2회**. 탭1·탭3 동시 진입은 in-flight dedupe로 1회분만 발생한다(아래 5번).
2. **지오코딩 캐시** — `lunch_geocode_v1`(`{ [address]: {lat, lng, ts} }`), **TTL 30일**(`GEOCODE_TTL_MS`). `config.CENTER`가 채워져 있으면 그 값을 그대로 쓰고(기존 동작 유지), 없을 때만 캐시 → 미스 시 Kakao Geocoder 1회를 탄다. 실패는 캐시하지 않고 그대로 전파(`GEOCODE_FAILED`) — 임의 좌표로 대체하지 않는다(창작 금지/D9).
3. **공유 수집 모듈 `lib/places.js` 신설** — `app.js`(탭1)와 `worldcup.js`(탭3)가 **같은 모듈 인스턴스**를 import해 SDK 로드·지오코딩·타일 검색을 공유한다. `worldcup.js`는 기존에 로컬로 재구현하고 있던 `loadKakaoSdk`/`waitForExistingKakaoSdk`/`categorySearchPage`/`searchTile`/`collectCandidatesOwn`을 전부 걷어내고 `lib/places.js`의 `loadKakaoSdk`/`resolveCompanyCenter`/`collectCandidates`를 그대로 쓴다 — 탭3의 중복 재구현과 중복 SDK 스크립트 로드가 사라진다.
   - `export function loadKakaoSdk(appKey)` — 모듈 스코프 싱글턴 프로미스(`sdkPromise`). 이미 로드됐거나 로드 중이면 그 값/프로미스를 그대로 반환해 script 태그가 항상 1개다. 실패는 캐시하지 않는다(재시도 가능하도록 `sdkPromise`를 되돌림).
   - `export async function resolveCompanyCenter(config)` — `config.CENTER`가 유효하면 그대로 쓰고, 아니면 지오코딩 캐시(위 2번) → 미스 시 `geocodeAddress`(`lib/core.js`)로 1회 호출. 실패는 그대로 전파.
   - `export async function collectCandidates(center, radius, config)` — 아래 4~6의 프루닝·캐시·거리 재계산·in-flight dedupe를 모두 포함한 수집 함수. 반환값 `{ list, before, after, searchCalls, cachedTiles, fetchedTiles }`.
4. **원 밖 타일 프루닝** — `isTileOutsideRadius(tile, center, radiusMeters)`로 원과 교차하지 않는 타일을 검색 전에 걸러낸다. 판정은 타일 사각형에서 center에 가장 가까운 점을 축별 clamp로 구한 뒤 **`haversineMeters`로 거리를 잰다.** **안전성 근거**: 사각형에서 center에 가장 가까운 점조차 반경 밖이면, 그 타일 안의 어떤 지점도 반경 안에 들어올 수 없다 — 즉 프루닝된 타일은 검색하더라도 `filterByRadius`가 100% 버릴 타일이므로 **후보 손실이 없다**(D17).
   - **⚠️ 정정 — 최초 구현은 이 거리를 등장방형(equirectangular) 근사로 쟀는데, 최종 반경 필터 `filterByRadius`는 하버사인으로 잰다(적대적 리뷰 발견 결함 a).** 두 근사가 약 0.3% 어긋나는 지점에서, 실제로는 반경 안(하버사인 기준)인 타일을 프루닝이 반경 밖으로 오판해 그 타일의 후보가 통째로 검색되지 못하는 정보 손실이 있었다. 실측 반례(적대적 리뷰): `center = {lat: 37.54638305542474, lng: 127.06547994871624}`, `radius=800`에서 어떤 타일의 최근접점 하버사인 거리가 **799.70m(≤800m, 반경 안)**인데 등장방형 근사로는 반경 밖으로 판정돼 프루닝됐다. **수정**: 프루닝 판정 함수를 `haversineMeters`로 통일해 최종 필터와 같은 거리 함수를 쓰게 했고, 부동소수·근사 잔차까지 보수적으로 흡수하도록 `PRUNE_SAFETY_MARGIN_METERS = 2`(m)를 더해 `haversine(center, nearest) > radiusMeters + 2`일 때만 프루닝한다 — **이 마진은 "덜 프루닝하는" 방향으로만 작동해야 한다**(후보를 잃느니 타일 몇 개를 더 검색하는 편이 안전하다, §8). 전환 비용은 낮았다 — R=800/1200/1800 각 조합에서 프루닝 타일 수가 최대 **+0~1개**만 늘었다(실측, `scripts/oracle-check.mjs` D17 로그).
   - 프루닝은 항상 `buildGridTiles`의 반환값을 호출부(`lib/places.js`)에서 한 번 더 거르는 방식으로 구현되며, `isTileOutsideRadius` 자체는 `buildGridTiles`가 `snap` 옵션 없이 만들던 기존 타일이든 `{snap:true}`로 절대 격자에 맞춘 타일이든 동일하게 적용된다. `buildGridTiles` 자체는 기존 3-인자 호출(`center, radiusMeters, tileSizeMeters`)의 동작은 그대로 보존하지만, 절대 격자 정렬을 위해 4번째 인자 `{snap?: boolean}`(기본 `false`)이 새로 추가됐다 — 시그니처 자체는 **하위 호환을 유지하며 확장**됐고, 기존 D8(고정 3-인자 경로)은 무영향이다(D18이 `snap:true` 경로의 커버리지를 별도로 검증).
5. **in-flight dedupe** — 모듈 스코프 `Map<string, Promise>`(키 `` `${center.lat.toFixed(5)},${center.lng.toFixed(5)},${radius}` ``)로, 같은 (center, radius) 수집이 이미 진행 중이면 새 검색을 시작하지 않고 그 Promise를 그대로 반환한다. 탭1·탭3가 동시에 처음 진입해 같은 좌표·반경을 요청하는 경우의 중복 수집을 막는다. **정정**: 최초 구현은 키를 원시 부동소수(`center.lat`/`center.lng`)로 만들었는데, 탭1과 탭3가 (같은 스냅 타일 집합을 원하는) 사실상 같은 요청이어도 부동소수 표현이 미세하게 달라(예: `37.545013…` vs `37.545010…`) dedupe가 걸리지 않는 경우가 있었다. `tileCacheKey`와 같은 해상도(소수 5자리 ≈ 1.1m)로 반올림해 맞췄다.
6. **거리 계산 자체화(캐시 오염 방지, 중요)** — Kakao `place.distance`는 요청 시 `location`(=그 요청의 center) 기준 **상대값**이라, 그대로 캐시에 넣으면 이후 기준점이 바뀔 때(반경 확대로 격자가 재구성되거나, "내 위치" 전환으로 center 자체가 바뀔 때) 캐시된 값이 옛 기준점 기준 거리로 오염된다. 그래서 타일 캐시(`toCachedPlace`)에는 `{id, name, category_name, lat, lng, address, place_url}`만 저장하고 `distance`는 **저장하지 않는다.** 병합 후 신규 순수함수 `haversineMeters(a, b)`(`lib/core.js`, 구면 하버사인, 지구 반경 6,371,000m)로 **지금 기준점**에서 다시 계산한다. Kakao의 `distance`도 직선거리이므로 하버사인과 동등한 근사이고, 결과 카드의 "직선 근사" 표기(§ UI)는 그대로 유효하다.

**신뢰성 보강(적대적 리뷰 반영, `lib/places.js`)**:
- **SDK 싱글턴 검사 순서 수정** — Kakao SDK는 `autoload=false`로 로드하는데, `sdk.js` 스크립트 평가가 끝난 직후 `window.kakao.maps`는 이미 존재하지만 `load()` 메서드만 있는 **스텁 상태**이고(`services` 등 실제 API는 `kakao.maps.load(callback)`의 콜백 안에서만 생긴다), 최초 구현은 이 스텁 존재만 보고 즉시 resolve할 조건을 먼저 검사해 두 번째 호출자(예: 탭1 로딩 중 탭3를 여는 경우)에게 **`services`가 없는 반쪽짜리 kakao 객체**를 돌려줬다. 그러면 `new kakao.maps.services.Geocoder()`가 `TypeError`로 죽고, 당시 `worldcup.js`가 쓰던 `loadedOnce` 플래그는 실패해도 `true`로 남아 **새로고침 전까지 탭3가 영구적으로 죽는** 결함이 있었다. 수정: 진행 중인 `sdkPromise`를 **먼저** 확인하고, 즉시 resolve 조건에도 `window.kakao.maps.services` 존재까지 확인하도록 순서를 바꿨다.
- **`Promise.all` → `Promise.allSettled`** — 타일 여러 개를 동시에 검색할 때, 최초 구현은 `Promise.all`을 써서 타일 1개만 실패(`SEARCH_FAILED`)해도 이미 성공한 나머지 타일 결과까지 전부 버려졌다(재시도하면 성공했던 타일까지 처음부터 다시 검색). `Promise.allSettled`로 바꿔 실패를 던지기 **전에** 성공한 타일들을 먼저 캐시에 적재하고, 그중 하나라도 실패가 있으면 그때 에러를 던진다(호출부는 여전히 실패로 인지해 사용자에게 안내하지만, 성공분은 캐시에 남아 다음 재시도에서 재검색되지 않는다). 검증: 23타일 중 3타일이 실패하도록 모의 SDK를 구성하면 **20타일이 캐시에 적재**되고, 재시도 시 추가 호출은 실패했던 **3타일분만** 발생한다.
- **캐시 write를 read-modify-write로 변경** — 최초 구현은 수집 시작 시 읽어둔 캐시 스냅샷에 새로 받은 타일을 합쳐 그대로 덮어썼는데, 탭1·탭3가 겹쳐 도는 동안 두 수집이 서로 다른 스냅샷을 기준으로 저장하면 **나중에 쓰는 쪽이 먼저 쓴 쪽의 신규 타일을 지워버리는** 경합이 있었다. 저장 직전에 캐시를 **다시 읽어(latest)** 그 위에 이번 수집분만 합쳐 쓰도록 바꿨다.
- **`categorySearch`의 `location` 파라미터 제거** — `bounds`(타일 사각형)와 `location`을 함께 넘기면 Kakao SDK가 이를 정렬 힌트로 쓰거나 무시하는 동작이 문서화돼 있지 않아, 같은 타일이라도 어느 center로 검색했는지에 따라 응답이 달라질 잠재적 캐시 오염 경로였다(캐시 키는 타일 경계만으로 만들어 center 독립이어야 하는데, 응답 자체가 center에 의존하면 그 전제가 깨진다). `location`을 넘기지 않고 `{ bounds, page }`만 쓰도록 정리했다 — 거리는 원래도 응답의 `distance`를 안 쓰고 병합 후 `haversineMeters`로 직접 계산하므로 기능 손실이 없다.
- **캐시 키 버전 규칙(주석)** — `toCachedPlace`(place를 캐시 가능한 형태로 정규화하는 함수)의 필드 구성을 바꿀 때는 **반드시 `TILE_CACHE_KEY`의 버전(`_v1`)을 올려야 한다**는 규칙을 코드 주석으로 남겼다. 키를 그대로 두면, TTL(6시간) 안에 남아있는 옛 스키마 캐시 엔트리가 `isFreshTileCache`를 그대로 통과해 신규 필드가 `undefined`인 place가 화면에 빈 값으로 노출될 수 있다(창작 금지가 막으려는 것과 같은 종류의 오인 표시 경로).
- **캐시 엔트리 캡 200 → 120** — 200엔트리는 UTF-16 기준 약 3.4MB로 추정되는데, localStorage 한도(브라우저 통상 5MB)에 여유가 약 30%뿐이라 다른 키(`lunch_recent`, `lunch_geocode_v1` 등)와 합쳐 초과하면 `setItem`이 조용히 실패해 "최근 N곳 제외" 기능(`lunch_recent` 저장)이 죽는 것과 같은 취약점이었다. 120엔트리(약 2MB 추정)로 낮춰 여유를 늘렸다.
- **후보 0건 조기 반환 시 계측 유실 수정** — `recordSearchMetrics`(app.js) 호출 경로를 정리해, 검색 결과 후보가 0건이라 조기 반환하는 경로에서도 그 검색의 `elapsedMs`/`searchCalls`/`cachedTiles`/`fetchedTiles`가 유실되지 않고 기록되도록 했다(이전에는 이 경로에서 계측이 누락되거나 다음 검색으로 잘못 전이되는 결함이 있었다).
- **SDK 로드 실패 시 `<script>` 태그 제거** — 실패한 스크립트 태그를 `document.head`에 남겨두면 재시도할 때마다 head에 태그가 계속 쌓인다. `onerror` 시 부모에서 제거하도록 정리했다.

**커버리지 검증(몬테카를로, 적대적 리뷰로 강화됨)**: `snap:true` 격자가 반경 안쪽 후보를 빠뜨리지 않는지 실측했다. **최초에는 좌표당 표본 2,000점으로 6개 좌표(회사/앵커 대역 경계 위·아래/시청 등)를 돌려 미포함 0건이라고 판정했으나, 이 밀도로는 위 "정정" 항목의 실측 반례(정동 800m 지점, bbox 경계에서 2.38m 차이)를 놓쳤다** — 좌표당 800m 반경 원의 넓이(약 200만㎡) 대비 표본 2,000개는 그 반례가 걸리는 좁은 경계 근방을 우연히 표집하지 못할 확률이 높았다(정직하게 남긴다). 리뷰가 좌표를 직접 골라 반례를 찾아낸 뒤, 표본을 **좌표당 20,000점(총 약 500만점)**으로 올리고 실측 반례 2곳(정동 800m 커버리지 구멍·타일 프루닝 799.70m 반례)을 회귀 케이스로 하드코딩해 상시 점검에 추가했다. 수정 후 재실행 결과 회사/앵커 대역 경계 위·아래/시청/반례 좌표 전부 **미포함 0건**(D18).

**설계 결정(정정) — "이력·캐시 초기화" 버튼은 타일 캐시도 함께 지운다**: 최초 구현은 `handleResetHistory`가 `clearRecent()`만 호출하고 `clearTileCache()`는 의도적으로 부르지 않았다(추천 이력과 식당 데이터 캐시는 별개 개념이며, 연결하면 이력 초기화 때마다 콜드 재수집이 강제돼 호출 절감 목표를 스스로 무력화한다는 논리였다). **이 결정은 적대적 리뷰로 뒤집혔다** — 타일 캐시 키가 (기준점이 바뀌어도 재사용되도록) **절대 좌표 기반**이라, "내 위치"로 검색해본 지점은 사용자가 지울 수단 없이 최대 6시간 동안 `lunch_tiles_v1`에 그대로 남아 있었다(사용자가 있었던 위치 정보가 기기에 남는데 삭제 버튼이 없는 상태 — 프라이버시 관점의 결함). 그래서 `handleResetHistory`에 `clearTileCache()`를 연결하고, 버튼 라벨을 "이력 초기화"에서 **"이력·캐시 초기화"**로 바꿔 두 가지를 함께 지운다는 것을 명확히 했다(`index.html`). 호출 절감이 무력화된다는 원래 우려는 뒤집을 만했다 — 캐시 삭제는 사용자가 **명시적으로 버튼을 누를 때만** 일어나므로(자동·주기적 삭제가 아니다) 평상시 절감 효과는 그대로 유지되고, 대신 사용자에게 위치 데이터에 대한 명시적 통제 수단이 생긴다. **2026-08-29 삭제 범위 확정**: `handleResetHistory`가 `lunch_recent`·`lunch_tiles_v1`에 더해 `lunch_metrics`(계측값 — ts·소요시간이 남는 사용자 데이터)까지 `clearMetrics()`로 지운다. `lunch_geocode_v1`(회사 주소 좌표)은 개인 위치가 아니라 **예외로 남기고**, 도움말 문구에 그 예외를 명시했다: `추천 이력·검색 결과·사용 기록은 이 기기에만 저장되고 서버로 전송되지 않아요. "이력·캐시 초기화"를 누르면 회사 주소 좌표 캐시만 남기고 모두 지워져요.`

## 2차 적대적 리뷰 반영 (초기화 경합·소프트 캡·탭3 재수집 규칙·접근성)
> Phase 6.0 산출물에 대한 2차 적대적 코드리뷰 결과다. 이 라운드를 끝으로 Phase 6.0 코드는 확정됐다.

- **초기화 경합(2중 방어)** — 검색이 진행 중인 동안에도 "이력·캐시 초기화"를 누를 수 있었는데, 수집이 끝나는 시점의 read-modify-write(위 1번 항목)가 방금 지운 엔트리를 그대로 되살리는 경합이 실측됐다(초기화 직후에도 **23개가 재기록**됨). 두 가지로 막는다: ① `setBusy()`가 초기화 버튼도 함께 비활성화한다(버튼 경로 차단). ② `lib/places.js`에 모듈 스코프 **캐시 세대 카운터**(`cacheGeneration`, `clearTileCache()`가 호출될 때마다 증가)를 두고, `runCollect`가 수집 시작 시점의 세대(`generationAtStart`)를 기억해뒀다가 저장 직전 현재 세대와 비교한다 — 다르면(=수집 도중 초기화가 있었으면) 그 수집분 저장을 건너뛴다. ①이 버튼 클릭 경로를, ②가 그 밖의 동시 수집 경로까지 포괄해 커버한다. 수정 후 잔존 엔트리 **0개**.
- **캐시 캡이 소프트 캡이 됨(중요, §8에도 기록)** — 캡(120)이 단일 수집이 쓰는 타일 수보다 작아지는 반경 구간이 있다(예: R=2700m → 172타일). 캡이 고정 상한이면 방금 수집한 172개 중 120개만 남고, **곧바로 재수집해도 그중 52개가 다시 콜드로 빠져(`fetchedTiles=52`) 호출 절감 목적이 그 구간에서 역전**됐다. `evictOldestTiles(cacheMap, maxEntries, protectedKeys = [])`에 **선택적 3번째 인자**를 추가해, `runCollect`가 이번 수집이 실제로 쓴 타일 키(캐시 히트분 포함)를 넘겨 상한 계산에서 보호한다(3번째 인자를 안 넘기면 기존 2-인자 동작 그대로라 D25는 무영향; 동률 `ts`는 나중에 삽입된 키를 남기는 tie-break 규칙도 함께 정의됨). 수정 후: R=2700 재수집은 `fetchedTiles=0`/`cachedTiles=172`/`searchCalls=0`, 800→1200→1800 누적 확대 뒤 R=800 재수집도 `fetchedTiles=0`. **트레이드오프**: 실효 상한이 `max(120, 단일 수집 타일 수)`인 소프트 캡이 됐다는 뜻이라, R=2700 직후 구간에서는 캐시가 일시적으로 172엔트리(추정 2.9MB, 5MB 한도 대비 여유가 가장 얇음)까지 부풀 수 있다. 더 조이려면 반경 상한을 두거나 캐시 place 필드를 줄여야 하는데 둘 다 이번 범위 밖이라 손대지 않았다.
- **탭3 재수집 규칙 정교화** — ① 기준점 서명(`currentOriginSignature`)에 **`radius`를 포함**했다(이전엔 mode+좌표만 봐서, 탭1에서 반경만 넓혀도 탭3가 옛 반경 풀을 계속 썼다). ② 수집 중에 들어온 탭 활성화(`tab:activate`)를 즉시 처리하지 않고 **`pendingActivate` 플래그로 보관**했다가, 수집이 끝난 직후(`drainPendingActivate`) 서명을 다시 확인해 필요하면 그때 재수집한다(이전엔 이 이벤트가 그냥 소실돼, 갱신을 보려면 탭을 한 번 더 왕복해야 했다). ③ 재수집 조건(`shouldRecollect`)은 `Number(current.radius) > Number(collected.radius)`일 때만 참이다 — 탭3 자체에서(반경 확대 버튼으로) 넓힌 반경을, 이후 단순 탭 전환이 다시 좁혀 보이게 하거나 불필요하게 재수집시키지 않기 위함이다. ④ 탭3 자체 수집 경로(`getSourceCandidates`/`ensureLocalCenter` 계열)의 반경 소스를 `CONFIG.RADIUS` 고정값에서 **`window.__lunchTab1.radius || CONFIG.RADIUS`**로 바꿨다 — 그대로 두면 `collectedOrigin.radius`(실제 수집에 쓴 반경)와 서명 비교 대상이 어긋나 **탭을 전환할 때마다 조건과 무관하게 재수집이 반복**되는 결함이 실측으로 드러났다. 검증: 탭1에서 800→1200으로 넓힌 뒤 탭3로 돌아오면 `#worldcup-origin` 표기가 "800m → 1200m"로 바뀌고 SDK 호출이 23→42(캐시 23 재사용, 19만 신규); 조건 변화 없이 탭을 4회 왕복해도 호출은 23→23(불필요한 재수집 없음).
- **탭3 반경 확대 더블클릭 방지** — `#worldcup-expand-btn`을 연타하면 (a) `renderOriginLine()`의 표기가 실제 풀을 만든 반경이 아니라 **의도한(더 큰) 반경**을 먼저 보여줘 정직 표기가 깨지고, (b) 늦게 끝난 수집이 이미 진행 중이던 토너먼트를 다시 리셋하는 문제가 있었다. `setWorldcupBusy(busy)`로 수집 중 버튼을 잠그고, `renderOriginLine()`은 항상 **`collectedOrigin.radius`**(실제로 그 풀을 만든 값)만 표시하도록 정정했다.
- **저정확도 경고를 상시 배지로 분리** — 상태줄(`status-msg`)에 얹으면 ① 그 뒤에 오는 검색 실패 안내를 덮어쓰고(저정확도 상태에서 검색까지 실패하면 사용자가 실패 이유를 못 봄), ② "다른 곳"을 한 번만 눌러도 사라지는 1회성이었다. 전용 `#geo-accuracy-notice`(`role="status"`, 기본 `hidden`) 배지로 분리해 `updateGeoAccuracyNotice()`가 `originMode==='geo' && accuracy > currentRadius`인 동안 계속 보여주고, 회사 기준으로 돌아가면 감춘다. 상태줄은 진행·실패 안내 전용으로 되돌렸다.
- **접근성 정정(WAI-ARIA APG)** — 위 "UI" 절 참고. `aria-pressed`를 라벨 토글과 같이 쓰면 상태와 낭독이 어긋나는 결함이 있어, 라벨은 `📍 내 위치`로 고정하고 상태는 `aria-pressed`+`.is-active`+헤더 문구로만 전달한다.
- **데드 코드 제거** — `worldcup.js`의 `escapeHtml`(모든 텍스트 삽입이 `textContent`를 쓰므로 애초에 이스케이프가 필요 없었다), `app.js`의 미사용 변수 `geoCenter`, 렌더되자마자 다음 상태 갱신에 즉시 덮이던 상태 문구. `#worldcup-origin`은 `collectedOrigin`이 없을 때(수집 전) `hidden`으로 감춰 빈 줄이 여백만 차지하지 않게 했다.

### 계측 확장
`recordMetrics`(app.js)에 `cachedTiles`/`fetchedTiles`를 추가한다(`collectCandidates`가 반환하는 값을 그대로 기록). **`searchCalls`는 실제 네트워크 호출만 센다** — 캐시 히트인 타일은 `searchCalls`에 기여하지 않으므로, 완전 캐시 히트 수집은 `searchCalls === 0`이다("다른 곳"처럼 애초에 재검색이 없는 경로도 `searchCalls: 0, cachedTiles: 0, fetchedTiles: 0`으로 계측 항목 형태를 통일한다).

### 신규 순수함수(`lib/core.js`)
| 함수 | 시그니처 | 하는 일 |
|---|---|---|
| `haversineMeters` | `(a: {lat,lng}, b: {lat,lng}) => number(m)` | 구면 하버사인 직선거리. 숫자가 아니면 `NaN`(임의 좌표로 대체하지 않는다) |
| `isTileOutsideRadius` | `(tile, center, radiusMeters) => boolean` | 타일이 반경 원과 전혀 안 겹치면 `true`(위 4번 안전성 근거) |
| `tileCacheKey` | `(tile) => string` | 타일 경계값을 소수 5자리로 고정 직렬화한 캐시 키 |
| `isFreshTileCache` | `(entry, nowMs, ttlMs) => boolean` | `entry.ts`가 유효하고 `nowMs - ts`가 `[0, ttlMs]` 안이면 신선. 형식 이상·미래 타임스탬프(시계 뒤틀림)는 `false` |
| `evictOldestTiles` | `(cacheMap, maxEntries, protectedKeys = []) => cacheMap` | `maxEntries` 초과 시 `ts`가 오래된 엔트리부터 제거한 새 객체 반환(원본 불변). **2026-08-29 추가**: 3번째 인자로 넘긴 키는 상한 계산에서 제외하고 항상 보존한다(미지정 시 기존 2-인자 동작과 동일 — D25 무영향). 동률 `ts`는 나중에 삽입된 키를 남긴다 |
| `normalizeGeoPosition` | `(position) => {lat,lng,accuracy: number|null}|null` | 위 "기준점 전환" 절 참고. `accuracy`는 저정확도 경고에 쓴다(D21) |
| `describeGeolocationError` | `(code) => string` | 위 "기준점 전환" 절 참고 |
| `originLabel` | `(mode, companyAddress) => string` | 위 "기준점 전환" 절 참고 |

> **기존 함수 시그니처 확장**: `buildGridTiles(center, radiusMeters, tileSizeMeters = 400)`에 4번째 인자 `{ snap?: boolean } = {}`가 추가됐다(기본 `snap:false`는 기존 3-인자 호출과 바이트 단위로 동일한 결과 — D8 무영향, HEAD 대비 랜덤 300케이스 비교로도 확인됨). `snap:true`일 때의 절대 격자 정렬은 위 "Kakao API 호출 절감" 절 1번을 참고. 같은 파일에 신규 상수 `export const GRID_ANCHOR_DEG = 0.5`도 추가됐다(값 선택 근거는 위 1번 항목 — 오라클/테스트가 앵커 대역 경계 좌표를 하드코딩하지 않고 이 상수로부터 계산해 도출하도록 export됨, D18/D19b가 실제로 이렇게 쓴다).

## 점심 영업 필터 (근사 — 영업시간 미제공 한계)
Kakao 검색은 영업시간을 안 주므로 "점심 영업 중"을 아래로 근사한다:
1. **음식점(FD6)만** 대상 → 카페(CE7) 자동 제외.
2. `category_name` 에 **야간 전용 업종 키워드**가 있으면 제외: 예) `술집`, `호프`, `바(BAR)`, `포장마차`, `요리주점`, `이자카야`, `야식`.
3. (선택·정확) `config.EXCLUDE_PLACE_IDS` / `INCLUDE_PLACE_IDS` 로 수동 제외·강제포함 오버라이드(실제 점심영업 확인분).
→ 그래도 100% 보장은 불가 → UI에 "영업 여부는 카카오맵에서 확인" 안내 + place_url 링크.

## 메뉴 힌트 도출
`category_name`(예: `음식점 > 한식 > 국밥`)에서 대표 메뉴 힌트를 만든다.
1. **리프 우선**: 마지막 세그먼트가 메뉴성이면 그대로 사용(`국밥` → "국밥", `돈까스,우동` → "돈까스/우동"). 쉼표는 "/"로 정리.
2. **매핑 폴백**: 리프가 막연한 상위 업종(한식/양식/중식…)이면 `config.CATEGORY_MENU_HINTS` 로 대표 메뉴를 제안(예: 양식→파스타/스테이크, 중식→짜장면/짬뽕, 분식→떡볶이/김밥, 일식→초밥/돈카츠, 아시아음식→쌀국수/팟타이).
3. **표기**: "메뉴 힌트: OO (업종 기반 추정)" 로 실제 메뉴가 아님을 명시하고, 상세는 `place_url` 로 위임(없는 메뉴 창작 금지).

## 추천 로직 (랜덤 + 최근 안 겹치게)
> **결정성(오라클 전제) — 설계 불변식**: 추천 난수원은 **주입 가능**해야 한다. 런타임은 `Math.random`, 검증에는 **고정 시드 PRNG를 주입**한다(`Math.random`은 시드 불가). 예: `pickRandom(list, rng = Math.random)` 처럼 난수원을 파라미터화.
>
> ⚠️ **이 하나의 결정이 검증 트랙 두 개의 가부를 동시에 정한다** ([tracks.md §3-1](tracks.md)).
> - **Regression** — golden 스냅샷이 재현 가능해야 한다([oracle.md](oracle.md) §1③)
> - **Probabilistic** — 같은 조건에서 수천 번 반복해 분포를 뽑을 수 있어야 한다(`spec §4` 분포 요구·D10)
>
> 즉 난수원 주입은 검증 편의가 아니라 **아키텍처 제약**이다. Phase 5에서 빠뜨리면 두 트랙이 함께 닫히고, 되돌리려면 프로덕션 코드를 다시 뜯어야 한다.

1. 반경 내 후보 리스트 수집(dedupe).
2. `localStorage["lunch_recent"]`(최근 place.id 배열, 최대 `RECENT_LIMIT`)에 있는 항목 제외.
3. 남은 후보에서 **주입된 `rng`(런타임 기본값 `Math.random`, 검증 시 고정 시드 PRNG 주입)**로 1곳 선택. (전부 소진되면 이력 순환: 가장 오래된 것부터 후보 복원) — 위 결정성 불변식과 일치.
4. 선택 id를 recent 앞에 push, 길이 초과분 truncate.
5. "다른 곳"은 방금 선택분도 제외하고 2~4 재실행.

## 계측 (Signal Track 관측점)
> `spec §5`의 "3초 이내"는 측정 수단이 없으면 **아무도 확인하지 않는 약속**이다. 정적 사이트라 서버 APM이 없으므로 관측점을 코드에 직접 심는다. 상세 배경은 [tracks.md §3-2](tracks.md).

한 번의 추천마다 아래를 기록한다(개인용·로컬 한정).

| 항목 | 무엇 | 왜 필요한가 |
|---|---|---|
| `elapsedMs` | 버튼 클릭 → 결과 카드 렌더 완료 | `spec §5` 3초 약속의 유일한 판정 근거 |
| `searchCalls` | 그 추천에 사용한 Kakao 검색 호출 수 — **실제 네트워크 호출만** 센다(캐시 히트는 0) | 추천 결과가 같아도 격자 타일이 늘면 호출·쿼터가 달라진다. 캐시 히트를 포함해 세면 "호출 절감이 됐는지"를 이 값 하나로 볼 수 없게 된다 |
| `candidateCount` | 필터 전/후 후보 수 | 격자 피복(D8)이 깨져 후보가 조용히 줄어도 추천은 정상으로 보인다 |
| `cachedTiles` | (2026-08-28 추가) 이번 수집에서 타일 캐시가 적중한 타일 수 | Kakao 호출 절감(위 "Kakao API 호출 절감" 절)의 효과를 직접 확인하는 유일한 값 |
| `fetchedTiles` | (2026-08-28 추가) 이번 수집에서 실제로 Kakao를 호출한 타일 수 | `cachedTiles + fetchedTiles`가 프루닝 후 검색 대상 타일 수와 일치해야 한다(둘 다 0이면 재검색 자체가 없었던 경로 — 예: "다른 곳") |

- 저장은 `localStorage["lunch_metrics"]`에 **최근 N회 링버퍼**로만 둔다(개인정보 원칙 — 네트워크 전송 없음, constitution 2).
- 값은 **절대값 기준**으로 판정한다(예: `elapsedMs > 3000` 이면 위반 — `spec §5`). 개인용이라 시행 횟수가 적어 "몇 배" 같은 비율 지표는 신뢰할 수 없다. ⚠️ 이 절대 임계 판정은 레퍼런스가 스펙이므로 엄밀히는 **명세 오라클**이고, 여기서 하는 일은 Signal Track의 **관측점 확보**다 — [tracks.md §3-2](tracks.md).
- 개발자 콘솔·숨은 디버그 화면에서 확인 가능하면 충분하다. 대시보드는 범위 밖.

## UI (모바일 우선)
- 상단 타이틀 옆 '?' 아이콘 → 클릭 시 레이어 팝업(모달)으로 추천 로직 설명. 반경·야간업종 제외·최근 이력 제외·랜덤 선택·메뉴 힌트 근거를 `config.js` 값 기반으로 **동적 생성**(하드코딩 금지 — 값이 바뀌면 설명도 같이 바뀜). 배경 클릭/✕/ESC로 닫기. SDK 로드 실패 등으로 다른 버튼이 비활성화돼도 이 버튼은 항상 동작.
- 상단: 타이틀 + "🍚 오늘 점심 추천" 버튼
- 결과 카드: 식당명 / 업종 / **메뉴 힌트(업종 기반 추정)** / 거리(**직선 근사 · 도보 약 N분** 표기 — 2026-08-29: 근거를 문구에 직접 붙임, `"도보 1분=${WALK_METERS_PER_MIN}m 관행 기준 근사"`) / "카카오맵에서 보기"(place_url) / 지도 미니맵(마커) / "영업 여부·메뉴는 카카오맵 확인" 안내
- 후보 0일 때: 오류 없이 안내 + "반경 확대" / "이력·캐시 초기화" 버튼
- 하단: **"내 위치"**(라벨 `📍 내 위치` 고정, `.is-active`+`aria-pressed`로 상태 표시, 위 "기준점 전환" 절) · "다른 곳" · "최근 추천 보기" · "이력·캐시 초기화"(2026-08-29: 라벨 변경 — 위 "이력 초기화" 설계 결정 정정 참고) · 저정확도 시 `#geo-accuracy-notice` 상시 배지(상태줄과 별도 영역)
- 다크·라이트 대응(prefers-color-scheme)

## 설정 (`config.js`)
```js
window.LUNCH_CONFIG = {
  KAKAO_JS_KEY: "<도메인 제한 JS 앱키>",
  COMPANY_ADDRESS: "서울특별시 성동구 아차산로13길 11", // Geocoder로 좌표 변환
  CENTER: null,        // 지오코딩 결과 캐시 시 { lat, lng } 채움(없으면 런타임 지오코딩)
  WALK_MINUTES: 10,    // 코드 미사용 참고값(실제 도보 분 계산은 app.js의 WALK_METERS_PER_MIN=80). 2026-08-28: 15→10(반경 1000m→800m와 함께 조정, 근거는 "거리 제한: 도보 10분" 절)
  RADIUS: 800,         // m, 직선. 도보 10분 근사(2026-08-28: 1000에서 낮춤)
  RECENT_LIMIT: 10,    // 최근 제외 개수
  EXCLUDE_CATEGORY_KEYWORDS: ["술집","호프","바(BAR)","포장마차","요리주점","이자카야","야식"], // 야간전용 제외(점심영업 근사)
  EXCLUDE_PLACE_IDS: [], // 수동 제외(실제 점심 미영업 확인분)
  INCLUDE_PLACE_IDS: [], // 수동 강제포함
  CATEGORY_MENU_HINTS: {  // 막연한 상위 업종 → 대표 메뉴 힌트(리프가 메뉴성이면 리프 우선)
    "양식": ["파스타","스테이크"], "중식": ["짜장면","짬뽕"], "일식": ["초밥","돈카츠","우동"],
    "분식": ["떡볶이","김밥"], "한식": ["백반","찌개","비빔밥"], "아시아음식": ["쌀국수","팟타이"],
  },
  // MOREMORE_API_URL/SRCH_OPER_CD/SRCH_ASSIGN_CD 는 config.js 에 없다 —
  // 클라이언트가 더 이상 직접 호출하지 않으며(CORS 차단 확인, 모락모락 데이터소스 절 참조),
  // 이 값들은 scripts/fetch-moremore.mjs 안의 상수로 옮겨졌다(Actions 크롤러 전용).
  WORLDCUP_POOL_SIZE: 16,
  WORLDCUP_CATEGORY_EMOJI: { // 카테고리(리프)→이모지 매핑, 매칭 없으면 폴백 이모지 사용
    "한식": "🍚", "양식": "🍝", "중식": "🥟", "일식": "🍣", "분식": "🍢", "아시아음식": "🍜",
  },
};
```

## 호스팅
- GitHub Pages(정적). `.nojekyll` 포함. **public 레포**(무료 Pages 조건).
- 배포 도메인(`namsukim8021.github.io`)을 Kakao 앱키 허용 도메인에 등록.

## 한계 / 결정
- Kakao Local은 **개별 메뉴·가격 미제공** → 메뉴는 카테고리 수준 제안 + 카카오맵 링크 위임(spec §8).
- 실시간 영업여부 미제공 → 표시하지 않음(창작 금지 원칙).
- **데이터소스 교체 시 Migration Track 발동** — 지금은 구현체가 하나뿐이라 해당 없음이지만, Kakao SDK를 다른 지도 SDK로 바꾸는 변경은 A vs A′(회귀)가 아니라 **A vs B**(구현체 간 동등성)다. 이때 기존 golden을 그대로 리플레이하면 대부분 불일치가 나는데, 이는 결함이 아니라 **트랙 선택 오류**다([tracks.md §4](tracks.md)).

## 테스트 관점(구현 시)
- 이력 제외가 실제로 중복을 막는가(연속 N회 서로 다름).
- 후보 0/소수일 때 순환·안내(반경 확대/이력 초기화) 처리.
- **격자 분할**이 45개 상한을 넘어 전수에 가깝게 수집하는가(단일 검색 대비 후보 수↑).
- **메뉴 힌트**가 category_name 리프/매핑으로 올바로 도출되는가(막연 업종 폴백 포함).
- **거리 표기**가 직선·근사임을 정직히 나타내는가.
- **지오코딩 실패** 시 임의 좌표로 진행하지 않고 안내하는가.
- 키 미설정·검색 실패 시 사용자 안내(에러 폴백).
- **난수원 주입이 실제로 되는가** — 고정 시드 PRNG를 주입했을 때 같은 입력에 같은 추천이 재현되는가(Regression·Probabilistic 두 트랙의 전제).
- **추천 분포가 균등한가** — 고정 후보집합·고정 시드로 대량 시행 시 특정 후보 쏠림이 없는가(D10).
- **계측값이 기록되는가** — `elapsedMs`·`searchCalls`·`candidateCount`가 추천마다 남는가.
- **모락모락 4경로**가 모두 같은 "준비중입니다"로 귀결하는가(fetch 실패/빈 data/파싱 예외/날짜 불일치 4가지 모두 확인, `isFreshMoremoreData` 포함).
- **월드컵 라운드 축소**가 매번 정확히 절반이고 패자가 재등장하지 않는가(16→8→4→2→1).
- **월드컵 결정성** — 주입 가능 rng로 16개 추출 시 같은 시드에서 같은 참가 풀이 재현되는가.
- **후보 부족 처리** — 유효 힌트 보유 후보가 16개 미만일 때 지어내지 않고 안내되는가.
- **탭1 재사용** — `hasSearchedOnce && candidates.length > 0`일 때 월드컵이 Kakao 검색을 다시 호출하지 않고 `window.__lunchTab1`의 후보를 그대로 쓰는가.
- **모락모락 카드 사진**(수동/육안 확인 — 자동 오라클 없음) — 사진이 원본 비율로 크롭 없이 렌더되는가, 사진 부재·로드 실패(이미지 hang 타임아웃 포함) 시 "사진 없음" 플레이스홀더로 폴백하는가.
- **(2026-08-28 추가, 2026-08-29 하버사인 통일로 갱신) 원 밖 타일 프루닝 무손실** — `isTileOutsideRadius`가 `true`로 판정한 타일 안의 임의 표본점이 전부 center로부터 반경(+`PRUNE_SAFETY_MARGIN_METERS`)을 초과하는가, 프루닝 거리 함수가 최종 `filterByRadius`와 같은 하버사인인가(D17, 실측 반례 799.70m 회귀 포함).
- **(2026-08-28 추가, 2026-08-29 커버리지 결함 수정으로 갱신) 스냅 격자 커버리지** — `snap:true` 격자도 반경 안 임의 표본점을 빠짐없이 덮는가, 앵커 대역 경계를 걸치는 좌표·앵커보다 북쪽인 center의 축 방향 극단점에서도 그런가(D18, 실측 반례 정동 800m 지점 회귀 포함).
- **(2026-08-28 추가) 스냅 격자 캐시 키 재사용 + 앵커 대역 경계 회귀** — center를 100m/300m 옮겨도 `tileCacheKey` 교집합이 상당수 유지되는가(`snap:false` 대조군은 거의 0인가), 회사 좌표 반경 800m 내 임의 이동에서 재사용률이 0%로 떨어지는 지점이 없는가(D19/D19b).
- **(2026-08-28 추가) 거리 계산의 기준점 독립성** — 캐시된 place에 대해 center를 바꿔 `haversineMeters`로 재계산한 distance가 새 center 기준 값과 일치하고, 이전 center의 값이 새어나오지 않는가. 독립적인 기하학적 정답(자오선·적도 대원거리)과도 오차 1% 미만인가(D20).
- **(2026-08-28 추가) 위치정보 창작 금지 + 오류 매핑** — `normalizeGeoPosition`이 좌표를 지어내지 않고 `null`을 반환하는 입력 범위, `describeGeolocationError`의 코드별(1/2/3) 한국어 문구가 서로 구별되는가, `originLabel('geo', addr)`이 회사 주소를 노출하지 않는가(D21).
- **(2026-08-28 추가) 타일 캐시 정합성** — 동일 (center, radius)를 `collectCandidates`로 두 번 부르면 두 번째는 `searchCalls===0`·`fetchedTiles===0`·모의 SDK 재호출 없음·id 집합 동일인가(D22).
- **(2026-08-28 추가) 캐시 스키마 무오염** — `lunch_tiles_v1`에 저장된 place에 `distance` 키가 없는가, center 변경 후 재계산된 distance에 이전 center 값이 남아있지 않은가(D23).
- **(2026-08-28 추가) TTL 만료 재수집 + in-flight dedupe** — 캐시 ts를 TTL 밖으로 밀면 재수집이 실제로 일어나는가, 같은 (center,radius)를 동시에 2회 호출해도 모의 SDK 호출 수가 단독 1회와 같은가(D24).
- **(2026-08-29 추가) 지오코딩 캐시 전체 계약** — 콜드 1회/웜 0회/TTL(30일) 만료 재호출/미래 ts(시계 뒤틀림) 안전 처리/`config.CENTER` 우선 시 0회/실패 시 캐시 미기록이 전부 성립하는가(D29 — 이전엔 Geocoder 스텁이 항상 ZERO_RESULT라 이 경로들이 한 줄도 실행되지 않았다).
- **(2026-08-29 추가) 다중 페이지·ZERO_RESULT·용량 초과** — 다음 페이지 있는 타일이 정확히 2회 호출·병합되는가, `MAX_PAGES_PER_TILE` 상한에서 정확히 멈추는가, `QuotaExceededError` 시 throw 없이 수집은 성공하고 캐시만 미기록되는가(D30).
- **(2026-08-29 추가) 초기화 경합** — 수집 도중 "이력·캐시 초기화"가 눌리면 그 수집분이 캐시에 다시 쓰이지 않는가(캐시 세대 카운터).
- **(2026-08-29 추가) 캐시 소프트 캡** — 단일 수집 타일 수가 상한(120)을 넘는 반경에서, 그 수집분이 자기 자신을 밀어내지 않고 보호되는가(`evictOldestTiles`의 `protectedKeys`).
- **(2026-08-29 추가) 탭3 재수집 규칙** — 반경만 넓어져도 서명 불일치로 재수집되는가, 반경 변화 없는 탭 왕복은 재수집하지 않는가, 반경 확대 연타 시 표기가 실제 풀의 반경과 일치하는가.
- **(2026-08-28 추가, 2026-08-29 정정, 자동 오라클 부재)** "내 위치" 버튼의 실제 브라우저 위치 권한 팝업·`.is-active`/`aria-pressed` 상태 표시·`#geo-accuracy-notice` 배지가 실기기 스크린리더·화면에서 기대대로 동작하는가 — Node 스텁까지만 검증됐고 헤드리스 브라우저가 없어 사람이 확인해야 한다([oracle.md §2](oracle.md)).
