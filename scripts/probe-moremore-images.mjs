// 임시 진단 스크립트 — 모락모락 이미지 소스 조사 (GitHub Actions 러너에서만 실행 가능)
// 목적 3가지:
//  (1) today_sql.php 응답에서 코너별 이미지 필드 유무 재확인
//  (2) today.php 페이지 HTML에 백반/석식용 이미지 참조·다른 엔드포인트가 있는지
//  (3) 실제 이미지 파일의 픽셀 해상도(가로:세로) 측정 — CSS aspect-ratio 확정용
const API = 'https://puls2.pulmuone.com/src/sql/menu/today_sql.php';
const PAGE = 'https://puls2.pulmuone.com/src/php/menu/today.php';
const OPER = 'O000002', ASSIGN = 'S000758';

function kst() {
  const n = new Date();
  const k = new Date(n.getTime() + n.getTimezoneOffset() * 60000 + 9 * 3600000);
  return `${k.getFullYear()}${String(k.getMonth() + 1).padStart(2, '0')}${String(k.getDate()).padStart(2, '0')}`;
}

const H = {
  'Content-Type': 'application/x-www-form-urlencoded; charset=UTF-8',
  Accept: 'application/json, text/javascript, */*; q=0.01',
  Origin: 'https://puls2.pulmuone.com',
  Referer: PAGE,
  'X-Requested-With': 'XMLHttpRequest',
};

function body(params) {
  const p = new URLSearchParams();
  p.set('requestId', params.requestId);
  p.set('requestUrl', params.requestUrl);
  p.set('requestMode', '1');
  p.set('requestParam', JSON.stringify(params.requestParam));
  return p.toString();
}

// JPEG/PNG 헤더에서 폭·높이 추출(의존성 0)
function imageSize(buf) {
  if (buf[0] === 0x89 && buf[1] === 0x50) {
    return { type: 'png', w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) };
  }
  if (buf[0] === 0xff && buf[1] === 0xd8) {
    let o = 2;
    while (o < buf.length) {
      if (buf[o] !== 0xff) { o++; continue; }
      const m = buf[o + 1];
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) {
        return { type: 'jpeg', h: buf.readUInt16BE(o + 5), w: buf.readUInt16BE(o + 7) };
      }
      o += 2 + buf.readUInt16BE(o + 2);
    }
  }
  return { type: 'unknown', w: null, h: null };
}

const today = kst();
console.log(`### PROBE date(KST)=${today}`);

// (1) today_sql.php
console.log('\n### [1] today_sql.php 코너별 이미지 필드');
let rows = [];
try {
  const res = await fetch(API, { method: 'POST', headers: H, body: body({
    requestId: 'search_schMenu', requestUrl: '/src/sql/menu/today_sql.php',
    requestParam: { srchOperCd: OPER, srchAssignCd: ASSIGN, srchCurDay: today, srchCurShopclsCd: '', custCd: '' },
  }) });
  const j = await res.json();
  console.log('top-level keys:', Object.keys(j).join(', '));
  rows = Array.isArray(j.data) ? j.data : [];
  for (const r of rows) {
    console.log(`  corner=${JSON.stringify(r[6])} name=${JSON.stringify(r[1])} idx3=${JSON.stringify(r[3])} idx4=${JSON.stringify(r[4])} idx13=${JSON.stringify(r[13])} idx14=${JSON.stringify(r[14])} idx15=${JSON.stringify(r[15])} idx16=${JSON.stringify(r[16])}`);
  }
  // data 외 다른 키에 이미지가 숨어있는지
  for (const k of Object.keys(j)) {
    if (k === 'data') continue;
    const s = JSON.stringify(j[k]);
    if (s && s.length < 2000) console.log(`  [${k}] = ${s}`);
    else console.log(`  [${k}] length=${s ? s.length : 0} hasUpload=${/upload\/menu/.test(s || '')}`);
  }
} catch (e) {
  console.log('  ERROR:', e.message);
}

// (2) today.php HTML
console.log('\n### [2] today.php HTML 조사');
try {
  const res = await fetch(PAGE, { headers: { 'User-Agent': 'Mozilla/5.0', Accept: 'text/html' } });
  const html = await res.text();
  console.log('  HTTP', res.status, 'bytes', html.length);
  const uploads = [...new Set((html.match(/[^"'\s]*upload\/menu[^"'\s]*/g) || []))];
  console.log('  upload/menu 참조:', uploads.length);
  uploads.slice(0, 20).forEach((u) => console.log('   -', u));
  const endpoints = [...new Set((html.match(/[\w/.-]*_sql\.php/g) || []))];
  console.log('  *_sql.php 엔드포인트:', JSON.stringify(endpoints));
  const reqIds = [...new Set((html.match(/requestId\s*[:=]\s*["'][^"']+["']/g) || []))];
  console.log('  requestId 후보:', JSON.stringify(reqIds));
  const imgs = [...new Set((html.match(/<img[^>]*>/g) || []))];
  console.log('  <img> 태그:', imgs.length);
  imgs.slice(0, 15).forEach((t) => console.log('   -', t.slice(0, 200)));
  const noimg = [...new Set((html.match(/[^"'\s]*(no_?img|noimage|default|dummy)[^"'\s]*/gi) || []))];
  console.log('  no-image 플레이스홀더 후보:', JSON.stringify(noimg.slice(0, 10)));
  // 외부 스크립트 목록(이미지 로직이 별도 js에 있을 수 있음)
  const scripts = [...new Set((html.match(/<script[^>]+src=["'][^"']+["']/g) || []))];
  console.log('  외부 script:', JSON.stringify(scripts.slice(0, 15)));
} catch (e) {
  console.log('  ERROR:', e.message);
}

// (3) 실제 이미지 해상도
console.log('\n### [3] 이미지 실제 해상도');
const urls = [];
for (const r of rows) {
  if (typeof r[3] === 'string' && r[3] && typeof r[4] === 'string' && r[4]) urls.push({ label: `${r[6]} 원본`, url: r[3] + r[4] });
  if (typeof r[3] === 'string' && r[3] && typeof r[13] === 'string' && r[13]) urls.push({ label: `${r[6]} 썸네일`, url: r[3] + r[13] });
}
if (!urls.length) console.log('  (오늘 이미지 있는 행 없음)');
for (const { label, url } of urls) {
  try {
    const res = await fetch(url, { headers: { Referer: PAGE, 'User-Agent': 'Mozilla/5.0' } });
    const buf = Buffer.from(await res.arrayBuffer());
    const sz = imageSize(buf);
    const ratio = sz.w && sz.h ? (sz.w / sz.h).toFixed(4) : 'n/a';
    console.log(`  ${label}: HTTP ${res.status} ${res.headers.get('content-type')} ${buf.length}B ${sz.type} ${sz.w}x${sz.h} ratio=${ratio}`);
  } catch (e) {
    console.log(`  ${label}: ERROR ${e.message}`);
  }
}
console.log('\n### PROBE END');
