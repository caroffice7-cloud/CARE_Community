'use strict';

/** 운영자(관리자) 화면 API — 1차 프로토타입의 관리 기능을 서버 기반으로 계승 */

const { get, all, run, tx, setting, setSetting } = require('../db');
const { Router, readJson, sendJson, sendCsv, HttpError } = require('../lib/http');
const auth = require('../lib/auth');
const balance = require('../lib/balance');
const { parseOrderText } = require('../lib/parser');
const { toCsv } = require('../lib/csv');
const { normalizePhone, nextOrderNo, resolveItems, consentItems } = require('./public');

const router = new Router();
const STATUSES = ['접수', '결제대기', '결제완료', '처리중', '완료', '취소'];

// ---- 인증 ----
router.post('/api/admin/login', async (req, res) => {
  const body = await readJson(req);
  auth.login(res, body.password, req);
  sendJson(res, 200, { ok: true });
});

router.post('/api/admin/logout', (req, res) => {
  auth.logout(req, res);
  sendJson(res, 200, { ok: true });
});

router.get('/api/admin/me', (req, res) => {
  sendJson(res, 200, { authenticated: !!auth.currentSession(req) });
});

// ---- 접수 현황판 ----
router.get('/api/admin/orders', (req, res, ctx) => {
  auth.requireAdmin(req);
  const q = ctx.query;
  const where = [];
  const params = [];

  if (q.get('status')) { where.push('o.status = ?'); params.push(q.get('status')); }
  if (q.get('type')) { where.push('o.type = ?'); params.push(q.get('type')); }
  if (q.get('ym')) { where.push('o.ym = ?'); params.push(q.get('ym')); }
  if (q.get('memberId')) { where.push('o.member_id = ?'); params.push(Number(q.get('memberId'))); }
  if (q.get('q')) {
    where.push('(o.applicant_name LIKE ? OR o.applicant_phone LIKE ? OR o.order_no LIKE ?)');
    const like = `%${q.get('q')}%`;
    params.push(like, like, like);
  }
  const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const limit = Math.min(200, Number(q.get('limit') || 50));
  const offset = Math.max(0, Number(q.get('offset') || 0));

  const rows = all(
    `SELECT o.*, m.name AS member_name
     FROM orders o LEFT JOIN members m ON m.id = o.member_id
     ${whereSql} ORDER BY o.id DESC LIMIT ? OFFSET ?`,
    ...params, limit, offset
  );
  const total = get(`SELECT COUNT(*) AS c FROM orders o ${whereSql}`, ...params).c;

  sendJson(res, 200, {
    total, limit, offset, statuses: STATUSES,
    counts: Object.fromEntries(STATUSES.map((s) => [s, get('SELECT COUNT(*) AS c FROM orders WHERE status = ?', s).c])),
    orders: rows,
  });
});

router.get('/api/admin/orders/:id', (req, res, ctx) => {
  auth.requireAdmin(req);
  const order = get('SELECT * FROM orders WHERE id = ?', Number(ctx.params.id));
  if (!order) throw new HttpError(404, '주문을 찾을 수 없습니다.');
  sendJson(res, 200, {
    order,
    items: all('SELECT * FROM order_items WHERE order_id = ? ORDER BY id', order.id),
    consents: all('SELECT * FROM consents WHERE order_id = ? ORDER BY id', order.id),
    payment: get('SELECT * FROM payment_requests WHERE order_id = ? ORDER BY id DESC', order.id),
    logs: all('SELECT * FROM order_logs WHERE order_id = ? ORDER BY id', order.id),
    balance: order.member_id ? balance.summary(order.member_id, order.ym) : null,
  });
});

router.patch('/api/admin/orders/:id/status', async (req, res, ctx) => {
  auth.requireAdmin(req);
  const body = await readJson(req);
  const status = String(body.status || '');
  if (!STATUSES.includes(status)) throw new HttpError(400, `상태값이 올바르지 않습니다. (${STATUSES.join(', ')})`);

  const order = get('SELECT * FROM orders WHERE id = ?', Number(ctx.params.id));
  if (!order) throw new HttpError(404, '주문을 찾을 수 없습니다.');
  if (order.status === status) return sendJson(res, 200, { ok: true, unchanged: true });

  // 취소 위약금: 운영 기준상 서비스 24시간 전 취소는 전액 환불, 당일 취소는 50% 부과.
  // 서비스 예정일은 현장에서 정해지므로 취소 처리 시 담당자가 유형을 고른다.
  const refundType = status === '취소' ? (body.refundType === '당일취소' ? '당일취소' : '전액환불') : null;
  const cancelFee = refundType === '당일취소' ? Math.round(order.total_amount * 0.5) : 0;

  tx(() => {
    // 취소로 전환하면 사용액과 적립 포인트를 되돌린다(위약금은 차감된 채로 남긴다).
    if (status === '취소' && order.status !== '취소' && order.member_id) {
      balance.applyUsage(order.member_id, order.ym, -(order.total_amount - cancelFee));
      if (order.point_earn) balance.addPoints(order.member_id, -order.point_earn);
    }
    if (order.status === '취소' && status !== '취소' && order.member_id) {
      balance.applyUsage(order.member_id, order.ym, order.total_amount - (order.cancel_fee || 0));
      if (order.point_earn) balance.addPoints(order.member_id, order.point_earn);
    }
    run("UPDATE orders SET status = ?, cancel_fee = ?, refund_type = ?, updated_at = datetime('now','localtime') WHERE id = ?",
      status, status === '취소' ? cancelFee : 0, refundType, order.id);
    const memo = status === '취소'
      ? [refundType === '당일취소'
          ? `당일 취소 — 위약금 ${cancelFee.toLocaleString('ko-KR')}원(50%) 부과, ${(order.total_amount - cancelFee).toLocaleString('ko-KR')}원 환불`
          : '24시간 전 취소 — 전액 환불', body.memo].filter(Boolean).join(' / ')
      : body.memo || null;
    run('INSERT INTO order_logs(order_id, from_status, to_status, memo) VALUES(?,?,?,?)',
      order.id, order.status, status, memo);

    if (status === '결제완료') {
      run("UPDATE payment_requests SET status = '완료', approved_at = datetime('now','localtime') WHERE order_id = ?", order.id);
    }
  });

  sendJson(res, 200, { ok: true, status, refundType, cancelFee });
});

router.patch('/api/admin/orders/:id', async (req, res, ctx) => {
  auth.requireAdmin(req);
  const body = await readJson(req);
  const order = get('SELECT * FROM orders WHERE id = ?', Number(ctx.params.id));
  if (!order) throw new HttpError(404, '주문을 찾을 수 없습니다.');
  run("UPDATE orders SET note = ?, address = ?, updated_at = datetime('now','localtime') WHERE id = ?",
    body.note ?? order.note, body.address ?? order.address, order.id);
  sendJson(res, 200, { ok: true });
});

// ---- 카카오톡 문장 파싱 접수(관리자 수기 접수) ----
router.post('/api/admin/parse', async (req, res) => {
  auth.requireAdmin(req);
  const body = await readJson(req);
  const parsed = parseOrderText(body.text || '');
  let member = null;
  if (parsed.phone) member = get('SELECT * FROM members WHERE phone = ?', parsed.phone);
  if (!member && parsed.name) member = get('SELECT * FROM members WHERE name = ?', parsed.name);
  sendJson(res, 200, {
    ...parsed,
    member: member ? { id: member.id, name: member.name, phone: member.phone, address: member.address } : null,
    balance: member ? balance.summary(member.id) : null,
  });
});

router.post('/api/admin/orders', async (req, res) => {
  auth.requireAdmin(req);
  const body = await readJson(req);
  const name = String(body.name || '').trim();
  const phone = normalizePhone(body.phone);
  const items = resolveItems(Array.isArray(body.items) ? body.items : []);
  if (!name || !phone) throw new HttpError(400, '회원 이름과 연락처를 입력해 주세요.');
  if (!items.length) throw new HttpError(400, '접수할 항목이 없습니다.');

  const careAmount = items.filter((i) => i.source === 'care').reduce((a, b) => a + b.subtotal, 0);
  const marketAmount = items.filter((i) => i.source === 'market').reduce((a, b) => a + b.subtotal, 0);
  const total = careAmount + marketAmount;
  const pointEarn = items.reduce((a, b) => a + b.point_earn * b.qty, 0);
  const pickedCare = items.some((i) => i.source === 'care');
  const pickedMarket = items.some((i) => i.source === 'market');
  const type = pickedCare && pickedMarket ? '통합' : pickedMarket ? '장보기' : '돌봄서비스';

  const result = tx(() => {
    let member = get('SELECT * FROM members WHERE name = ? AND phone = ?', name, phone);
    if (!member) {
      const ins = run('INSERT INTO members(name, phone, address, monthly_limit, note) VALUES(?,?,?,?,?)',
        name, phone, body.address || null, Number(setting('default_monthly_limit', '200000')), '관리자 접수로 등록');
      member = get('SELECT * FROM members WHERE id = ?', Number(ins.lastInsertRowid));
    }
    const targetYm = balance.ym();
    const before = balance.summary(member.id, targetYm);
    if (total > before.rawAvailable && !body.force) {
      throw new HttpError(409, `잔액 부족: 사용 가능 ${before.rawAvailable.toLocaleString('ko-KR')}원 / 요청 ${total.toLocaleString('ko-KR')}원. 그래도 접수하려면 "한도 초과 접수"를 선택하세요.`);
    }

    const orderNo = nextOrderNo();
    const ins = run(
      `INSERT INTO orders(order_no, member_id, applicant_name, applicant_phone, address, type, status,
                          care_amount, market_amount, total_amount, point_earn, channel, note, ym)
       VALUES(?,?,?,?,?,?,'접수',?,?,?,?,?,?,?)`,
      orderNo, member.id, name, phone, body.address || member.address, type,
      careAmount, marketAmount, total, pointEarn, body.channel || '카카오톡', body.note || null, targetYm
    );
    const orderId = Number(ins.lastInsertRowid);
    for (const line of items) {
      run(`INSERT INTO order_items(order_id, source, ref_id, name, category, unit, unit_price, cost_price, point_earn, qty, subtotal)
           VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
        orderId, line.source, line.refId, line.name, line.category, line.unit,
        line.unitPrice, line.costPrice, line.point_earn, line.qty, line.subtotal);
    }
    run('INSERT INTO payment_requests(order_id, amount, status, method) VALUES(?,?,?,?)', orderId, total, '요청', '지역화폐카드');
    run('INSERT INTO order_logs(order_id, from_status, to_status, memo) VALUES(?,?,?,?)', orderId, null, '접수', `관리자 접수(${body.channel || '카카오톡'})`);
    balance.applyUsage(member.id, targetYm, total);
    if (pointEarn > 0) balance.addPoints(member.id, pointEarn);
    return { orderNo, memberId: member.id, targetYm };
  });

  sendJson(res, 201, { ok: true, orderNo: result.orderNo, total, balance: balance.summary(result.memberId, result.targetYm) });
});

// ---- 회원 관리 ----
router.get('/api/admin/members', (req, res, ctx) => {
  auth.requireAdmin(req);
  const targetYm = ctx.query.get('ym') || balance.ym();
  const keyword = ctx.query.get('q');
  const rows = keyword
    ? all('SELECT * FROM members WHERE name LIKE ? OR phone LIKE ? ORDER BY id DESC', `%${keyword}%`, `%${keyword}%`)
    : all('SELECT * FROM members ORDER BY id DESC');

  sendJson(res, 200, {
    ym: targetYm,
    members: rows.map((m) => ({ ...m, balance: balance.summary(m.id, targetYm) })),
  });
});

router.post('/api/admin/members', async (req, res) => {
  auth.requireAdmin(req);
  const b = await readJson(req);
  if (!b.name || !b.phone) throw new HttpError(400, '이름과 연락처는 필수입니다.');
  const phone = normalizePhone(b.phone);
  if (get('SELECT id FROM members WHERE name = ? AND phone = ?', b.name, phone)) {
    throw new HttpError(409, '같은 이름·연락처의 회원이 이미 있습니다.');
  }
  const ins = run(
    `INSERT INTO members(name, birth, phone, emergency_phone, address, monthly_limit, note)
     VALUES(?,?,?,?,?,?,?)`,
    b.name, b.birth || null, phone, normalizePhone(b.emergencyPhone) || null, b.address || null,
    Number(b.monthlyLimit || setting('default_monthly_limit', '200000')), b.note || null
  );
  sendJson(res, 201, { ok: true, id: Number(ins.lastInsertRowid) });
});

router.put('/api/admin/members/:id', async (req, res, ctx) => {
  auth.requireAdmin(req);
  const b = await readJson(req);
  const id = Number(ctx.params.id);
  const m = get('SELECT * FROM members WHERE id = ?', id);
  if (!m) throw new HttpError(404, '회원을 찾을 수 없습니다.');
  run(
    `UPDATE members SET name = ?, birth = ?, phone = ?, emergency_phone = ?, address = ?,
            monthly_limit = ?, points = ?, note = ?, active = ? WHERE id = ?`,
    b.name ?? m.name, b.birth ?? m.birth, normalizePhone(b.phone) || m.phone,
    b.emergencyPhone !== undefined ? normalizePhone(b.emergencyPhone) : m.emergency_phone,
    b.address ?? m.address, Number(b.monthlyLimit ?? m.monthly_limit),
    Number(b.points ?? m.points), b.note ?? m.note, b.active !== undefined ? (b.active ? 1 : 0) : m.active, id
  );
  // 당월 한도 레코드에도 즉시 반영
  if (b.monthlyLimit !== undefined) {
    const targetYm = balance.ym();
    balance.ensureBalance(id, targetYm);
    run('UPDATE monthly_balances SET limit_amount = ? WHERE member_id = ? AND ym = ?', Number(b.monthlyLimit), id, targetYm);
  }
  sendJson(res, 200, { ok: true });
});

router.delete('/api/admin/members/:id', (req, res, ctx) => {
  auth.requireAdmin(req);
  const id = Number(ctx.params.id);
  if (get('SELECT COUNT(*) AS c FROM orders WHERE member_id = ?', id).c > 0) {
    run('UPDATE members SET active = 0 WHERE id = ?', id);
    return sendJson(res, 200, { ok: true, softDeleted: true, message: '주문 이력이 있어 비활성 처리했습니다.' });
  }
  run('DELETE FROM members WHERE id = ?', id);
  sendJson(res, 200, { ok: true });
});

// ---- 가격표 관리 (장보기) ----
router.get('/api/admin/price-items', (req, res) => {
  auth.requireAdmin(req);
  sendJson(res, 200, { items: all('SELECT * FROM price_items ORDER BY sort_order, id') });
});

router.post('/api/admin/price-items', async (req, res) => {
  auth.requireAdmin(req);
  const b = await readJson(req);
  if (!b.name) throw new HttpError(400, '품목명을 입력해 주세요.');
  const cost = Number(b.costPrice || 0);
  const margin = Number(b.marginRate || 0);
  const sale = Number(b.salePrice) || Math.round((cost * (1 + margin)) / 10) * 10;
  const ins = run(
    'INSERT INTO price_items(name, category, unit, cost_price, margin_rate, sale_price, sort_order) VALUES(?,?,?,?,?,?,?)',
    b.name, b.category || null, b.unit || null, cost, margin, sale,
    Number(get('SELECT IFNULL(MAX(sort_order), 0) + 1 AS n FROM price_items').n)
  );
  sendJson(res, 201, { ok: true, id: Number(ins.lastInsertRowid) });
});

router.put('/api/admin/price-items/:id', async (req, res, ctx) => {
  auth.requireAdmin(req);
  const b = await readJson(req);
  const item = get('SELECT * FROM price_items WHERE id = ?', Number(ctx.params.id));
  if (!item) throw new HttpError(404, '품목을 찾을 수 없습니다.');
  const cost = Number(b.costPrice ?? item.cost_price);
  const margin = Number(b.marginRate ?? item.margin_rate);
  const sale = b.salePrice !== undefined && b.salePrice !== null && b.salePrice !== ''
    ? Number(b.salePrice)
    : Math.round((cost * (1 + margin)) / 10) * 10;
  run(
    'UPDATE price_items SET name = ?, category = ?, unit = ?, cost_price = ?, margin_rate = ?, sale_price = ?, active = ? WHERE id = ?',
    b.name ?? item.name, b.category ?? item.category, b.unit ?? item.unit,
    cost, margin, sale, b.active !== undefined ? (b.active ? 1 : 0) : item.active, item.id
  );
  sendJson(res, 200, { ok: true });
});

router.delete('/api/admin/price-items/:id', (req, res, ctx) => {
  auth.requireAdmin(req);
  run('UPDATE price_items SET active = 0 WHERE id = ?', Number(ctx.params.id));
  sendJson(res, 200, { ok: true });
});

// ---- 메뉴(돌봄서비스) 단가 관리 ----
router.get('/api/admin/menu-items', (req, res) => {
  auth.requireAdmin(req);
  sendJson(res, 200, { items: all('SELECT * FROM menu_items ORDER BY sort_order, id') });
});

router.put('/api/admin/menu-items/:id', async (req, res, ctx) => {
  auth.requireAdmin(req);
  const b = await readJson(req);
  const item = get('SELECT * FROM menu_items WHERE id = ?', Number(ctx.params.id));
  if (!item) throw new HttpError(404, '메뉴 항목을 찾을 수 없습니다.');
  run(
    'UPDATE menu_items SET name = ?, category = ?, description = ?, unit = ?, price = ?, cost_price = ?, point_earn = ?, free_label = ?, active = ? WHERE id = ?',
    b.name ?? item.name, b.category ?? item.category, b.description ?? item.description, b.unit ?? item.unit,
    Number(b.price ?? item.price), Number(b.costPrice ?? item.cost_price), Number(b.pointEarn ?? item.point_earn),
    b.freeLabel !== undefined ? b.freeLabel : item.free_label,
    b.active !== undefined ? (b.active ? 1 : 0) : item.active, item.id
  );
  sendJson(res, 200, { ok: true });
});

router.post('/api/admin/menu-items', async (req, res) => {
  auth.requireAdmin(req);
  const b = await readJson(req);
  if (!b.name || !b.category) throw new HttpError(400, '분류와 서비스명을 입력해 주세요.');
  const ins = run(
    'INSERT INTO menu_items(category, name, description, unit, price, cost_price, point_earn, free_label, sort_order) VALUES(?,?,?,?,?,?,?,?,?)',
    b.category, b.name, b.description || null, b.unit || null, Number(b.price || 0), Number(b.costPrice || 0),
    Number(b.pointEarn || 0), b.freeLabel || null, Number(get('SELECT IFNULL(MAX(sort_order), 0) + 1 AS n FROM menu_items').n)
  );
  sendJson(res, 201, { ok: true, id: Number(ins.lastInsertRowid) });
});

// ---- 잔액 대시보드 ----
router.get('/api/admin/dashboard', (req, res, ctx) => {
  auth.requireAdmin(req);
  const targetYm = ctx.query.get('ym') || balance.ym();
  const members = all('SELECT * FROM members WHERE active = 1');
  const rows = members.map((m) => ({ id: m.id, name: m.name, phone: m.phone, ...balance.summary(m.id, targetYm) }));

  const totalLimit = rows.reduce((a, b) => a + b.limit + b.carryover + b.points, 0);
  const totalUsed = rows.reduce((a, b) => a + b.used, 0);
  const nearLimit = rows.filter((r) => r.usageRate >= 80 && r.usageRate < 100);
  const exhausted = rows.filter((r) => r.available <= 0);

  const byStatus = Object.fromEntries(
    all('SELECT status, COUNT(*) AS c, SUM(total_amount) AS amount FROM orders WHERE ym = ? GROUP BY status', targetYm)
      .map((r) => [r.status, { count: r.c, amount: r.amount || 0 }])
  );
  const byType = all('SELECT type, COUNT(*) AS c, SUM(total_amount) AS amount FROM orders WHERE ym = ? AND status != ? GROUP BY type', targetYm, '취소');

  sendJson(res, 200, {
    ym: targetYm,
    memberCount: rows.length,
    totalLimit, totalUsed,
    usageRate: totalLimit ? Math.round((totalUsed / totalLimit) * 100) : 0,
    nearLimit, exhausted,
    byStatus, byType,
    top: rows.slice().sort((a, b) => b.used - a.used).slice(0, 10),
  });
});

// ---- 정산 ----
function settlementData(query) {
  const from = query.get('from') || `${balance.ym()}-01`;
  const to = query.get('to') || `${balance.ym()}-31`;
  const memberId = query.get('memberId');

  const where = ["o.status != '취소'", 'date(o.created_at) BETWEEN date(?) AND date(?)'];
  const params = [from, to];
  if (memberId) { where.push('o.member_id = ?'); params.push(Number(memberId)); }
  const whereSql = `WHERE ${where.join(' AND ')}`;

  const lines = all(
    `SELECT o.order_no, o.created_at, o.status, o.type, m.name AS member_name, m.phone,
            oi.source, oi.category, oi.name AS item_name, oi.unit_price, oi.cost_price, oi.qty, oi.subtotal
     FROM orders o
     JOIN order_items oi ON oi.order_id = o.id
     LEFT JOIN members m ON m.id = o.member_id
     ${whereSql} ORDER BY o.id, oi.id`,
    ...params
  );

  // 취소 위약금(당일 취소 50%)은 취소 건에서 발생한 수입이므로 따로 집계한다.
  const cancelFees = get(
    `SELECT IFNULL(SUM(cancel_fee), 0) AS amount, COUNT(*) AS count FROM orders
     WHERE status = '취소' AND cancel_fee > 0 AND date(created_at) BETWEEN date(?) AND date(?)`,
    from, to
  );

  const totals = { revenue: 0, cost: 0, margin: 0, care: 0, market: 0, orders: new Set() };
  const byMember = new Map();
  for (const l of lines) {
    const cost = (l.cost_price || 0) * l.qty;
    totals.revenue += l.subtotal;
    totals.cost += cost;
    totals.orders.add(l.order_no);
    if (l.source === 'market') totals.market += l.subtotal; else totals.care += l.subtotal;

    const key = l.member_name || '(미지정)';
    const agg = byMember.get(key) || { member: key, phone: l.phone, revenue: 0, cost: 0, care: 0, market: 0, orders: new Set() };
    agg.revenue += l.subtotal;
    agg.cost += cost;
    if (l.source === 'market') agg.market += l.subtotal; else agg.care += l.subtotal;
    agg.orders.add(l.order_no);
    byMember.set(key, agg);
  }
  totals.cancelFee = cancelFees.amount;
  totals.cancelCount = cancelFees.count;
  totals.revenue += cancelFees.amount;
  totals.margin = totals.revenue - totals.cost;

  // 돌봄서비스는 인건비가 원가이므로, 원가를 입력하지 않은 항목이 있으면 마진이 과대 계상된다.
  const missingCost = lines.filter((l) => l.source !== 'market' && !l.cost_price && l.subtotal > 0);
  const missingCostNames = [...new Set(missingCost.map((l) => l.item_name))];

  const cancelLines = all(
    `SELECT o.order_no, o.created_at, o.status, o.type, m.name AS member_name, m.phone, o.cancel_fee, o.refund_type
     FROM orders o LEFT JOIN members m ON m.id = o.member_id
     WHERE o.status = '취소' AND o.cancel_fee > 0 AND date(o.created_at) BETWEEN date(?) AND date(?)
     ORDER BY o.id`, from, to);

  return {
    from, to, lines, cancelLines,
    costWarning: missingCostNames.length
      ? { count: missingCostNames.length, amount: missingCost.reduce((a, b) => a + b.subtotal, 0), names: missingCostNames.slice(0, 8) }
      : null,
    totals: { ...totals, orders: totals.orders.size },
    byMember: [...byMember.values()].map((m) => ({ ...m, orders: m.orders.size, margin: m.revenue - m.cost })),
  };
}

router.get('/api/admin/settlement', (req, res, ctx) => {
  auth.requireAdmin(req);
  const data = settlementData(ctx.query);
  sendJson(res, 200, data);
});

router.get('/api/admin/settlement.csv', (req, res, ctx) => {
  auth.requireAdmin(req);
  const data = settlementData(ctx.query);
  const csv = toCsv(
    ['접수번호', '접수일시', '상태', '유형', '회원명', '연락처', '구분', '분류', '항목', '단가', '매입가', '수량', '금액', '매입원가', '마진'],
    data.lines.map((l) => [
      l.order_no, l.created_at, l.status, l.type, l.member_name, l.phone,
      l.source === 'market' ? '장보기' : '돌봄서비스', l.category, l.item_name,
      l.unit_price, l.cost_price, l.qty, l.subtotal,
      (l.cost_price || 0) * l.qty, l.subtotal - (l.cost_price || 0) * l.qty,
    ]).concat(data.cancelLines.map((c) => [
      c.order_no, c.created_at, c.status, c.type, c.member_name, c.phone,
      '취소 위약금', c.refund_type || '당일취소', '당일 취소 위약금(50%)',
      c.cancel_fee, 0, 1, c.cancel_fee, 0, c.cancel_fee,
    ]))
  );
  sendCsv(res, `정산내역_${data.from}_${data.to}.csv`, csv);
});

router.get('/api/admin/members.csv', (req, res, ctx) => {
  auth.requireAdmin(req);
  const targetYm = ctx.query.get('ym') || balance.ym();
  const rows = all('SELECT * FROM members ORDER BY id');
  const csv = toCsv(
    ['회원ID', '이름', '생년월일', '연락처', '비상연락처', '주소', '월한도', '이월', '포인트', '사용액', '잔액', '사용률(%)', '비고'],
    rows.map((m) => {
      const b = balance.summary(m.id, targetYm);
      return [m.id, m.name, m.birth, m.phone, m.emergency_phone, m.address, b.limit, b.carryover, b.points, b.used, b.available, b.usageRate, m.note];
    })
  );
  sendCsv(res, `회원잔액_${targetYm}.csv`, csv);
});

// ---- 설정 ----
router.get('/api/admin/settings', (req, res) => {
  auth.requireAdmin(req);
  sendJson(res, 200, {
    defaultMonthlyLimit: Number(setting('default_monthly_limit', '200000')),
    carryoverEnabled: setting('carryover_enabled', '1') === '1',
    carryoverMax: Number(setting('carryover_max', '200000')),
    smallOrderFee: Number(setting('small_order_fee', '2000')),
    smallOrderThreshold: Number(setting('small_order_threshold', '30000')),
    serviceName: setting('service_name', ''),
    orgName: setting('org_name', ''),
  });
});

router.put('/api/admin/settings', async (req, res) => {
  auth.requireAdmin(req);
  const b = await readJson(req);
  const map = {
    defaultMonthlyLimit: 'default_monthly_limit',
    carryoverMax: 'carryover_max',
    smallOrderFee: 'small_order_fee',
    smallOrderThreshold: 'small_order_threshold',
    serviceName: 'service_name',
    orgName: 'org_name',
  };
  for (const [field, key] of Object.entries(map)) {
    if (b[field] !== undefined) setSetting(key, b[field]);
  }
  if (b.carryoverEnabled !== undefined) setSetting('carryover_enabled', b.carryoverEnabled ? '1' : '0');
  sendJson(res, 200, { ok: true });
});

module.exports = { router, STATUSES };
