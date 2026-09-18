'use strict';

/**
 * 보성군 지역화폐 기반 통합돌봄 주문관리 시스템 — 서버 진입점
 * 외부 의존성 없이 Node.js 표준 모듈(node:http, node:sqlite)만 사용한다.
 *   실행: npm start
 */

const http = require('node:http');
const path = require('node:path');
const fs = require('node:fs');
const fsp = require('node:fs/promises');

const { sendJson, sendText, HttpError } = require('./src/lib/http');
const publicRoutes = require('./src/routes/public');
const adminRoutes = require('./src/routes/admin');
const { seed } = require('./src/seed');
const auth = require('./src/lib/auth');

const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');

seed();        // 최초 실행 시 메뉴판·가격표 자동 적재 (이미 있으면 건너뜀)
auth.bootstrap(); // 운영자 계정 준비

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
};

async function serveStatic(req, res, pathname) {
  let rel = pathname === '/' ? '/index.html' : pathname;
  if (rel.endsWith('/')) rel += 'index.html';

  const filePath = path.join(PUBLIC_DIR, path.normalize(rel).replace(/^(\.\.[/\\])+/, ''));
  if (!filePath.startsWith(PUBLIC_DIR)) throw new HttpError(403, '접근할 수 없습니다.');

  let stat;
  try {
    stat = await fsp.stat(filePath);
  } catch {
    return false;
  }
  if (!stat.isFile()) return false;

  const ext = path.extname(filePath).toLowerCase();
  res.writeHead(200, {
    'Content-Type': MIME[ext] || 'application/octet-stream',
    'Content-Length': stat.size,
    'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=300',
  });
  fs.createReadStream(filePath).pipe(res);
  return true;
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(url.pathname);

  try {
    const match =
      publicRoutes.router.match(req.method, pathname) ||
      adminRoutes.router.match(req.method, pathname);

    if (match) {
      await match.handler(req, res, { params: match.params, query: url.searchParams, url });
      return;
    }

    if (req.method === 'GET' || req.method === 'HEAD') {
      if (pathname === '/admin' || pathname === '/admin/') {
        if (await serveStatic(req, res, '/admin.html')) return;
      }
      if (await serveStatic(req, res, pathname)) return;
    }

    if (pathname.startsWith('/api/')) {
      throw new HttpError(404, '요청하신 API 경로를 찾을 수 없습니다.');
    }
    // SPA 성격의 경로는 고객 화면으로 되돌린다.
    if (await serveStatic(req, res, '/index.html')) return;
    throw new HttpError(404, '페이지를 찾을 수 없습니다.');
  } catch (err) {
    if (res.headersSent) return;
    const status = err instanceof HttpError ? err.status : 500;
    if (status >= 500) console.error('[error]', req.method, pathname, err);
    if (pathname.startsWith('/api/')) {
      sendJson(res, status, { error: err.message || '서버 오류가 발생했습니다.', detail: err.detail });
    } else {
      sendText(res, status, err.message || '서버 오류가 발생했습니다.');
    }
  }
});

server.listen(PORT, HOST, () => {
  console.log('────────────────────────────────────────────────');
  console.log(' 보성군 지역화폐 기반 통합돌봄 주문관리 시스템');
  console.log(` 고객 화면   : http://localhost:${PORT}/`);
  console.log(` 관리자 화면 : http://localhost:${PORT}/admin`);
  console.log(` 운영자 로그인  : 아이디 admin / 비밀번호 ${process.env.ADMIN_PASSWORD ? '(환경변수 ADMIN_PASSWORD)' : 'boseong2026 (기본값 — 첫 로그인 후 변경)'}`);
  console.log('────────────────────────────────────────────────');
});

module.exports = server;
