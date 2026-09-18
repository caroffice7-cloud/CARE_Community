'use strict';

/**
 * 월 20만원 지역화폐 한도를 시스템의 중심 축으로 다루는 모듈.
 *  사용가능액 = 한도 + 이월액 + 포인트 - 사용액
 *  이월: 전월 미사용 잔액을 1회, 최대 20만원까지 자동 이월(설정으로 on/off).
 */

const { get, run, setting } = require('../db');

function ym(date = new Date()) {
  const d = date instanceof Date ? date : new Date(date);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

function prevYm(target) {
  const [y, m] = target.split('-').map(Number);
  const d = new Date(y, m - 2, 1);
  return ym(d);
}

/** 해당 월의 잔액 레코드를 보장한다(없으면 이월을 계산해 생성). */
function ensureBalance(memberId, targetYm = ym()) {
  const existing = get('SELECT * FROM monthly_balances WHERE member_id = ? AND ym = ?', memberId, targetYm);
  if (existing) return existing;

  const member = get('SELECT * FROM members WHERE id = ?', memberId);
  if (!member) return null;

  const limitAmount = member.monthly_limit ?? Number(setting('default_monthly_limit', '200000'));
  let carryover = 0;

  if (setting('carryover_enabled', '1') === '1') {
    const prev = get('SELECT * FROM monthly_balances WHERE member_id = ? AND ym = ?', memberId, prevYm(targetYm));
    if (prev) {
      // 이월은 1회만: 전월에 이미 이월받은 금액은 다시 이월하지 않는다.
      // 이월 대상은 전월 '자기 한도'의 미사용분만(이미 이월받은 금액은 재이월 제외)
      const unusedOwn = prev.limit_amount - prev.used_amount;
      const max = Number(setting('carryover_max', '200000'));
      carryover = Math.min(Math.max(0, unusedOwn), max);
    }
  }

  run(
    'INSERT INTO monthly_balances(member_id, ym, limit_amount, carryover, used_amount) VALUES(?,?,?,?,0)',
    memberId, targetYm, limitAmount, carryover
  );
  return get('SELECT * FROM monthly_balances WHERE member_id = ? AND ym = ?', memberId, targetYm);
}

/** 화면 표시용 잔액 요약 */
function summary(memberId, targetYm = ym()) {
  const member = get('SELECT * FROM members WHERE id = ?', memberId);
  if (!member) return null;
  const bal = ensureBalance(memberId, targetYm);
  const points = member.points || 0;
  const available = bal.limit_amount + bal.carryover + points - bal.used_amount;
  return {
    memberId,
    memberName: member.name,
    ym: targetYm,
    limit: bal.limit_amount,
    carryover: bal.carryover,
    points,
    used: bal.used_amount,
    available: Math.max(0, available),
    rawAvailable: available,
    usageRate: bal.limit_amount + bal.carryover + points > 0
      ? Math.round((bal.used_amount / (bal.limit_amount + bal.carryover + points)) * 100)
      : 0,
  };
}

/**
 * 사용액 반영. delta > 0 이면 차감(사용), delta < 0 이면 복원(취소).
 * 포인트 적립분은 별도로 members.points 에 가산한다.
 */
function applyUsage(memberId, targetYm, delta) {
  ensureBalance(memberId, targetYm);
  run(
    'UPDATE monthly_balances SET used_amount = MAX(0, used_amount + ?) WHERE member_id = ? AND ym = ?',
    delta, memberId, targetYm
  );
}

function addPoints(memberId, points) {
  if (!points) return;
  run('UPDATE members SET points = MAX(0, points + ?) WHERE id = ?', points, memberId);
}

module.exports = { ym, prevYm, ensureBalance, summary, applyUsage, addPoints };
