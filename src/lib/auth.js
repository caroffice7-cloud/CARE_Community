'use strict';

/**
 * 운영자 인증 — 담당자별 계정.
 *
 * 역할
 *   총괄   : 모든 기능 + 계정 관리 + 설정 · 단가 변경
 *   담당자 : 접수 처리, 회원 관리, 카톡 접수, 정산 조회 (설정 · 단가 · 계정 관리 불가)
 *
 * 처음 실행하면 환경변수 ADMIN_PASSWORD 로 총괄 계정 'admin' 이 자동 생성됩니다.
 * 비밀번호를 모두 잊었다면 ADMIN_RESET=1 로 서버를 한 번 켜면 'admin' 계정이
 * ADMIN_PASSWORD 값으로 초기화됩니다.
 */

const crypto = require('node:crypto');
const { get, all, run } = require('../db');
const { HttpError, parseCookies, setCookie, randomToken, clientIp } = require('./http');

const COOKIE = 'care_admin';
const TTL_MS = 1000 * 60 * 60 * 8; // 8시간
const ROLES = ['총괄', '담당자'];
const sessions = new Map();

// ── 비밀번호 ──
function hashPassword(password, salt = crypto.randomBytes(16).toString('hex')) {
  return { hash: crypto.scryptSync(String(password), salt, 64).toString('hex'), salt };
}

function verifyPassword(password, hash, salt) {
  if (!hash || !salt) return false;
  const candidate = crypto.scryptSync(String(password), salt, 64);
  const expected = Buffer.from(hash, 'hex');
  if (candidate.length !== expected.length) return false;
  return crypto.timingSafeEqual(candidate, expected);
}

// ── 최초 계정 준비 ──
function bootstrap() {
  const envPassword = process.env.ADMIN_PASSWORD || 'boseong2026';
  const existing = get("SELECT * FROM admin_users WHERE login_id = 'admin'");

  if (!existing) {
    const { hash, salt } = hashPassword(envPassword);
    run(
      `INSERT INTO admin_users(login_id, name, role, password_hash, password_salt, must_change)
       VALUES('admin', '기본 관리자', '총괄', ?, ?, 1)`,
      hash, salt
    );
    console.log("  · 운영자 계정 'admin'(총괄)을 만들었습니다. 첫 로그인 후 비밀번호를 바꿔 주세요.");
    return;
  }

  if (process.env.ADMIN_RESET === '1') {
    const { hash, salt } = hashPassword(envPassword);
    run("UPDATE admin_users SET password_hash = ?, password_salt = ?, active = 1, must_change = 1 WHERE login_id = 'admin'", hash, salt);
    console.log("  · ADMIN_RESET=1 → 'admin' 계정 비밀번호를 ADMIN_PASSWORD 값으로 되돌렸습니다.");
  }
}

// ── 로그인 시도 제한 ──
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 10 * 60 * 1000;
const attempts = new Map();

function throttleKey(req) {
  return clientIp(req) || 'unknown';
}

function checkThrottle(req) {
  const key = throttleKey(req);
  const rec = attempts.get(key);
  if (!rec) return;
  if (Date.now() - rec.first > WINDOW_MS) { attempts.delete(key); return; }
  if (rec.count >= MAX_ATTEMPTS) {
    const wait = Math.ceil((WINDOW_MS - (Date.now() - rec.first)) / 60000);
    throw new HttpError(429, `로그인 시도가 너무 많습니다. ${wait}분 후에 다시 시도해 주세요.`);
  }
}

function recordFailure(req) {
  const key = throttleKey(req);
  const rec = attempts.get(key);
  if (!rec || Date.now() - rec.first > WINDOW_MS) attempts.set(key, { count: 1, first: Date.now() });
  else rec.count += 1;
}

// ── 세션 ──
function publicUser(u) {
  return { id: u.id, loginId: u.login_id, name: u.name, role: u.role, phone: u.phone, mustChange: !!u.must_change };
}

function login(res, loginId, password, req) {
  if (req) checkThrottle(req);
  const user = get('SELECT * FROM admin_users WHERE login_id = ? AND active = 1', String(loginId || '').trim());
  if (!user || !verifyPassword(password, user.password_hash, user.password_salt)) {
    if (req) recordFailure(req);
    throw new HttpError(401, '아이디 또는 비밀번호가 올바르지 않습니다.');
  }
  attempts.delete(throttleKey(req || { headers: {}, socket: {} }));

  const token = randomToken();
  sessions.set(token, { userId: user.id, createdAt: Date.now() });
  setCookie(res, COOKIE, token, { maxAge: Math.floor(TTL_MS / 1000), secure: process.env.SECURE_COOKIE === '1' });
  run("UPDATE admin_users SET last_login_at = datetime('now','localtime') WHERE id = ?", user.id);
  return publicUser(user);
}

function logout(req, res) {
  const token = parseCookies(req)[COOKIE];
  if (token) sessions.delete(token);
  setCookie(res, COOKIE, '', { maxAge: 0 });
}

function currentUser(req) {
  const token = parseCookies(req)[COOKIE];
  const sess = token ? sessions.get(token) : null;
  if (!sess) return null;
  if (Date.now() - sess.createdAt > TTL_MS) { sessions.delete(token); return null; }
  const user = get('SELECT * FROM admin_users WHERE id = ? AND active = 1', sess.userId);
  if (!user) { sessions.delete(token); return null; }
  return user;
}

/** 로그인한 운영자를 돌려준다. 없으면 401. */
function requireAdmin(req) {
  const user = currentUser(req);
  if (!user) throw new HttpError(401, '관리자 로그인이 필요합니다.');
  return user;
}

/** 총괄만 할 수 있는 작업 */
function requireOwner(req) {
  const user = requireAdmin(req);
  if (user.role !== '총괄') {
    throw new HttpError(403, '총괄 관리자만 할 수 있는 작업입니다. 담당자 권한으로는 변경할 수 없습니다.');
  }
  return user;
}

/** 해당 계정의 모든 세션을 끊는다(비활성화·비밀번호 변경 시) */
function revokeSessions(userId) {
  for (const [token, sess] of sessions) if (sess.userId === userId) sessions.delete(token);
}

// ── 감사 기록 ──
function audit(req, user, action, target, detail) {
  run(
    'INSERT INTO audit_logs(actor_id, actor_name, action, target, detail, ip) VALUES(?,?,?,?,?,?)',
    user ? user.id : null, user ? user.name : null, action, target || null, detail || null, clientIp(req)
  );
}

module.exports = {
  ROLES, bootstrap, hashPassword, verifyPassword, publicUser,
  login, logout, currentUser, requireAdmin, requireOwner, revokeSessions, audit,
};
