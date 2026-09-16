'use strict';

/** 고객(어르신·보호자) 화면이 사용하는 공개 API */

const { get, all, run, tx, setting } = require('../db');
const { Router, readJson, sendJson, HttpError, clientIp } = require('../lib/http');
const balance = require('../lib/balance');
const { parseOrderText } = require('../lib/parser');
const { CONSENT_ITEMS } = require('../seed');

const router = new Router();

const CARE_SOURCE = 'care';
const MARKET_SOURCE = 'market';

function consentItems() {
  try {
    return JSON.parse(setting('consent_items', 'null')) || CONSENT_ITEMS;
  } catch {
    return CONSENT_ITEMS;
  }
}

function nextOrderNo() {
  const d = new Date();
  const prefix = `${String(d.getFullYear()).slice(2)}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
  const row = get("SELECT COUNT(*) AS c FROM orders WHERE order_no LIKE ?", `${prefix}-%`);
  return `${prefix}-${String(row.c + 1).padStart(4, '0')}`;
}

/** 메뉴판 · 가격표 · 패키지 · 동의항목 일괄 조회 */
router.get('/api/catalog', (req, res) => {
  const menu = all('SELECT * FROM menu_items WHERE active = 1 ORDER BY sort_order');
  const categories = [];
  for (const item of menu) {
    let group = categories.find((c) => c.category === item.category);
    if (!group) {
      group = { category: item.category, items: [] };
      categories.push(group);
    }
    group.items.push(item);
  }

  const packages = all('SELECT * FROM packages WHERE active = 1 ORDER BY sort_order').map((p) => ({
    ...p,
    items: all('SELECT * FROM package_items WHERE package_id = ? ORDER BY id', p.id),
  }));

  sendJson(res, 200, {
    categories,
    packages,
    priceItems: all('SELECT id, name, category, unit, sale_price FROM price_items WHERE active = 1 ORDER BY sort_order'),
    consentItems: consentItems().map(([key, label, required]) => ({ key, label, required: !!required })),
    settings: {
      serviceName: setting('service_name', '보성군 기본소득 연계 통합돌봄 서비스'),
      orgName: setting('org_name', '농업회사법인 히스메이커스 주식회사'),
      defaultLimit: Number(setting('default_monthly_limit', '200000')),
      smallOrderFee: Number(setting('small_order_fee', '2000')),
      smallOrderThreshold: Number(setting('small_order_threshold', '30000')),
    },
  });
});

/** 본인 확인(간이): 이름 + 연락처로 회원 조회 → 이번 달 잔액 */
router.post('/api/member/lookup', async (req, res) => {
  const body = await readJson(req);
  const name = String(body.name || '').trim();
  const phone = normalizePhone(body.phone);
  if (!name || !phone) throw new HttpError(400, '이름과 연락처를 모두 입력해 주세요.');

  const member = get('SELECT * FROM members WHERE name = ? AND phone = ? AND active = 1', name, phone);
  if (!member) {
    return sendJson(res, 200, { found: false, message: '등록된 회원 정보가 없습니다. 신청서를 제출하시면 담당자가 확인 후 회원 등록해 드립니다.' });
  }
  sendJson(res, 200, { found: true, member: publicMember(member), balance: balance.summary(member.id) });
});

/** 카카오톡 주문 문장 파싱 */
router.post('/api/parse', async (req, res) => {
  const body = await readJson(req);
  const parsed = parseOrderText(body.text || '');
  sendJson(res, 200, parsed);
});

/** 신청/주문 접수 */
router.post('/api/orders', async (req, res) => {
  const body = await readJson(req);
  const applicant = body.applicant || {};
  const name = String(applicant.name || '').trim();
  const phone = normalizePhone(applicant.phone);
  const items = Array.isArray(body.items) ? body.items : [];

  if (!name) throw new HttpError(400, '신청자 이름을 입력해 주세요.');
  if (!phone) throw new HttpError(400, '연락처를 올바르게 입력해 주세요. (예: 010-1234-5678)');
  if (!items.length) throw new HttpError(400, '신청하실 서비스나 장보기 품목을 한 가지 이상 담아 주세요.');

  const required = consentItems().filter(([, , req_]) => req_);
  const agreed = new Set((body.consents || []).filter((c) => c.agreed).map((c) => c.key));
  for (const [key, label] of required) {
    if (!agreed.has(key)) throw new HttpError(400, `필수 동의 항목에 동의해 주세요: ${label}`);
  }

  const resolved = resolveItems(items);
  if (!resolved.length) throw new HttpError(400, '유효한 항목이 없습니다. 다시 선택해 주세요.');

  // 유형은 이용자가 직접 고른 항목으로 판정한다(자동 부가되는 취급비는 제외).
  const pickedCare = resolved.some((i) => i.source === CARE_SOURCE);
  const pickedMarket = resolved.some((i) => i.source === MARKET_SOURCE);
  const orderType = pickedCare && pickedMarket ? '통합' : pickedMarket ? '장보기' : '돌봄서비스';

  // 소액주문 취급비 자동 적용
  const marketSum = sum(resolved.filter((i) => i.source === MARKET_SOURCE).map((i) => i.subtotal));
  const threshold = Number(setting('small_order_threshold', '30000'));
  if (marketSum > 0 && marketSum < threshold) {
    const fee = get("SELECT * FROM menu_items WHERE name = '소액주문 취급비'");
    if (fee && !resolved.some((i) => i.refId === fee.id && i.source === CARE_SOURCE)) {
      resolved.push(toLine(CARE_SOURCE, fee.id, fee.name, fee.category, fee.unit, fee.price, 0, 1, fee.cost_price || 0));
    }
  }

  const careAmount = sum(resolved.filter((i) => i.source === CARE_SOURCE).map((i) => i.subtotal));
  const marketAmount = sum(resolved.filter((i) => i.source === MARKET_SOURCE).map((i) => i.subtotal));
  const total = careAmount + marketAmount;
  const pointEarn = sum(resolved.map((i) => i.point_earn * i.qty));

  const result = tx(() => {
    let member = get('SELECT * FROM members WHERE name = ? AND phone = ?', name, phone);
    if (!member) {
      const ins = run(
        `INSERT INTO members(name, birth, phone, emergency_phone, address, monthly_limit, note)
         VALUES(?,?,?,?,?,?,?)`,
        name, applicant.birth || null, phone, applicant.emergencyPhone || null,
        applicant.address || null, Number(setting('default_monthly_limit', '200000')),
        '웹 신청서로 자동 등록'
      );
      member = get('SELECT * FROM members WHERE id = ?', Number(ins.lastInsertRowid));
    }

    const targetYm = balance.ym();
    const before = balance.summary(member.id, targetYm);
    if (total > before.rawAvailable) {
      throw new HttpError(409,
        `이번 달 사용 가능 금액(${before.rawAvailable.toLocaleString('ko-KR')}원)을 ${(total - before.rawAvailable).toLocaleString('ko-KR')}원 초과합니다. 항목을 조정해 주세요.`);
    }

    const orderNo = nextOrderNo();
    const orderRes = run(
      `INSERT INTO orders(order_no, member_id, applicant_name, applicant_phone, applicant_birth, address,
                          emergency_phone, proxy_name, proxy_relation, proxy_phone, type, status,
                          care_amount, market_amount, total_amount, point_earn, channel, note, ym)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,'접수',?,?,?,?,?,?,?)`,
      orderNo, member.id, name, phone, applicant.birth || null, applicant.address || null,
      applicant.emergencyPhone || null, applicant.proxyName || null, applicant.proxyRelation || null,
      normalizePhone(applicant.proxyPhone) || null, orderType,
      careAmount, marketAmount, total, pointEarn, body.channel || '웹', body.note || null, targetYm
    );
    const orderId = Number(orderRes.lastInsertRowid);

    for (const line of resolved) {
      run(
        `INSERT INTO order_items(order_id, source, ref_id, name, category, unit, unit_price, cost_price, point_earn, qty, subtotal)
         VALUES(?,?,?,?,?,?,?,?,?,?,?)`,
        orderId, line.source, line.refId, line.name, line.category, line.unit,
        line.unitPrice, line.costPrice, line.point_earn, line.qty, line.subtotal
      );
    }

    const ip = clientIp(req);
    const now = new Date().toISOString();
    for (const [key, label, isRequired] of consentItems()) {
      const isAgreed = agreed.has(key) ? 1 : 0;
      run(
        `INSERT INTO consents(order_id, member_id, item_key, item_label, required, agreed, agreed_at, ip)
         VALUES(?,?,?,?,?,?,?,?)`,
        orderId, member.id, key, label, isRequired ? 1 : 0, isAgreed, isAgreed ? now : null, ip
      );
    }

    run('INSERT INTO payment_requests(order_id, amount, status, method) VALUES(?,?,?,?)',
      orderId, total, '요청', '지역화폐카드');
    run('INSERT INTO order_logs(order_id, from_status, to_status, memo) VALUES(?,?,?,?)',
      orderId, null, '접수', '웹 신청서 접수');

    balance.applyUsage(member.id, targetYm, total);
    if (pointEarn > 0) balance.addPoints(member.id, pointEarn);

    return { orderId, orderNo, memberId: member.id, targetYm };
  });

  sendJson(res, 201, {
    ok: true,
    orderNo: result.orderNo,
    message: '접수되었습니다. 담당자가 확인 후 연락드립니다.',
    summary: { careAmount, marketAmount, total, pointEarn, type: orderType },
    balance: balance.summary(result.memberId, result.targetYm),
    payment: { status: '요청', note: '지역화폐 카드로 결제 예정 (방문 카드결제기 또는 자택 결제)' },
  });
});

/** 접수번호 + 연락처로 진행 상태 조회 */
router.get('/api/orders/:orderNo', (req, res, ctx) => {
  const phone = normalizePhone(ctx.query.get('phone'));
  if (!phone) throw new HttpError(400, '연락처를 함께 입력해 주세요.');
  const order = get('SELECT * FROM orders WHERE order_no = ? AND applicant_phone = ?', ctx.params.orderNo, phone);
  if (!order) throw new HttpError(404, '해당 접수번호의 신청 내역을 찾을 수 없습니다.');
  sendJson(res, 200, {
    order: {
      orderNo: order.order_no, type: order.type, status: order.status,
      total: order.total_amount, careAmount: order.care_amount, marketAmount: order.market_amount,
      pointEarn: order.point_earn, createdAt: order.created_at,
    },
    items: all('SELECT name, category, unit, unit_price, qty, subtotal FROM order_items WHERE order_id = ?', order.id),
    history: all('SELECT from_status, to_status, memo, created_at FROM order_logs WHERE order_id = ? ORDER BY id', order.id),
  });
});

// ---- helpers ----

function sum(list) {
  return list.reduce((a, b) => a + b, 0);
}

function normalizePhone(value) {
  const digits = String(value || '').replace(/[^0-9]/g, '');
  if (digits.length === 11) return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7)}`;
  if (digits.length === 10) return `${digits.slice(0, 3)}-${digits.slice(3, 6)}-${digits.slice(6)}`;
  return digits ? digits : '';
}

function toLine(source, refId, name, category, unit, unitPrice, pointEarn, qty, costPrice = 0) {
  return {
    source, refId, name, category, unit,
    unitPrice, costPrice, point_earn: pointEarn, qty,
    subtotal: unitPrice * qty,
  };
}

/** 클라이언트가 보낸 금액은 신뢰하지 않고 서버 단가로 다시 계산한다. */
function resolveItems(items) {
  const lines = [];
  for (const raw of items) {
    const qty = Math.max(1, Math.min(999, parseInt(raw.qty, 10) || 1));
    if (raw.source === MARKET_SOURCE) {
      const item = get('SELECT * FROM price_items WHERE id = ? AND active = 1', raw.refId);
      if (!item) continue;
      lines.push(toLine(MARKET_SOURCE, item.id, item.name, item.category, item.unit, item.sale_price, 0, qty, item.cost_price));
    } else {
      const item = get('SELECT * FROM menu_items WHERE id = ? AND active = 1', raw.refId);
      if (!item) continue;
      lines.push(toLine(CARE_SOURCE, item.id, item.name, item.category, item.unit, item.price, item.point_earn, qty, item.cost_price || 0));
    }
  }
  return lines;
}

function publicMember(m) {
  return { id: m.id, name: m.name, phone: m.phone, address: m.address, birth: m.birth, points: m.points };
}

module.exports = { router, normalizePhone, nextOrderNo, resolveItems, consentItems };
