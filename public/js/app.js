'use strict';

/* 고객 화면 로직 — 메뉴판 신청 + 생활장터 장보기 + 잔액 확인 + 제출 */

const state = {
  catalog: null,
  member: null,
  balance: null,
  cart: new Map(), // key: `${source}:${refId}` → {source, refId, name, unit, price, pointEarn, qty, category}
};

const won = (n) => `${Number(n || 0).toLocaleString('ko-KR')}원`;
const $ = (id) => document.getElementById(id);
/** 화면에 글자로 넣기 전에 HTML 특수문자를 막는다 */
const esc = (v) => String(v == null ? '' : v)
  .replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { 'Content-Type': 'application/json' },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || '요청을 처리하지 못했습니다.');
  return data;
}

/* ── 초기 로드 ── */
async function init() {
  try {
    state.catalog = await api('/api/catalog');
  } catch (err) {
    document.querySelector('main').insertAdjacentHTML('afterbegin',
      `<div class="alert alert-error">메뉴 정보를 불러오지 못했습니다: ${esc(err.message)}</div>`);
    return;
  }
  $('serviceName').textContent = state.catalog.settings.serviceName;
  renderPackages();
  renderMenu();
  renderMarket();
  renderConsents();
  renderCart();
  bindTabs();
}

function bindTabs() {
  document.querySelectorAll('.tabs button').forEach((btn) => {
    btn.addEventListener('click', () => {
      document.querySelectorAll('.tabs button').forEach((b) => b.setAttribute('aria-selected', String(b === btn)));
      $('tab-care').classList.toggle('hidden', btn.dataset.tab !== 'care');
      $('tab-market').classList.toggle('hidden', btn.dataset.tab !== 'market');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  });
}

/* ── 잔액 확인 ── */
function openLookup() {
  $('lookupCard').scrollIntoView({ behavior: 'smooth', block: 'center' });
  $('lookupName').focus();
}

async function lookupMember() {
  const name = $('lookupName').value.trim();
  const phone = $('lookupPhone').value.trim();
  const box = $('lookupMsg');
  if (!name || !phone) {
    box.innerHTML = '<div class="alert alert-warn">이름과 연락처를 모두 입력해 주세요.</div>';
    return;
  }
  try {
    const data = await api('/api/member/lookup', { method: 'POST', body: { name, phone } });
    if (!data.found) {
      box.innerHTML = `<div class="alert alert-warn">${esc(data.message)}</div>`;
      state.member = null; state.balance = null;
      $('fName').value = name; $('fPhone').value = phone;
      renderBalance();
      return;
    }
    state.member = data.member;
    state.balance = data.balance;
    box.innerHTML = `<div class="alert alert-ok">${esc(data.member.name)} 님, 이번 달 사용 가능 금액은 ${won(data.balance.available)} 입니다.</div>`;
    $('fName').value = data.member.name;
    $('fPhone').value = data.member.phone;
    if (data.member.address) $('fAddress').value = data.member.address;
    if (data.member.birth) $('fBirth').value = data.member.birth;
    renderBalance();
    renderCart();
  } catch (err) {
    box.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
  }
}

function renderBalance() {
  const bar = $('balanceBar');
  if (!state.balance) {
    $('balanceGuest').classList.remove('hidden');
    $('balanceKnown').classList.add('hidden');
    bar.classList.remove('warn', 'over');
    return;
  }
  const b = state.balance;
  const cartTotal = cartTotals().total;
  const remain = b.available - cartTotal;

  $('balanceGuest').classList.add('hidden');
  $('balanceKnown').classList.remove('hidden');
  $('balMemberName').textContent = b.memberName;
  $('balYm').textContent = b.ym.replace('-', '년 ') + '월';
  $('balAvailable').textContent = won(Math.max(0, remain));
  $('balLimit').textContent = won(b.limit + b.carryover);
  $('balUsed').textContent = won(b.used);
  $('balPoints').textContent = `${Number(b.points || 0).toLocaleString('ko-KR')}P`;

  const totalPool = b.limit + b.carryover + b.points;
  const usedRate = totalPool ? Math.min(100, Math.round(((b.used + cartTotal) / totalPool) * 100)) : 0;
  $('balMeter').style.width = `${usedRate}%`;

  bar.classList.toggle('over', remain < 0);
  bar.classList.toggle('warn', remain >= 0 && usedRate >= 80);
}

/* ── 메뉴판 ── */
function renderPackages() {
  const box = $('packages');
  box.innerHTML = state.catalog.packages.map((p) => {
    const total = p.items.reduce((a, i) => a + i.amount, 0);
    const list = p.items.map((i) => `<li>${esc(i.label)} — ${won(i.amount)}${i.budget_only ? ' <span class="muted">(장보기 예산)</span>' : ''}</li>`).join('');
    return `<div class="pkg">
      <h4>${esc(p.name)}</h4>
      <div class="muted">${p.target || ''}</div>
      ${p.items.length ? `<ul>${list}</ul><div class="total">합계 ${won(total)}</div>
        <button class="btn btn-outline btn-sm" style="margin-top:8px" onclick="applyPackage(${p.id})">이 패키지 담기</button>`
        : `<p class="muted" style="margin:8px 0 0">${p.description || ''}</p>`}
    </div>`;
  }).join('');
}

function applyPackage(packageId) {
  const pkg = state.catalog.packages.find((p) => p.id === packageId);
  if (!pkg) return;
  let budgetNote = 0;
  for (const item of pkg.items) {
    if (item.budget_only) { budgetNote += item.amount; continue; }
    if (!item.menu_item_id) continue;
    const menu = findMenu(item.menu_item_id);
    if (!menu) continue;
    addToCart('care', menu, item.qty);
  }
  renderMenu();
  renderCart();
  const msg = budgetNote
    ? `${pkg.name} 구성을 담았습니다. 장보기 예산 ${won(budgetNote)}은(는) "생활장터 장보기" 탭에서 품목을 직접 골라 담아 주세요.`
    : `${pkg.name} 구성을 담았습니다.`;
  $('cartCard').scrollIntoView({ behavior: 'smooth', block: 'start' });
  flash('cartSummary', msg);
}

function findMenu(id) {
  for (const g of state.catalog.categories) {
    const found = g.items.find((i) => i.id === id);
    if (found) return found;
  }
  return null;
}

const CATEGORY_LABEL = {
  '식사돌봄': '1. 식사 돌봄 — "끼니 걱정 없는 마을"',
  '생활지원돌봄': '2. 생활지원 돌봄 — "장보기·집안일 대신 해드립니다"',
  '건강돌봄': '3. 건강 돌봄 — "병원 가는 길, 약 챙기는 일까지"',
  '안전주거돌봄': '4. 안전·주거 돌봄 — "집이 가장 안전한 곳이 되도록"',
  '이동돌봄': '5. 이동 돌봄 — "마을 안에서는 어디든"',
  '정서사회돌봄': '6. 정서·사회 돌봄 — "혼자가 아니라는 것"',
  'AI데이터참여': '7. AI 데이터 참여 — "어르신의 말씀이 곧 자산" (포인트 적립)',
};

function renderMenu() {
  $('menuArea').innerHTML = state.catalog.categories.map((group) => {
    const items = group.items.map((item) => {
      const key = `care:${item.id}`;
      const inCart = state.cart.get(key);
      const priceHtml = item.point_earn > 0
        ? `<div class="price point">적립 +${item.point_earn.toLocaleString('ko-KR')}P</div>`
        : item.price > 0
          ? `<div class="price">${won(item.price)} <span class="muted">/ ${item.unit || ''}</span></div>`
          : `<div class="free">${item.free_label || '무료'}</div>`;
      return `<div class="item ${inCart ? 'picked' : ''}">
        <div class="name">${esc(item.name)}</div>
        <div class="desc">${item.description || ''}</div>
        ${priceHtml}
        <div class="actions">${qtyControl('care', item.id, inCart ? inCart.qty : 0)}</div>
      </div>`;
    }).join('');
    return `<h3 class="cat-title">${CATEGORY_LABEL[group.category] || group.category}</h3>
            <div class="item-grid">${items}</div>`;
  }).join('');
}

function renderMarket() {
  const keyword = ($('marketSearch')?.value || '').trim().toLowerCase();
  const items = state.catalog.priceItems.filter((i) =>
    !keyword || i.name.toLowerCase().includes(keyword) || (i.category || '').toLowerCase().includes(keyword));
  $('marketArea').innerHTML = items.length ? items.map((item) => {
    const inCart = state.cart.get(`market:${item.id}`);
    return `<div class="item ${inCart ? 'picked' : ''}">
      <div class="name">${esc(item.name)}</div>
      <div class="desc">${item.category || ''} · ${item.unit || ''}</div>
      <div class="price">${won(item.sale_price)}</div>
      <div class="actions">${qtyControl('market', item.id, inCart ? inCart.qty : 0)}</div>
    </div>`;
  }).join('') : '<p class="muted">검색 결과가 없습니다.</p>';
}

function qtyControl(source, id, qty) {
  if (!qty) {
    return `<button class="btn btn-outline btn-block" onclick="changeQty('${source}',${id},1)">담기</button>`;
  }
  return `<div class="qty">
      <button onclick="changeQty('${source}',${id},-1)" aria-label="수량 줄이기">−</button>
      <input type="text" value="${qty}" readonly aria-label="수량">
      <button onclick="changeQty('${source}',${id},1)" aria-label="수량 늘리기">＋</button>
    </div>
    <button class="btn btn-ghost btn-sm" onclick="changeQty('${source}',${id},-999)">빼기</button>`;
}

function addToCart(source, item, qty) {
  const key = `${source}:${item.id}`;
  const existing = state.cart.get(key);
  const price = source === 'market' ? item.sale_price : item.price;
  if (existing) {
    existing.qty += qty;
  } else {
    state.cart.set(key, {
      source, refId: item.id, name: item.name, unit: item.unit,
      price, pointEarn: item.point_earn || 0, category: item.category, qty,
    });
  }
}

function changeQty(source, id, delta) {
  const key = `${source}:${id}`;
  const current = state.cart.get(key);
  if (!current) {
    const item = source === 'market'
      ? state.catalog.priceItems.find((i) => i.id === id)
      : findMenu(id);
    if (item && delta > 0) addToCart(source, item, delta);
  } else {
    current.qty += delta;
    if (current.qty <= 0) state.cart.delete(key);
  }
  renderMenu();
  renderMarket();
  renderCart();
}

/* ── 카카오톡 파싱 ── */
async function parseKakao() {
  const text = $('kakaoText').value.trim();
  const box = $('parseResult');
  if (!text) { box.innerHTML = '<div class="alert alert-warn">주문 문장을 붙여넣어 주세요.</div>'; return; }
  try {
    const data = await api('/api/parse', { method: 'POST', body: { text } });
    if (!data.items.length) {
      box.innerHTML = '<div class="alert alert-warn">문장에서 가격표에 있는 품목을 찾지 못했습니다. 아래에서 직접 골라 주세요.</div>';
      return;
    }
    for (const line of data.items) {
      const item = state.catalog.priceItems.find((i) => i.id === line.priceItemId);
      if (item) addToCart('market', item, line.qty);
    }
    renderMarket();
    renderCart();
    const unmatched = data.unmatched.length
      ? `<br><b>찾지 못한 내용:</b> ${esc(data.unmatched.join(', '))} — 직접 골라 담아 주세요.` : '';
    box.innerHTML = `<div class="alert alert-ok">${data.items.length}개 품목을 담았습니다.${unmatched}</div>`;
    if (data.name && !$('fName').value) $('fName').value = data.name;
    if (data.phone && !$('fPhone').value) $('fPhone').value = data.phone;
  } catch (err) {
    box.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
  }
}

/* ── 장바구니 ── */
function cartTotals() {
  let care = 0, market = 0, points = 0;
  for (const line of state.cart.values()) {
    const amount = line.price * line.qty;
    if (line.source === 'market') market += amount; else care += amount;
    points += (line.pointEarn || 0) * line.qty;
  }
  const s = state.catalog?.settings;
  let fee = 0;
  if (s && market > 0 && market < s.smallOrderThreshold) fee = s.smallOrderFee;
  return { care: care + fee, market, fee, total: care + fee + market, points };
}

function renderCart() {
  const lines = [...state.cart.values()];
  const box = $('cartLines');
  if (!lines.length) {
    box.innerHTML = '<p class="muted">아직 담은 항목이 없습니다. 위에서 서비스나 품목을 담아 주세요.</p>';
  } else {
    box.innerHTML = lines.map((l) => `
      <div class="cart-line">
        <span class="tag ${l.source === 'market' ? 'market' : ''}">${l.source === 'market' ? '장보기' : '돌봄'}</span>
        <span class="n">${esc(l.name)}<br><span class="muted">${won(l.price)} × ${l.qty}${l.pointEarn ? ` · 적립 +${(l.pointEarn * l.qty).toLocaleString('ko-KR')}P` : ''}</span></span>
        <b>${won(l.price * l.qty)}</b>
        <button class="btn btn-ghost btn-sm" onclick="changeQty('${l.source}',${l.refId},-999)">삭제</button>
      </div>`).join('');
  }

  const t = cartTotals();
  const parts = [];
  if (t.fee) parts.push(`<div class="cart-line"><span class="n muted">소액주문 취급비 (3만원 미만 주문)</span><b>${won(t.fee)}</b></div>`);
  parts.push(`<div class="cart-total"><span>합계</span><span>${won(t.total)}</span></div>`);
  parts.push(`<div class="muted">돌봄서비스 ${won(t.care)} · 장보기 ${won(t.market)}${t.points ? ` · 예상 적립 +${t.points.toLocaleString('ko-KR')}P` : ''}</div>`);

  if (state.balance) {
    const remain = state.balance.available - t.total;
    parts.push(remain < 0
      ? `<div class="alert alert-error">이번 달 사용 가능 금액을 ${won(-remain)} 초과했습니다. 항목을 줄여 주세요.</div>`
      : `<div class="alert alert-ok">신청 후 남는 금액: ${won(remain)}</div>`);
    $('submitBtn').disabled = remain < 0;
  } else {
    $('submitBtn').disabled = false;
  }

  $('cartSummary').innerHTML = parts.join('');
  $('ctaTotal').textContent = won(t.total);
  renderBalance();
}

function flash(targetId, message) {
  const el = $(targetId);
  el.insertAdjacentHTML('afterbegin', `<div class="alert alert-ok">${esc(message)}</div>`);
}

/* ── 동의 ── */
function renderConsents() {
  $('consentArea').innerHTML = state.catalog.consentItems.map((c) => `
    <label class="consent">
      <input type="checkbox" data-consent="${c.key}" ${c.required ? 'data-required="1"' : ''}>
      <span>${esc(c.label)}</span>
    </label>`).join('') +
    `<button class="btn btn-ghost btn-sm" onclick="checkAllConsents()">모두 동의</button>`;
}

function checkAllConsents() {
  document.querySelectorAll('[data-consent]').forEach((el) => { el.checked = true; });
}

function toggleProxy() {
  $('proxyBox').classList.toggle('hidden', !$('fProxyOn').checked);
}

/* ── 제출 ── */
async function submitOrder() {
  const box = $('submitMsg');
  box.innerHTML = '';
  const items = [...state.cart.values()].map((l) => ({ source: l.source, refId: l.refId, qty: l.qty }));
  if (!items.length) {
    box.innerHTML = '<div class="alert alert-warn">신청하실 서비스나 품목을 한 가지 이상 담아 주세요.</div>';
    $('cartCard').scrollIntoView({ behavior: 'smooth' });
    return;
  }
  const consents = [...document.querySelectorAll('[data-consent]')].map((el) => ({ key: el.dataset.consent, agreed: el.checked }));

  const payload = {
    applicant: {
      name: $('fName').value.trim(),
      phone: $('fPhone').value.trim(),
      birth: $('fBirth').value.trim(),
      address: $('fAddress').value.trim(),
      emergencyPhone: $('fEmergency').value.trim(),
      proxyName: $('fProxyOn').checked ? $('fProxyName').value.trim() : '',
      proxyRelation: $('fProxyOn').checked ? $('fProxyRelation').value.trim() : '',
      proxyPhone: $('fProxyOn').checked ? $('fProxyPhone').value.trim() : '',
    },
    items, consents,
    note: $('fNote').value.trim(),
    channel: '웹',
  };

  $('submitBtn').disabled = true;
  $('submitBtn').textContent = '제출 중…';
  try {
    const data = await api('/api/orders', { method: 'POST', body: payload });
    state.cart.clear();
    state.balance = data.balance;
    renderMenu(); renderMarket(); renderCart();
    box.innerHTML = `<div class="card" style="border-color:var(--green-600)">
        <h3>접수되었습니다</h3>
        <p>담당자가 확인 후 연락드립니다.</p>
        <p style="font-size:1.4rem;font-weight:800">접수번호 <span style="color:var(--green-700)">${esc(data.orderNo)}</span></p>
        <p class="muted">신청 금액 ${won(data.summary.total)} · ${esc(data.payment.note)}</p>
        <p class="muted">이번 달 남은 금액 ${won(data.balance.available)}</p>
      </div>`;
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } catch (err) {
    box.innerHTML = `<div class="alert alert-error">${esc(err.message)}</div>`;
    box.scrollIntoView({ behavior: 'smooth', block: 'center' });
  } finally {
    $('submitBtn').disabled = false;
    $('submitBtn').textContent = '신청서 제출하기';
  }
}

document.addEventListener('DOMContentLoaded', init);
