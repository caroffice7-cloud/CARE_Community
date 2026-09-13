/* =========================================================================
   BMC 통합돌봄 메뉴판 — 화면 구성 및 신청 처리
   ========================================================================= */
(function () {
  'use strict';

  var CFG    = window.BMC_CONFIG;
  var MENU   = window.BMC_MENU;
  var POINTS = window.BMC_POINTS;
  var PKGS   = window.BMC_PACKAGES;
  var LIMIT  = CFG.budget.monthlyLimit;

  var CART_KEY = 'bmc.cart.v1';
  var FORM_KEY = 'bmc.form.v1';
  var APPS_KEY = 'bmc.applications.v1';
  var SEED_KEY = 'bmc.seeded.v1';

  /* 분류별 막대 색 — 녹차 잎빛에서 옅어지는 순서 */
  var CAT_COLOR = {
    meal: '#1F6B4A', life: '#2E8560', health: '#479E78',
    safety: '#6BB596', move: '#93CBB3', emotion: '#BFE0D0'
  };

  /* ---------------------------------------------------------- 자료 색인 */
  var INDEX = {};
  MENU.forEach(function (c) {
    c.items.forEach(function (it) { INDEX[it.id] = Object.assign({ cat: c.id, catTitle: c.title }, it); });
  });
  POINTS.items.forEach(function (it) {
    INDEX[it.id] = Object.assign({ cat: 'data', catTitle: POINTS.title, price: 0, kind: 'point' }, it);
  });

  /* ------------------------------------------------------------ 저장소 */
  function load(key, fallback) {
    try { var v = localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) { /* 저장 불가 환경은 조용히 넘어갑니다 */ }
  }

  var cart = load(CART_KEY, null);
  var seeded = false;
  if (!cart) {
    cart = {};
    if (!load(SEED_KEY, false)) { applyPackage(PKGS[0], true); seeded = true; save(SEED_KEY, true); }
  }

  /* ------------------------------------------------------------ 계산기 */
  function won(n) { return Number(n || 0).toLocaleString('ko-KR') + '원'; }
  function esc(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
  }
  function lineTotal(item, entry) {
    if (!item || !entry) return 0;
    if (item.kind === 'point') return 0;
    if (item.kind === 'free') return 0;
    if (item.kind === 'variable') return Number(entry.amount || 0);
    return item.price * (entry.qty || 0);
  }
  function totals() {
    var used = 0, pts = 0, byCat = {};
    Object.keys(cart).forEach(function (id) {
      var item = INDEX[id]; if (!item) return;
      if (item.kind === 'point') { pts += item.point * (cart[id].qty || 0); return; }
      var t = lineTotal(item, cart[id]);
      used += t;
      byCat[item.cat] = (byCat[item.cat] || 0) + t;
    });
    var available = LIMIT + pts;
    return { used: used, points: pts, available: available, remaining: available - used, over: Math.max(0, used - available), byCat: byCat };
  }

  /* ------------------------------------------------------- 담기 / 빼기 */
  function entryOf(id) { return cart[id]; }
  function addItem(id, qty, amount) {
    var item = INDEX[id]; if (!item) return;
    var e = cart[id] || { qty: 0 };
    if (item.kind === 'monthly' || item.kind === 'free' || item.kind === 'variable') e.qty = 1;
    else e.qty = Math.min(99, (e.qty || 0) + (qty || 1));
    if (item.kind === 'variable') e.amount = amount != null ? amount : (e.amount != null ? e.amount : item.price);
    cart[id] = e;
  }
  function setQty(id, qty) {
    if (qty <= 0) { delete cart[id]; return; }
    var e = cart[id] || {}; e.qty = Math.min(99, qty); cart[id] = e;
  }
  function applyPackage(pkg, silent) {
    pkg.lines.forEach(function (ln) {
      var item = INDEX[ln.itemId]; if (!item) return;
      cart[ln.itemId] = item.kind === 'variable'
        ? { qty: 1, amount: ln.amount != null ? ln.amount : item.price }
        : { qty: ln.qty || 1 };
    });
    if (!silent) { persist(); renderAll(); flash('“' + pkg.name + '” 구성을 담았습니다.'); }
  }
  function pkgTotal(pkg) {
    return pkg.lines.reduce(function (s, ln) {
      var item = INDEX[ln.itemId]; if (!item) return s;
      return s + (item.kind === 'variable' ? (ln.amount || item.price) : item.price * (ln.qty || 1));
    }, 0);
  }
  function persist() { save(CART_KEY, cart); }

  /* ------------------------------------------------------------ 메뉴 그리기 */
  function dishHTML(item, isPoint) {
    var e = entryOf(item.id);
    var picked = !!e;
    var priceMain, priceUnit = item.unit;

    if (isPoint) priceMain = '+' + Number(item.point).toLocaleString('ko-KR') + 'P';
    else if (item.kind === 'free') priceMain = item.priceLabel || '무료';
    else if (item.kind === 'variable') priceMain = item.priceLabel || won(item.price);
    else priceMain = won(item.price);

    var tags = '';
    if (item.badge) tags += '<span class="tag">' + esc(item.badge) + '</span>';
    if (item.tech) tags += '<span class="tag">' + esc(item.tech) + '</span>';
    if (item.kind === 'monthly') tags += '<span class="tag">월정액</span>';

    var action;
    if (!picked) {
      action = '<button class="add" data-add="' + item.id + '">담기</button>';
    } else if (item.kind === 'monthly' || item.kind === 'free') {
      action = '<button class="ghost" data-del="' + item.id + '">담김 · 빼기</button>';
    } else if (item.kind === 'variable') {
      action = '<label class="vis-label" for="amt-' + item.id + '" style="font-size:.8em;color:var(--ink-3)">월 예상 금액</label>' +
               '<input class="amt num" id="amt-' + item.id + '" type="number" min="0" step="1000" value="' + Number(e.amount || 0) + '" data-amt="' + item.id + '" aria-label="월 예상 금액(원)">' +
               '<button class="ghost" data-del="' + item.id + '">빼기</button>';
    } else {
      action = '<div class="stepper">' +
               '<button type="button" data-minus="' + item.id + '" aria-label="수량 줄이기">−</button>' +
               '<span class="qty num">' + e.qty + '</span>' +
               '<button type="button" data-plus="' + item.id + '" aria-label="수량 늘리기">＋</button>' +
               '</div><button class="ghost" data-del="' + item.id + '">빼기</button>';
    }

    return '<div class="dish' + (picked ? ' picked' : '') + '" id="dish-' + item.id + '">' +
      '<div class="dish-main"><span class="dish-name">' + esc(item.name) + '</span>' + tags + '<span class="leader" aria-hidden="true"></span></div>' +
      '<p class="dish-desc">' + esc(item.desc) + '</p>' +
      '<div class="dish-price"><b>' + esc(priceMain) + '</b><span class="unit">' + esc(priceUnit) + '</span></div>' +
      '<div class="dish-action">' + action + '</div>' +
      '</div>';
  }

  function renderMenu() {
    var html = MENU.map(function (c) {
      return '<section class="course" id="cat-' + c.id + '">' +
        '<div class="course-head"><span class="course-no num">' + c.no + '</span><h2>' + esc(c.title) + '</h2>' +
        '<span class="tagline">“' + esc(c.tagline) + '”</span></div>' +
        (c.note ? '<p class="course-note">' + esc(c.note) + '</p>' : '') +
        c.items.map(function (it) { return dishHTML(it, false); }).join('') +
        '</section>';
    }).join('');

    html += '<section class="course data-course" id="cat-data">' +
      '<div class="course-head"><span class="course-no num">' + POINTS.no + '</span><h2>' + esc(POINTS.title) + '</h2>' +
      '<span class="tagline">“' + esc(POINTS.tagline) + '”</span></div>' +
      '<p class="data-intro">' + esc(POINTS.intro) + '</p>' +
      POINTS.items.map(function (it) { return dishHTML(it, true); }).join('') +
      '<p class="steps-foot">' + esc(POINTS.footnote) + '</p>' +
      '</section>';

    document.getElementById('menu').innerHTML = html;
  }

  function renderCatbar() {
    var links = MENU.map(function (c) { return '<a href="#cat-' + c.id + '">' + c.no + '. ' + esc(c.title) + '</a>'; });
    links.push('<a href="#cat-data">' + POINTS.no + '. ' + esc(POINTS.title) + '</a>');
    links.push('<a href="#packages">추천 패키지</a>');
    document.getElementById('catbar').innerHTML = links.join('');
  }

  function renderPackages() {
    var html = PKGS.map(function (p) {
      var lines = p.lines.map(function (ln) {
        var item = INDEX[ln.itemId];
        var amt = item.kind === 'variable' ? (ln.amount || item.price) : item.price * (ln.qty || 1);
        return '<li><span>' + esc(item.name) + '</span><span class="l" aria-hidden="true"></span>' +
               '<span class="v">' + won(amt) + '</span></li>';
      }).join('');
      return '<article class="pkg">' +
        '<div class="pkg-top"><span class="pkg-label">' + p.label + '</span><h3>' + esc(p.name) + '</h3></div>' +
        '<p class="who">' + esc(p.who) + '</p>' +
        '<ul>' + lines + '</ul>' +
        '<div class="pkg-sum"><span>월 합계</span><b class="num">' + won(pkgTotal(p)) + '</b></div>' +
        '<button class="add" data-pkg="' + p.id + '">이대로 담기</button>' +
        '</article>';
    }).join('');

    html += '<article class="pkg free">' +
      '<div class="pkg-top"><span class="pkg-label">④</span><h3>자유 선택형</h3></div>' +
      '<p class="who">직접 골라 담고 싶은 어르신·가족</p>' +
      '<p style="font-size:.88em;color:var(--ink-2);margin:0">월 20만원 한도 안에서 1~7번 메뉴를 자유롭게 조합합니다. ' +
      '돌봄매니저가 방문 상담 후 어르신 상태에 맞춰 구성해 드립니다. ' +
      'AI 데이터 참여 포인트를 적립하시면 실제 이용 가능 금액은 20만원을 넘길 수 있습니다.</p>' +
      '<div class="pkg-sum"><span>한도</span><b class="num">' + won(LIMIT) + ' +α</b></div>' +
      '<button class="add" data-clear="1">비우고 직접 고르기</button>' +
      '</article>';

    document.getElementById('packages-grid').innerHTML = html;
  }

  /* ------------------------------------------------- 내 돌봄 구성 패널 */
  function cartRows() {
    return Object.keys(cart).map(function (id) {
      var item = INDEX[id]; if (!item) return null;
      return { id: id, item: item, entry: cart[id], total: lineTotal(item, cart[id]) };
    }).filter(Boolean).sort(function (a, b) {
      if (a.item.cat === b.item.cat) return 0;
      return a.item.cat === 'data' ? 1 : (b.item.cat === 'data' ? -1 : 0);
    });
  }

  function renderPanel() {
    var t = totals();
    var rows = cartRows();

    /* 예산 막대 — 분류별로 색을 나눠 어디에 얼마를 쓰는지 한눈에 */
    var segs = MENU.map(function (c) {
      var v = t.byCat[c.id] || 0; if (!v) return '';
      var pct = Math.min(100, v / t.available * 100);
      return '<div class="meter-seg" style="width:' + pct + '%;background:' + CAT_COLOR[c.id] + '" title="' + esc(c.title) + ' ' + won(v) + '"></div>';
    }).join('');
    document.getElementById('meter-bar').innerHTML = segs;
    document.getElementById('meter-bar').classList.toggle('over', t.over > 0);

    document.getElementById('used').textContent = won(t.used);
    var leftEl = document.getElementById('left');
    leftEl.classList.toggle('over', t.over > 0);
    leftEl.innerHTML = t.over > 0
      ? '한도 초과<span class="num">' + won(t.over) + '</span>'
      : '남은 금액<span class="num">' + won(t.remaining) + '</span>';

    document.getElementById('avail-note').textContent = t.points > 0
      ? '지역화폐 ' + won(LIMIT) + ' + 적립포인트 ' + Number(t.points).toLocaleString('ko-KR') + 'P = 사용 가능 ' + won(t.available)
      : '보성군 기본소득 지역화폐 월 한도 ' + won(LIMIT);

    var list = document.getElementById('cart-list');
    if (!rows.length) {
      list.innerHTML = '<li class="cart-empty">아직 담은 서비스가 없습니다.<br>왼쪽 메뉴에서 필요한 돌봄을 담아 보세요.</li>';
    } else {
      list.innerHTML = rows.map(function (r) {
        var qtyText = r.item.kind === 'point' ? r.entry.qty + '회'
          : r.item.kind === 'monthly' ? '월정액'
          : r.item.kind === 'variable' ? '예상금액'
          : r.item.kind === 'free' ? '무료'
          : r.entry.qty + ' × ' + won(r.item.price);
        var valText = r.item.kind === 'point'
          ? '<span class="cv pt">+' + (r.item.point * r.entry.qty).toLocaleString('ko-KR') + 'P</span>'
          : '<span class="cv">' + won(r.total) + '</span>';
        return '<li><span class="cn">' + esc(r.item.name) + '<br><span class="cq">' + esc(qtyText) + '</span></span>' +
          valText + '<button class="cx" data-del="' + r.id + '" aria-label="' + esc(r.item.name) + ' 빼기">✕</button></li>';
      }).join('');
    }

    var warn = document.getElementById('overwarn');
    warn.hidden = t.over <= 0;
    if (t.over > 0) warn.textContent = '월 한도를 ' + won(t.over) + ' 넘었습니다. 이대로 신청하시면 초과분은 자부담이거나, 상담 때 함께 조정합니다.';

    document.getElementById('cta-apply').disabled = rows.length === 0;
    document.getElementById('dock-used').textContent = won(t.used);
    var ds = document.getElementById('dock-sub');
    ds.classList.toggle('over', t.over > 0);
    ds.textContent = t.over > 0 ? '한도 ' + won(t.over) + ' 초과' : '남은 금액 ' + won(t.remaining);

    var note = document.getElementById('seed-note');
    if (note) note.hidden = !seeded || rows.length === 0;
  }

  function renderReview() {
    var rows = cartRows();
    var t = totals();
    var body = rows.map(function (r) {
      var q = r.item.kind === 'point' ? r.entry.qty + '회'
        : r.item.kind === 'monthly' ? '월 1'
        : r.item.kind === 'variable' ? '주문 시'
        : r.item.kind === 'free' ? '-' : r.entry.qty;
      var v = r.item.kind === 'point'
        ? '+' + (r.item.point * r.entry.qty).toLocaleString('ko-KR') + 'P'
        : won(r.total);
      return '<tr><td>' + esc(r.item.name) + '<br><span style="color:var(--ink-3);font-size:.82em">' + esc(r.item.catTitle) + ' · ' + esc(r.item.unit) + '</span></td>' +
             '<td class="n">' + esc(String(q)) + '</td><td class="n">' + v + '</td></tr>';
    }).join('');

    document.getElementById('review-body').innerHTML = body ||
      '<tr><td colspan="3" style="color:var(--ink-3);padding:16px 0">담은 서비스가 없습니다. 위 메뉴에서 먼저 골라 주세요.</td></tr>';
    document.getElementById('review-total').textContent = won(t.used);
    document.getElementById('review-left').textContent = t.over > 0 ? '한도 초과 ' + won(t.over) : '남은 금액 ' + won(t.remaining);
    document.getElementById('review-point').textContent = t.points > 0 ? '적립 예정 ' + t.points.toLocaleString('ko-KR') + 'P' : '적립 없음';
  }

  function renderAll() { renderMenu(); renderPanel(); renderReview(); }

  /* --------------------------------------------------------- 안내 문구 */
  var flashTimer;
  function flash(msg) {
    var el = document.getElementById('flash');
    el.textContent = msg;
    el.hidden = false;
    clearTimeout(flashTimer);
    flashTimer = setTimeout(function () { el.hidden = true; }, 2600);
  }

  /* ------------------------------------------------------------ 조작 */
  document.addEventListener('click', function (ev) {
    var el = ev.target.closest('[data-add],[data-plus],[data-minus],[data-del],[data-pkg],[data-clear]');
    if (!el) return;

    if (el.dataset.pkg) {
      var pkg = PKGS.filter(function (p) { return p.id === el.dataset.pkg; })[0];
      if (pkg) { cart = {}; applyPackage(pkg); }
      return;
    }
    if (el.dataset.clear) {
      cart = {}; persist(); renderAll(); flash('구성을 비웠습니다. 필요한 메뉴를 담아 보세요.');
      document.getElementById('cat-meal').scrollIntoView({ block: 'start' });
      return;
    }

    var id = el.dataset.add || el.dataset.plus || el.dataset.minus || el.dataset.del;
    if (el.dataset.add) { addItem(id, 1); flash('“' + INDEX[id].name + '” 담았습니다.'); }
    else if (el.dataset.plus) { setQty(id, (cart[id] ? cart[id].qty : 0) + 1); }
    else if (el.dataset.minus) { setQty(id, (cart[id] ? cart[id].qty : 0) - 1); }
    else if (el.dataset.del) { delete cart[id]; }

    seeded = false;
    persist();
    renderAll();
  });

  document.addEventListener('change', function (ev) {
    var el = ev.target;
    if (el.dataset && el.dataset.amt) {
      var id = el.dataset.amt;
      if (!cart[id]) cart[id] = { qty: 1 };
      cart[id].amount = Math.max(0, Number(el.value) || 0);
      persist();
      renderPanel(); renderReview();
    }
  });

  /* 큰 글씨 / 밝기 */
  var sizeBtn = document.getElementById('btn-size');
  sizeBtn.addEventListener('click', function () {
    var big = document.documentElement.getAttribute('data-size') === 'big';
    document.documentElement.setAttribute('data-size', big ? '' : 'big');
    sizeBtn.setAttribute('aria-pressed', String(!big));
    save('bmc.size', big ? '' : 'big');
  });
  if (load('bmc.size', '') === 'big') {
    document.documentElement.setAttribute('data-size', 'big');
    sizeBtn.setAttribute('aria-pressed', 'true');
  }

  document.getElementById('btn-print').addEventListener('click', function () { window.print(); });

  document.getElementById('seed-clear').addEventListener('click', function () {
    cart = {}; seeded = false; persist(); renderAll();
  });

  /* ------------------------------------------------------------ 신청서 */
  var form = document.getElementById('apply-form');

  /* 입력하던 내용을 잃지 않도록 저장 */
  var draft = load(FORM_KEY, null);
  if (draft) {
    Object.keys(draft).forEach(function (k) {
      var f = form.elements[k];
      if (!f) return;
      if (f.type === 'checkbox') f.checked = !!draft[k];
      else if (f.length && f[0] && f[0].type === 'radio') {
        Array.prototype.forEach.call(f, function (r) { r.checked = (r.value === draft[k]); });
      } else f.value = draft[k];
    });
  }
  form.addEventListener('input', function () { save(FORM_KEY, readForm()); });

  function readForm() {
    var d = {};
    Array.prototype.forEach.call(form.elements, function (f) {
      if (!f.name) return;
      if (f.type === 'checkbox') d[f.name] = f.checked;
      else if (f.type === 'radio') { if (f.checked) d[f.name] = f.value; }
      else d[f.name] = f.value.trim();
    });
    return d;
  }

  function makeNo() {
    var d = new Date();
    var p = function (n) { return String(n).padStart(2, '0'); };
    var rand = String(Math.floor(Math.random() * 9000) + 1000);
    return 'BMC-' + String(d.getFullYear()).slice(2) + p(d.getMonth() + 1) + p(d.getDate()) + '-' + rand;
  }

  function buildPayload(no) {
    var d = readForm();
    var t = totals();
    var services = cartRows().filter(function (r) { return r.item.kind !== 'point'; }).map(function (r) {
      return { id: r.id, name: r.item.name, category: r.item.catTitle, unit: r.item.unit, qty: r.entry.qty || 1, amount: r.total };
    });
    var dataItems = cartRows().filter(function (r) { return r.item.kind === 'point'; }).map(function (r) {
      return { id: r.id, name: r.item.name, qty: r.entry.qty || 1, point: r.item.point * (r.entry.qty || 1) };
    });
    return {
      no: no,
      submittedAt: new Date().toISOString(),
      applicant: d,
      services: services,
      dataParticipation: dataItems,
      totals: { used: t.used, points: t.points, available: t.available, remaining: t.remaining, over: t.over },
      source: location.href
    };
  }

  function receiptText(p) {
    var a = p.applicant;
    var L = [];
    L.push('[BMC 통합돌봄 서비스 신청서]');
    L.push('접수번호  ' + p.no);
    L.push('작성일시  ' + new Date(p.submittedAt).toLocaleString('ko-KR'));
    L.push('');
    L.push('■ 어르신');
    L.push('  성함      ' + (a.name || ''));
    L.push('  생년      ' + (a.birthYear || '') + (a.gender ? ' / ' + a.gender : ''));
    L.push('  연락처    ' + (a.phone || ''));
    L.push('  주소      ' + (a.town || '') + ' ' + (a.address || ''));
    L.push('  거주형태  ' + (a.living || '') + ' / 거동 ' + (a.mobility || ''));
    L.push('');
    L.push('■ 보호자');
    L.push('  성함      ' + (a.guardianName || '-') + (a.guardianRelation ? ' (' + a.guardianRelation + ')' : ''));
    L.push('  연락처    ' + (a.guardianPhone || '-'));
    L.push('');
    L.push('■ 신청 서비스');
    p.services.forEach(function (s) {
      L.push('  · ' + s.name + '  ' + s.qty + s.unit.replace(/^[0-9]+/, '') + '  ' + Number(s.amount).toLocaleString('ko-KR') + '원');
    });
    if (p.dataParticipation.length) {
      L.push('');
      L.push('■ AI 데이터 참여 (포인트 적립)');
      p.dataParticipation.forEach(function (s) { L.push('  · ' + s.name + '  ' + s.qty + '회  +' + s.point.toLocaleString('ko-KR') + 'P'); });
    }
    L.push('');
    L.push('■ 금액');
    L.push('  월 합계      ' + Number(p.totals.used).toLocaleString('ko-KR') + '원');
    L.push('  적립 포인트  ' + Number(p.totals.points).toLocaleString('ko-KR') + 'P');
    L.push('  사용 가능    ' + Number(p.totals.available).toLocaleString('ko-KR') + '원');
    L.push(p.totals.over > 0
      ? '  한도 초과    ' + Number(p.totals.over).toLocaleString('ko-KR') + '원 (상담 시 조정)'
      : '  남은 금액    ' + Number(p.totals.remaining).toLocaleString('ko-KR') + '원');
    L.push('');
    L.push('■ 상담 희망  ' + (a.visitDate || '협의') + ' ' + (a.visitTime || ''));
    L.push('■ 지역화폐 카드  ' + (a.card || '-'));
    if (a.memo) { L.push('■ 특이사항'); L.push('  ' + a.memo); }
    L.push('');
    L.push('개인정보 수집·이용 동의: ' + (a.agreePrivacy ? '동의' : '미동의'));
    L.push('AI 데이터 참여 동의: ' + (a.agreeData ? '동의' : '미동의(선택)'));
    L.push('');
    L.push('※ 접수 후 담당 돌봄매니저가 전화드려 방문 상담 일정을 잡습니다.');
    return L.join('\n');
  }

  function saveLocally(p) {
    var list = load(APPS_KEY, []);
    list.unshift(p);
    save(APPS_KEY, list.slice(0, 200));
  }

  function showDone(p, delivered) {
    var box = document.getElementById('done');
    var text = receiptText(p);
    var head = delivered
      ? '신청이 접수되었습니다.'
      : '신청서가 작성되었습니다.';
    var sub = delivered
      ? '담당 돌봄매니저가 1~2일 안에 전화드려 방문 상담 일정을 잡습니다.'
      : '아래 [문자로 보내기] 또는 [전화 걸기]로 접수를 완료해 주세요. 작성한 내용은 이 기기에 저장되어 있습니다.';

    var tel = (CFG.contact.tel || '').replace(/[^0-9+]/g, '');
    var smsTo = (CFG.contact.smsTo || '').replace(/[^0-9+]/g, '');
    var acts = '';
    if (smsTo) acts += '<a class="solid" href="sms:' + smsTo + '?body=' + encodeURIComponent(text) + '">문자로 보내기</a>';
    if (tel) acts += '<a href="tel:' + tel + '">전화 걸기 ' + esc(CFG.contact.tel) + '</a>';
    if (CFG.contact.kakaoUrl) acts += '<a href="' + esc(CFG.contact.kakaoUrl) + '" target="_blank" rel="noopener">카카오톡 문의</a>';
    acts += '<button type="button" id="btn-copy">신청서 복사</button>';
    acts += '<button type="button" id="btn-print2">인쇄 · PDF 저장</button>';

    box.innerHTML = '<div class="no">' + esc(p.no) + '</div>' +
      '<h3>' + head + '</h3><p>' + sub + '</p>' +
      '<div class="done-acts">' + acts + '</div>' +
      '<pre class="receipt">' + esc(text) + '</pre>';
    box.hidden = false;

    document.getElementById('btn-copy').addEventListener('click', function () {
      var done = function () { flash('신청서를 복사했습니다. 카카오톡이나 문자에 붙여넣어 보내실 수 있습니다.'); };
      if (navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(text).then(done, fallbackCopy);
      else fallbackCopy();
      function fallbackCopy() {
        var ta = document.createElement('textarea');
        ta.value = text; document.body.appendChild(ta); ta.select();
        try { document.execCommand('copy'); done(); } catch (e) { flash('복사가 되지 않습니다. 아래 내용을 길게 눌러 복사해 주세요.'); }
        document.body.removeChild(ta);
      }
    });
    document.getElementById('btn-print2').addEventListener('click', function () { window.print(); });
    box.scrollIntoView({ block: 'start' });
  }

  form.addEventListener('submit', function (ev) {
    ev.preventDefault();
    var msg = document.getElementById('form-msg');
    msg.className = 'form-msg';
    msg.textContent = '';

    if (!cartRows().length) {
      msg.className = 'form-msg err';
      msg.textContent = '먼저 위 메뉴에서 필요한 서비스를 담아 주세요.';
      document.getElementById('cat-meal').scrollIntoView({ block: 'start' });
      return;
    }
    if (!form.reportValidity()) return;

    var btn = document.getElementById('btn-submit');
    btn.disabled = true;
    btn.textContent = '접수 중…';

    var p = buildPayload(makeNo());
    saveLocally(p);

    var finish = function (delivered) {
      btn.disabled = false;
      btn.textContent = '신청서 제출하기';
      showDone(p, delivered);
      try { localStorage.removeItem(FORM_KEY); } catch (e) {}
    };

    if (CFG.endpoint) {
      fetch(CFG.endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'text/plain;charset=utf-8' }, /* 사전요청 없이 보내기 위함 */
        body: JSON.stringify(p)
      }).then(function (r) { return r.ok ? r.text() : Promise.reject(new Error(String(r.status))); })
        .then(function () { finish(true); })
        .catch(function () {
          msg.className = 'form-msg err';
          msg.textContent = '접수 서버에 연결하지 못했습니다. 아래 방법으로 접수를 완료해 주세요.';
          finish(false);
        });
    } else {
      finish(false);
    }
  });

  document.getElementById('cta-apply').addEventListener('click', goApply);
  document.getElementById('dock-apply').addEventListener('click', goApply);
  function goApply() {
    renderReview();
    document.getElementById('apply').scrollIntoView({ block: 'start' });
    var first = form.querySelector('input[name="name"]');
    if (first) setTimeout(function () { first.focus({ preventScroll: true }); }, 350);
  }

  /* ------------------------------------------------------- 정적 부분 */
  document.getElementById('steps').innerHTML = window.BMC_STEPS.map(function (s) {
    return '<div class="step"><div class="k">' + esc(s.n) + '</div><h3>' + esc(s.t) + '</h3><p>' + esc(s.d) + '</p></div>';
  }).join('');

  document.getElementById('ops-table').innerHTML = window.BMC_OPS.map(function (r) {
    return '<tr><th scope="row">' + esc(r[0]) + '</th><td>' + esc(r[1]) + '</td></tr>';
  }).join('');

  document.getElementById('tel-link').textContent = CFG.contact.tel;
  document.getElementById('tel-link').href = 'tel:' + CFG.contact.tel.replace(/[^0-9+]/g, '');
  var tel2 = document.getElementById('tel-link2');
  if (tel2) { tel2.textContent = CFG.contact.tel; tel2.href = 'tel:' + CFG.contact.tel.replace(/[^0-9+]/g, ''); }
  document.getElementById('doc-ver').textContent = CFG.org.updatedAt + ' · ' + CFG.org.version;
  document.getElementById('limit-chip').textContent = '월 ' + won(LIMIT) + ' 지역화폐 결제';

  renderCatbar();
  renderPackages();
  renderAll();
})();
