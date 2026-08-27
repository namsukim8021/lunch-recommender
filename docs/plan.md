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
  index.html + app.js + config.js
      │
      ├─ Kakao Maps JS SDK (libraries=services)  → 반경 내 음식점(FD6) 검색
      ├─ localStorage                            → 최근 추천 이력(안 겹치게)
      ├─ data/moremore-latest.json fetch          → 탭2 모락모락 오늘의 메뉴(같은 오리진, CORS 없음)
      └─ 지도 렌더 + 결과 카드 + 카카오맵 링크
```

### 탭 구조 (3패널, 라우팅 없음)
```
[브라우저 — 3탭 구조, 라우팅 없음(단일 index.html, hidden 토글)]
  index.html
    ├─ config.js                          → 전역 설정(window.LUNCH_CONFIG)
    ├─ 탭1(기본, hidden 토글) — app.js     → 위 다이어그램 그대로(무변경)
    │     └─ window.__lunchTab1 getter 노출 (candidates/center/radius/hasSearchedOnce)
    ├─ 탭2 모락모락(hidden 토글) — moremore.js → 같은 오리진 data/moremore-latest.json fetch(Actions 크롤러가 커밋)
    └─ 탭3 월드컵(hidden 토글) — worldcup.js   → window.__lunchTab1 재사용 우선, 없으면 lib/core.js로 자체 수집
  tabs.js                                  → 탭 전환(활성 탭만 표시, 페이지 이동/라우팅 없음)
```
**신규 파일**: `tabs.js`(탭 전환) · `moremore.js`(모락모락 데이터소스+렌더) · `worldcup.js`(월드컵 풀 구성+브래킷+렌더). 기존 `app.js`/`lib/core.js`/`config.js`/`index.html`의 파일 구조 원칙(ES 모듈, 단일 파일)은 유지하고, 위 3개 파일만 추가된다.

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
- **탭1 재사용 방식(getter 노출)**: `app.js`는 기존 `let candidates` / `let center` / `let currentRadius` / `let hasSearchedOnce` 선언부 바로 아래에 **단 한 번**, 작은 getter 객체를 추가한다(그 외 app.js의 기존 로직·동작은 절대 바꾸지 않는다):
  ```js
  window.__lunchTab1 = {
    get candidates() { return candidates; },
    get center() { return center; },
    get radius() { return currentRadius; },
    get hasSearchedOnce() { return hasSearchedOnce; },
  };
  ```
  `worldcup.js`는 `window.__lunchTab1.hasSearchedOnce && window.__lunchTab1.candidates.length > 0`이면 그 후보를 그대로 재사용해 Kakao 검색을 중복 호출하지 않는다. 아직 없으면 `lib/core.js`의 공개 함수(`buildGridTiles`/`mergeGridResults`/`filterByRadius`/`filterLunchCandidates`)로 `worldcup.js` 자체 안에서 후보를 수집한다(app.js 내부 `categorySearchPage`와 같은 패턴을 이 파일 안에서 독자 구현 — 코드 일부 중복은 허용, app.js 무수정 원칙이 우선).
- **후보 부족 처리**: 유효 힌트 보유 후보가 16개 미만이면 지어내지 않고 "대표 메뉴가 16개 미만입니다 — 반경을 넓혀보세요" 안내 + 반경 확대 버튼을 보여준다.
- **브래킷 진행(순수 함수)**: 매 라운드 참가자 수는 정확히 절반, 승자만 다음 라운드에 진출(패자 재등장 없음), 각 매치는 서로 다른 두 참가자로 구성한다.
- **매치 UI**: 좌/우로 카테고리 이모지(실사진 아님을 명시)·메뉴명·식당명을 보여준다. 최종 우승 시 실제 식당명과 카카오맵 링크(`place.place_url` — 이 레포 필드명은 snake_case `place_url`)로 연결한다.

## 데이터 소스: Kakao Maps JS SDK
- 로드: `//dapi.kakao.com/v2/maps/sdk.js?appkey={JS_KEY}&libraries=services&autoload=false`
- **중심 좌표(주소→좌표)**: 회사 주소 `서울특별시 성동구 아차산로13길 11` 을 `kakao.maps.services.Geocoder().addressSearch(addr, cb)` 로 1회 지오코딩해 CENTER 로 사용(하드코딩 좌표 대신 주소 기준 → 창작 금지 준수). 지오코딩 결과를 config `CENTER`에 캐시해도 됨. **실패/무결과 시**에는 임의 좌표로 진행하지 않고 사용자에게 안내 후 중단한다.
- 검색: `kakao.maps.services.Places().categorySearch('FD6', cb, { location: LatLng(CENTER), radius: RADIUS, sort:'distance' })`
  - `FD6` = 음식점 카테고리(카페 CE7 은 애초에 제외됨). 페이지네이션으로 후보 모아 dedupe(`place.id` 기준).
  - 결과 필드 활용: `place_name`, `category_name`, `distance`(직선 m), `road_address_name`, `x/y`(경위도), `place_url`.
- **키**: 도메인 제한된 **JS 앱키**만 사용(Kakao Developers에서 배포 도메인 등록). REST 키 미사용 → 정적으로 안전.

## 후보 수집 상한 & 완화 (Kakao 검색 45개 제한)
- ⚠️ `categorySearch`/`keywordSearch` 는 한 검색당 **최대 45개(15개×3페이지)** 만 접근 가능(`pagination.totalCount` 가 더 커도 나머지는 못 받음). 성수 반경 1km는 음식점이 45개를 초과할 가능성이 커, 단순 1회 검색이면 **일부 식당이 후보에서 조용히 누락**되어 랜덤 대표성이 훼손된다.
- 완화(택1·조합):
  1. **격자 분할 검색(기본)**: 검색 영역을 `rect`(bounding box) 타일로 쪼개 각 타일을 개별 검색한 뒤 `place.id` 로 합집합·dedupe. 각 타일이 45개 미만이 되도록 크기를 잡으면 사실상 전수 수집. (`distance <= RADIUS` 로 원형 보정)
  2. **반경 축소**: `RADIUS` 를 줄여 결과를 45개 이내로(도보 15분 취지 범위 내).
  3. **표본 고지**: 위 완화 없이 45개 표본만 쓸 경우, "주변 일부에서 추천"임을 UI에 명시(과장·창작 금지).
- 기본 전략은 **격자 분할**로 반경 내 전수 수집을 지향(개인용 트래픽이라 JS SDK 쿼터 내에서 충분).

## 거리 제한: 도보 15분 (근사)
- Kakao 는 보행 소요시간을 주지 않고 `radius`/`distance` 는 **직선거리**다. 따라서 도보 15분을 직선거리로 근사한다.
- 산정: 보행 4km/h ≈ 67m/분 → 15분 ≈ 보행경로 약 1,000m. 도로 우회를 엄격히 반영하려면 직선 반경을 더 줄인다(우회계수 1.3 가정 시 ≈ 770m).
- **기본값 `RADIUS = 1000`(m)** 로 두되(통상 '도보 15분 ≈ 1km' 직관과 일치), 과다 포함이 느껴지면 config에서 800m 로 낮춘다. 후보는 `distance <= RADIUS` 로 한 번 더 거른다.
- (정확한 보행시간은 별도 길찾기 API가 필요 → 정적·무료 범위 밖, 도입 시 재검토)

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
| `searchCalls` | 그 추천에 사용한 Kakao 검색 호출 수 | 추천 결과가 같아도 격자 타일이 늘면 호출·쿼터가 달라진다 |
| `candidateCount` | 필터 전/후 후보 수 | 격자 피복(D8)이 깨져 후보가 조용히 줄어도 추천은 정상으로 보인다 |

- 저장은 `localStorage["lunch_metrics"]`에 **최근 N회 링버퍼**로만 둔다(개인정보 원칙 — 네트워크 전송 없음, constitution 2).
- 값은 **절대값 기준**으로 판정한다(예: `elapsedMs > 3000` 이면 위반 — `spec §5`). 개인용이라 시행 횟수가 적어 "몇 배" 같은 비율 지표는 신뢰할 수 없다. ⚠️ 이 절대 임계 판정은 레퍼런스가 스펙이므로 엄밀히는 **명세 오라클**이고, 여기서 하는 일은 Signal Track의 **관측점 확보**다 — [tracks.md §3-2](tracks.md).
- 개발자 콘솔·숨은 디버그 화면에서 확인 가능하면 충분하다. 대시보드는 범위 밖.

## UI (모바일 우선)
- 상단 타이틀 옆 '?' 아이콘 → 클릭 시 레이어 팝업(모달)으로 추천 로직 설명. 반경·야간업종 제외·최근 이력 제외·랜덤 선택·메뉴 힌트 근거를 `config.js` 값 기반으로 **동적 생성**(하드코딩 금지 — 값이 바뀌면 설명도 같이 바뀜). 배경 클릭/✕/ESC로 닫기. SDK 로드 실패 등으로 다른 버튼이 비활성화돼도 이 버튼은 항상 동작.
- 상단: 타이틀 + "🍚 오늘 점심 추천" 버튼
- 결과 카드: 식당명 / 업종 / **메뉴 힌트(업종 기반 추정)** / 거리(**직선 · 도보 약 N분** 근사 표기) / "카카오맵에서 보기"(place_url) / 지도 미니맵(마커) / "영업 여부·메뉴는 카카오맵 확인" 안내
- 후보 0일 때: 오류 없이 안내 + "반경 확대" / "이력 초기화" 버튼
- 하단: "다른 곳" · "최근 추천 보기/초기화"
- 다크·라이트 대응(prefers-color-scheme)

## 설정 (`config.js`)
```js
window.LUNCH_CONFIG = {
  KAKAO_JS_KEY: "<도메인 제한 JS 앱키>",
  COMPANY_ADDRESS: "서울특별시 성동구 아차산로13길 11", // Geocoder로 좌표 변환
  CENTER: null,        // 지오코딩 결과 캐시 시 { lat, lng } 채움(없으면 런타임 지오코딩)
  WALK_MINUTES: 15,    // 도보 기준(참고값)
  RADIUS: 1000,        // m, 직선. 도보 15분 근사(엄격히 하려면 800)
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
