'use strict';

/**
 * 1단계 인증: 단일 관리자 비밀번호 + 서버 메모리 세션.
 * 2단계에서 다중 계정·권한 분리로 확장할 수 있도록 함수 단위를 분리해 둔다.
 */

const crypto = require('node:crypto');
const { HttpError, parseCookies, setCookie, randomToken } = require('./http');

const COOKIE = 'care_admin';
const TTL_MS = 1000 * 60 * 60 * 8; // 8시간
const sessions = new Map();

function adminPassword() {
  return process.env.ADMIN_PASSWORD || 'boseong2026';
}

/**
 * 로그인 시도 제한 — 비밀번호가 하나뿐이므로 무차별 대입을 막아야 한다.
 * 같은 IP 에서 10분 안에 5회 실패하면 10분간 잠근다.
 */
const MAX_ATTEMPTS = 5;
const WINDOW_MS = 10 * 60 * 1000;
const attempts = new Map();

function throttleKey(req) {
  const fwd = req.headers['x-forwarded-for'];
  if (typeof fwd === 'string' && fwd.length) return fwd.split(',')[0].trim();
  return req.socket.remoteAddress || 'unknown';
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

function clearThrottle(req) {
  attempts.delete(throttleKey(req));
}

function safeEqual(a, b) {
  const ba = Buffer.from(String(a));
  const bb = Buffer.from(String(b));
  if (ba.length !== bb.length) return false;
  return crypto.timingSafeEqual(ba, bb);
}

function login(res, password, req) {
  if (req) checkThrottle(req);
  if (!safeEqual(password || '', adminPassword())) {
    if (req) recordFailure(req);
    throw new HttpError(401, '비밀번호가 일치하지 않습니다.');
  }
  if (req) clearThrottle(req);
  const token = randomToken();
  sessions.set(token, { createdAt: Date.now() });
  setCookie(res, COOKIE, token, { maxAge: Math.floor(TTL_MS / 1000), secure: process.env.SECURE_COOKIE === '1' });
  return token;
}

function logout(req, res) {
  const token = parseCookies(req)[COOKIE];
  if (token) sessions.delete(token);
  setCookie(res, COOKIE, '', { maxAge: 0 });
}

function currentSession(req) {
  const token = parseCookies(req)[COOKIE];
  if (!token) return null;
  const sess = sessions.get(token);
  if (!sess) return null;
  if (Date.now() - sess.createdAt > TTL_MS) {
    sessions.delete(token);
    return null;
  }
  return sess;
}

function requireAdmin(req) {
  if (!currentSession(req)) throw new HttpError(401, '관리자 로그인이 필요합니다.');
  return true;
}

module.exports = { login, logout, currentSession, requireAdmin, COOKIE };
