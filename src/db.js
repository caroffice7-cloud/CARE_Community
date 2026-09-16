'use strict';

const { DatabaseSync } = require('node:sqlite');
const path = require('node:path');
const fs = require('node:fs');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, '..', 'data');
const DB_PATH = process.env.DB_PATH || path.join(DATA_DIR, 'care.db');

fs.mkdirSync(DATA_DIR, { recursive: true });

const db = new DatabaseSync(DB_PATH);
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

const SCHEMA = `
CREATE TABLE IF NOT EXISTS members (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  name            TEXT NOT NULL,
  birth           TEXT,
  phone           TEXT NOT NULL,
  emergency_phone TEXT,
  address         TEXT,
  monthly_limit   INTEGER NOT NULL DEFAULT 200000,
  points          INTEGER NOT NULL DEFAULT 0,
  note            TEXT,
  active          INTEGER NOT NULL DEFAULT 1,
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_members_phone ON members(phone);

-- 월별 잔액: 한도 / 이월 / 사용액을 월 단위로 고정 보관한다.
CREATE TABLE IF NOT EXISTS monthly_balances (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  member_id     INTEGER NOT NULL REFERENCES members(id) ON DELETE CASCADE,
  ym            TEXT NOT NULL,
  limit_amount  INTEGER NOT NULL DEFAULT 200000,
  carryover     INTEGER NOT NULL DEFAULT 0,
  used_amount   INTEGER NOT NULL DEFAULT 0,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  UNIQUE(member_id, ym)
);

-- 통합돌봄 서비스 메뉴판 항목
CREATE TABLE IF NOT EXISTS menu_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  category    TEXT NOT NULL,
  name        TEXT NOT NULL,
  description TEXT,
  unit        TEXT,
  price       INTEGER NOT NULL DEFAULT 0,
  cost_price  INTEGER NOT NULL DEFAULT 0,
  point_earn  INTEGER NOT NULL DEFAULT 0,
  free_label  TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1
);

-- 생활장터 가격표 (매입가/마진율/판매가) - 1차 프로토타입 계승
CREATE TABLE IF NOT EXISTS price_items (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  name        TEXT NOT NULL,
  category    TEXT,
  unit        TEXT,
  cost_price  INTEGER NOT NULL DEFAULT 0,
  margin_rate REAL NOT NULL DEFAULT 0,
  sale_price  INTEGER NOT NULL DEFAULT 0,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1
);

-- 추천 패키지
CREATE TABLE IF NOT EXISTS packages (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  code        TEXT NOT NULL UNIQUE,
  name        TEXT NOT NULL,
  target      TEXT,
  description TEXT,
  sort_order  INTEGER NOT NULL DEFAULT 0,
  active      INTEGER NOT NULL DEFAULT 1
);
CREATE TABLE IF NOT EXISTS package_items (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  package_id   INTEGER NOT NULL REFERENCES packages(id) ON DELETE CASCADE,
  menu_item_id INTEGER REFERENCES menu_items(id),
  label        TEXT NOT NULL,
  qty          INTEGER NOT NULL DEFAULT 1,
  amount       INTEGER NOT NULL DEFAULT 0,
  budget_only  INTEGER NOT NULL DEFAULT 0
);

-- 신청/주문 (돌봄서비스 + 장보기 통합)
CREATE TABLE IF NOT EXISTS orders (
  id              INTEGER PRIMARY KEY AUTOINCREMENT,
  order_no        TEXT NOT NULL UNIQUE,
  member_id       INTEGER REFERENCES members(id),
  applicant_name  TEXT NOT NULL,
  applicant_phone TEXT NOT NULL,
  applicant_birth TEXT,
  address         TEXT,
  emergency_phone TEXT,
  proxy_name      TEXT,
  proxy_relation  TEXT,
  proxy_phone     TEXT,
  type            TEXT NOT NULL DEFAULT '돌봄서비스',
  status          TEXT NOT NULL DEFAULT '접수',
  care_amount     INTEGER NOT NULL DEFAULT 0,
  market_amount   INTEGER NOT NULL DEFAULT 0,
  total_amount    INTEGER NOT NULL DEFAULT 0,
  point_earn      INTEGER NOT NULL DEFAULT 0,
  service_date    TEXT,
  service_time    TEXT,
  cancel_fee      INTEGER NOT NULL DEFAULT 0,
  refund_type     TEXT,
  channel         TEXT NOT NULL DEFAULT '웹',
  note            TEXT,
  ym              TEXT NOT NULL,
  created_at      TEXT NOT NULL DEFAULT (datetime('now','localtime')),
  updated_at      TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status);
CREATE INDEX IF NOT EXISTS idx_orders_member ON orders(member_id, ym);

CREATE TABLE IF NOT EXISTS order_items (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  source     TEXT NOT NULL,
  ref_id     INTEGER,
  name       TEXT NOT NULL,
  category   TEXT,
  unit       TEXT,
  unit_price INTEGER NOT NULL DEFAULT 0,
  cost_price INTEGER NOT NULL DEFAULT 0,
  point_earn INTEGER NOT NULL DEFAULT 0,
  qty        INTEGER NOT NULL DEFAULT 1,
  subtotal   INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS consents (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id   INTEGER REFERENCES orders(id) ON DELETE CASCADE,
  member_id  INTEGER REFERENCES members(id),
  item_key   TEXT NOT NULL,
  item_label TEXT NOT NULL,
  required   INTEGER NOT NULL DEFAULT 1,
  agreed     INTEGER NOT NULL DEFAULT 0,
  agreed_at  TEXT,
  ip         TEXT
);

-- 결제요청: 1단계는 상태값만 관리, 2단계 지역화폐 카드 연동 시 확장
CREATE TABLE IF NOT EXISTS payment_requests (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id     INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  amount       INTEGER NOT NULL DEFAULT 0,
  status       TEXT NOT NULL DEFAULT '요청',
  method       TEXT NOT NULL DEFAULT '지역화폐카드',
  external_ref TEXT,
  approved_at  TEXT,
  created_at   TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS order_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id    INTEGER NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  from_status TEXT,
  to_status   TEXT,
  memo        TEXT,
  actor       TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS settings (
  key   TEXT PRIMARY KEY,
  value TEXT
);
`;

db.exec(SCHEMA);

/** 이미 만들어진 데이터베이스에 컬럼을 더한다(있으면 건너뜀). */
function ensureColumn(table, column, definition) {
  const exists = db.prepare(`PRAGMA table_info(${table})`).all().some((c) => c.name === column);
  if (!exists) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
}

// 돌봄서비스 원가(인건비·자재비 등) — 정산 마진 계산용
ensureColumn('menu_items', 'cost_price', 'INTEGER NOT NULL DEFAULT 0');
// 취소 위약금(당일 취소 50% 부과 규정) 기록
ensureColumn('orders', 'cancel_fee', 'INTEGER NOT NULL DEFAULT 0');
ensureColumn('orders', 'refund_type', 'TEXT');
// 서비스 희망일 — 취소 시 24시간 전/당일 자동 판정과 방문 일정 관리에 쓴다
ensureColumn('orders', 'service_date', 'TEXT');
ensureColumn('orders', 'service_time', 'TEXT');
// 처리 이력에 담당자를 남긴다
ensureColumn('order_logs', 'actor', 'TEXT');

// 운영자 계정 · 감사 기록
db.exec(`
CREATE TABLE IF NOT EXISTS admin_users (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  login_id      TEXT NOT NULL UNIQUE,
  name          TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT '담당자',
  phone         TEXT,
  password_hash TEXT NOT NULL,
  password_salt TEXT NOT NULL,
  active        INTEGER NOT NULL DEFAULT 1,
  must_change   INTEGER NOT NULL DEFAULT 0,
  last_login_at TEXT,
  created_at    TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);

CREATE TABLE IF NOT EXISTS audit_logs (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id    INTEGER,
  actor_name  TEXT,
  action      TEXT NOT NULL,
  target      TEXT,
  detail      TEXT,
  ip          TEXT,
  created_at  TEXT NOT NULL DEFAULT (datetime('now','localtime'))
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_logs(created_at);
`);

function get(sql, ...params) {
  return db.prepare(sql).get(...params);
}
function all(sql, ...params) {
  return db.prepare(sql).all(...params);
}
function run(sql, ...params) {
  return db.prepare(sql).run(...params);
}
function tx(fn) {
  db.exec('BEGIN');
  try {
    const result = fn();
    db.exec('COMMIT');
    return result;
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}
function setting(key, fallback = null) {
  const row = get('SELECT value FROM settings WHERE key = ?', key);
  return row ? row.value : fallback;
}
function setSetting(key, value) {
  run('INSERT INTO settings(key, value) VALUES(?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value', key, String(value));
}

module.exports = { db, get, all, run, tx, setting, setSetting, DB_PATH };
