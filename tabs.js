// tabs.js — 3탭 전환 (ES 모듈, 라우팅 없음: hidden 토글만)
// 탭2/탭3 최초 활성화 시 'tab:activate' CustomEvent를 dispatch해 moremore.js/worldcup.js의
// 최초 1회 로드 트리거로 쓴다(docs/plan.md).

const TAB_COUNT = 3;
const activatedOnce = new Set();

function $(id) {
  return document.getElementById(id);
}

function activateTab(tabNumber) {
  for (let i = 1; i <= TAB_COUNT; i++) {
    const panel = $(`tab${i}-panel`);
    const btn = $(`tab${i}-btn`);
    const isActive = i === tabNumber;
    if (panel) panel.hidden = !isActive;
    if (btn) {
      btn.classList.toggle('active', isActive);
      btn.setAttribute('aria-selected', String(isActive));
    }
  }

  if ((tabNumber === 2 || tabNumber === 3) && !activatedOnce.has(tabNumber)) {
    activatedOnce.add(tabNumber);
    document.dispatchEvent(new CustomEvent('tab:activate', { detail: { tab: tabNumber } }));
  }
}

function bindTabEvents() {
  for (let i = 1; i <= TAB_COUNT; i++) {
    const btn = $(`tab${i}-btn`);
    if (btn) btn.addEventListener('click', () => activateTab(i));
  }
}

document.addEventListener('DOMContentLoaded', () => {
  bindTabEvents();
});
