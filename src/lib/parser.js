'use strict';

/**
 * 카카오톡 주문 문장 파싱.
 * 1차 프로토타입의 "문장 붙여넣기 → 장바구니 반영" 기능을 서버로 옮긴 것.
 *
 * 예)
 *   김순자 010-1234-5678
 *   백미10kg 1, 계란 2판
 *   두부 3모
 *   화장지 30롤 한 팩
 */

const { all } = require('../db');

const KOREAN_NUM = {
  한: 1, 하나: 1, 둘: 2, 두: 2, 세: 3, 셋: 3, 네: 4, 넷: 4,
  다섯: 5, 여섯: 6, 일곱: 7, 여덟: 8, 아홉: 9, 열: 10,
};

const PHONE_RE = /(01[016-9])[-\s.]?(\d{3,4})[-\s.]?(\d{4})/;
const NOISE = /(주세요|주십시오|부탁드립니다|부탁해요|부탁|사다|사서|배달|배송|해주세요|요|입니다|이요|줘|해줘)/g;

function normalize(s) {
  return String(s || '').replace(/\s+/g, ' ').trim();
}

/** 상품명 비교용 키: 공백·특수문자 제거, 소문자화 */
function key(s) {
  return String(s || '').toLowerCase().replace(/[^0-9a-z가-힣]/g, '');
}

function extractQty(token) {
  // "2판", "3모", "x2", "2개", "두 개"
  let qty = 1;
  let rest = token;

  const xMatch = rest.match(/[xX*]\s*(\d+)\s*$/);
  if (xMatch) {
    qty = parseInt(xMatch[1], 10);
    rest = rest.slice(0, xMatch.index);
    return { qty, rest: rest.trim() };
  }

  const tailNum = rest.match(/(\d+)\s*(개|팩|봉|병|통|모|판|kg|포|박스|묶음|단|망|롤|장|매|줄|인분|회|건)?\s*$/);
  if (tailNum && tailNum[1] && !/^\d+\s*(kg|g|ml|l|구|롤|매|입)$/i.test(tailNum[0].trim())) {
    // 상품명 자체에 포함된 규격(10kg, 30구)은 수량으로 보지 않는다.
    const beforeIdx = tailNum.index;
    const head = rest.slice(0, beforeIdx).trim();
    if (head.length >= 2) {
      qty = parseInt(tailNum[1], 10);
      rest = head;
      return { qty, rest };
    }
  }

  for (const [word, value] of Object.entries(KOREAN_NUM)) {
    const re = new RegExp(`${word}\\s*(개|팩|봉|병|통|모|판|포|박스|묶음|단|망|롤|장|줄)\\s*$`);
    if (re.test(rest)) {
      qty = value;
      rest = rest.replace(re, '').trim();
      return { qty, rest };
    }
  }

  return { qty, rest: rest.trim() };
}

/** 후보 품목 중 가장 잘 맞는 것을 고른다. */
function bestMatch(text, catalog) {
  const k = key(text);
  if (!k) return null;
  let best = null;
  let bestScore = 0;

  for (const item of catalog) {
    const ik = key(item.name);
    if (!ik) continue;
    let score = 0;
    if (ik === k) score = 100;
    else if (ik.includes(k) || k.includes(ik)) score = 60 + Math.min(20, Math.min(ik.length, k.length));
    else {
      // 공통 접두 길이 기반 부분 점수
      let common = 0;
      while (common < ik.length && common < k.length && ik[common] === k[common]) common++;
      if (common >= 2) score = 20 + common * 3;
    }
    if (score > bestScore) {
      bestScore = score;
      best = item;
    }
  }
  return bestScore >= 26 ? { item: best, score: bestScore } : null;
}

/**
 * @returns {{ name, phone, items: [{priceItemId,name,qty,unitPrice,subtotal,matchedFrom}], unmatched: string[] }}
 */
function parseOrderText(text) {
  const catalog = all('SELECT id, name, unit, sale_price, cost_price FROM price_items WHERE active = 1');
  const raw = String(text || '');
  const result = { name: null, phone: null, items: [], unmatched: [] };

  const phoneMatch = raw.match(PHONE_RE);
  if (phoneMatch) result.phone = `${phoneMatch[1]}-${phoneMatch[2]}-${phoneMatch[3]}`;

  const lines = raw.split(/\r?\n/).map(normalize).filter(Boolean);
  const tokens = [];

  lines.forEach((line, idx) => {
    let work = line;
    if (phoneMatch && work.includes(phoneMatch[0])) {
      const before = normalize(work.slice(0, work.indexOf(phoneMatch[0])));
      if (before && before.length <= 10 && !/\d/.test(before)) {
        result.name = before;
        work = normalize(work.replace(before, ''));
      }
      work = normalize(work.replace(PHONE_RE, ''));
    }
    if (idx === 0 && !result.name && /^[가-힣]{2,4}$/.test(work)) {
      result.name = work;
      return;
    }
    if (!work) return;
    for (const piece of work.split(/[,·/]|\s{2,}/)) {
      const t = normalize(piece).replace(NOISE, '').trim();
      if (t) tokens.push(t);
    }
  });

  for (const token of tokens) {
    const { qty, rest } = extractQty(token);
    const match = bestMatch(rest || token, catalog);
    if (match) {
      const existing = result.items.find((i) => i.priceItemId === match.item.id);
      if (existing) {
        existing.qty += qty;
        existing.subtotal = existing.qty * existing.unitPrice;
      } else {
        result.items.push({
          priceItemId: match.item.id,
          name: match.item.name,
          unit: match.item.unit,
          qty,
          unitPrice: match.item.sale_price,
          costPrice: match.item.cost_price,
          subtotal: qty * match.item.sale_price,
          matchedFrom: token,
        });
      }
    } else if (token.length >= 2) {
      result.unmatched.push(token);
    }
  }

  return result;
}

module.exports = { parseOrderText, extractQty, bestMatch };
