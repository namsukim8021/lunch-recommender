// moremore.js — 탭2 모락모락(구내식당 오늘의 메뉴) (ES 모듈)
// 브라우저 직접 fetch는 CORS로 실제 차단됨을 실측 확인(docs/spec.md §8) — 대신
// GitHub Actions 예약 크롤러(scripts/fetch-moremore.mjs)가 서버사이드로 수집해
// 커밋한 같은 오리진의 data/moremore-latest.json 을 fetch한다. 상대경로 사용
// (GitHub Pages가 /lunch-recommender/ 서브패스에 배포되므로 절대경로 금지).
// 4경로(fetch 실패/비2xx·응답 200이나 빈 data·파싱 예외·날짜 불일치) 전부
// 동일한 showPreparing()으로 수렴(docs/plan.md, oracle D12).

import { parseMoremoreResponse, isFreshMoremoreData } from './lib/core.js';

let loadedOnce = false;

// 사진이 이 시간 안에 로드되지 않으면 실패로 간주해 대체 영역으로 넘긴다.
const IMAGE_TIMEOUT_MS = 8000;

function $(id) {
  return document.getElementById(id);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])
  );
}

// KST(UTC+9) 기준 YYYYMMDD를 매 호출 동적 생성(로컬 브라우저 타임존과 무관하게 정확히 계산).
// scripts/fetch-moremore.mjs와 동일한 방식(둘 다 파일 내 자체 구현, 공유 모듈 없음).
function getKstYyyymmdd() {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const kst = new Date(utcMs + 9 * 60 * 60000);
  const y = kst.getFullYear();
  const m = String(kst.getMonth() + 1).padStart(2, '0');
  const d = String(kst.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function showPreparing() {
  const list = $('moremore-list');
  const preparing = $('moremore-preparing');
  const status = $('moremore-status');
  if (list) list.hidden = true;
  if (preparing) preparing.hidden = false;
  if (status) status.hidden = true;
}

function renderItems(items) {
  const list = $('moremore-list');
  const preparing = $('moremore-preparing');
  const status = $('moremore-status');
  if (!list) return;

  list.innerHTML = items
    .map((item) => {
      // 이미지는 카드 상단 전면. onload/onerror 핸들러는 고정 문자열만 사용한다
      // (원격/사용자 데이터를 절대 보간하지 않는다 — XSS). 로드 실패 시 .is-failed 가
      // 붙으면 CSS 인접 선택자가 사진을 숨기고 바로 뒤의 대체 영역을 대신 띄운다.
      const img = item.imageUrl
        ? `<img class="mm-photo" src="${escapeHtml(item.imageUrl)}" alt="" loading="lazy" onload="this.classList.add('is-loaded')" onerror="this.classList.add('is-failed')" />`
        : '';
      // 사진이 없거나(코너별 미제공·업로드 전) 로드에 실패한 경우의 대체 영역.
      // 없는 사진을 지어내지 않는다(창작 금지). 문구는 "사진 없음" — 라면·석식처럼 끝내
      // 이미지가 제공되지 않는 코너가 있어 "준비 전"은 오지 않을 사진을 약속하는 표현이 된다.
      const mediaPlaceholder =
        '<div class="mm-media-ph" role="img" aria-label="사진 없음">' +
        '<span class="mm-ph-emoji" aria-hidden="true">🍽️</span>' +
        '<p class="mm-ph-text">사진 없음</p>' +
        '</div>';
      const nameEn = item.nameEn ? `<p class="mm-name-en">${escapeHtml(item.nameEn)}</p>` : '';
      const kcal = item.kcal !== null ? `<p class="mm-kcal">${escapeHtml(String(item.kcal))} kcal</p>` : '';
      const sides = item.sides.length
        ? `<p class="mm-sides">${escapeHtml(item.sides.join(' / '))}</p>`
        : '';
      return `
        <div class="mm-card">
          ${img}${mediaPlaceholder}
          <div class="mm-body">
            <span class="mm-corner">${escapeHtml(item.corner || '')}</span>
            <p class="mm-name-ko">${escapeHtml(item.nameKo)}</p>
            ${nameEn}
            ${kcal}
            ${sides}
          </div>
        </div>
      `;
    })
    .join('');

  // 이미지 요청이 응답도 에러도 없이 매달리면(CDN 지연·방화벽 drop) onload/onerror 가 모두
  // 발화하지 않아 로딩 스켈레톤이 영구히 남는다. 일정 시간 뒤에도 미완인 사진은 실패로 간주해
  // 대체 영역으로 넘긴다. img.complete 는 로드 완료(성공/실패 무관) 여부를 알려준다.
  window.setTimeout(() => {
    list.querySelectorAll('img.mm-photo').forEach((img) => {
      if (!img.complete) img.classList.add('is-failed');
    });
  }, IMAGE_TIMEOUT_MS);

  list.hidden = false;
  if (preparing) preparing.hidden = true;
  if (status) status.hidden = true;
}

async function loadMoremore() {
  const status = $('moremore-status');
  if (status) {
    status.hidden = false;
    status.textContent = '불러오는 중…';
  }

  let res;
  try {
    // cache: 'no-cache' — 캐시를 쓰되 매번 서버에 재검증한다. 벤더가 당일 중 이미지·메뉴명을
    // 갱신하고 크롤러가 그때마다 파일을 다시 커밋하므로, GitHub Pages 의 캐시 수명(수 분) 동안
    // 낡은 파일이 잡히면 갱신분이 사용자에게 도달하지 않는다.
    res = await fetch('data/moremore-latest.json', { cache: 'no-cache' });
  } catch (err) {
    // 네트워크 오류(경로 1)
    showPreparing();
    return;
  }

  if (!res.ok) {
    // 비2xx 응답(경로 1) — 파일 부재 등
    showPreparing();
    return;
  }

  let json;
  try {
    json = await res.json();
  } catch (err) {
    // JSON 파싱 실패(경로 3에 준함)
    showPreparing();
    return;
  }

  if (!json || typeof json !== 'object' || !isFreshMoremoreData(json.fetchedDate, getKstYyyymmdd())) {
    // 날짜 불일치(경로 4) — Actions 갱신 실패·지연으로 구 데이터가 남아있는 경우 포함
    showPreparing();
    return;
  }

  const { ready, items } = parseMoremoreResponse(json.raw);
  if (!ready || items.length === 0) {
    // 빈 data·파싱 결과 이상(경로 2/3)
    showPreparing();
    return;
  }

  renderItems(items);
}

document.addEventListener('tab:activate', (e) => {
  if (e.detail && e.detail.tab === 2 && !loadedOnce) {
    loadedOnce = true;
    loadMoremore();
  }
});
