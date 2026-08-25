// moremore.js — 탭2 모락모락(구내식당 오늘의 메뉴) (ES 모듈)
// 풀무원 모락모락 API를 브라우저에서 직접 fetch(POST)한다. 서버 프록시 없음(constitution 1).
// 3경로(fetch 실패/비2xx·응답 200이나 빈 data·파싱 예외) 전부 동일한 showPreparing()으로 수렴(docs/plan.md, oracle D12).

import { parseMoremoreResponse } from './lib/core.js';

const CONFIG = window.LUNCH_CONFIG || {};

let loadedOnce = false;

function $(id) {
  return document.getElementById(id);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, (ch) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch])
  );
}

// KST(UTC+9) 기준 YYYYMMDD를 매 호출 동적 생성(로컬 브라우저 타임존과 무관하게 정확히 계산).
function getKstYyyymmdd() {
  const now = new Date();
  const utcMs = now.getTime() + now.getTimezoneOffset() * 60000;
  const kst = new Date(utcMs + 9 * 60 * 60000);
  const y = kst.getFullYear();
  const m = String(kst.getMonth() + 1).padStart(2, '0');
  const d = String(kst.getDate()).padStart(2, '0');
  return `${y}${m}${d}`;
}

function buildRequestBody() {
  const requestParam = {
    srchOperCd: CONFIG.MOREMORE_SRCH_OPER_CD || '',
    srchAssignCd: CONFIG.MOREMORE_SRCH_ASSIGN_CD || '',
    srchCurDay: getKstYyyymmdd(),
    srchCurShopclsCd: '',
    custCd: '',
  };
  const params = new URLSearchParams();
  params.set('requestId', 'search_schMenu');
  params.set('requestUrl', '/src/sql/menu/today_sql.php');
  params.set('requestMode', '1');
  params.set('requestParam', JSON.stringify(requestParam));
  return params.toString();
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
      const img = item.imageUrl
        ? `<img src="${escapeHtml(item.imageUrl)}" alt="${escapeHtml(item.nameKo)}" loading="lazy" />`
        : '';
      const nameEn = item.nameEn ? `<p class="mm-name-en">${escapeHtml(item.nameEn)}</p>` : '';
      const kcal = item.kcal !== null ? `<p class="mm-kcal">${escapeHtml(String(item.kcal))} kcal</p>` : '';
      const sides = item.sides.length
        ? `<p class="mm-sides">${escapeHtml(item.sides.join(' / '))}</p>`
        : '';
      return `
        <div class="mm-card">
          ${img}
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
    res = await fetch(CONFIG.MOREMORE_API_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8' },
      body: buildRequestBody(),
    });
  } catch (err) {
    // 네트워크 오류·CORS 차단(경로 1)
    showPreparing();
    return;
  }

  if (!res.ok) {
    // 비2xx 응답(경로 1)
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

  const { ready, items } = parseMoremoreResponse(json);
  if (!ready) {
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
