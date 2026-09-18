'use strict';

/**
 * 홈서버 상주 실행기.
 *
 * 집·사무실 PC를 켜 두고 쓰는 것을 전제로, 배치파일이 하기 어려운 세 가지를 맡는다.
 *   1) 서버가 꺼지면 자동으로 다시 띄운다 (재시도 간격을 늘려 가며)
 *   2) 매일 정해진 시각에 데이터베이스를 안전하게 백업하고 오래된 백업은 지운다
 *   3) 무슨 일이 있었는지 로그로 남긴다
 *
 * 사용법
 *   node 홈서버/홈서버.js              상주 실행 (평소 이것만 쓰면 된다)
 *   node 홈서버/홈서버.js --backup-now  지금 즉시 백업 한 번
 *   node 홈서버/홈서버.js --status      서버가 살아 있는지 · 마지막 백업이 언제인지
 *
 * 설정은 홈서버/설정.json 에서 바꾼다. 파일이 없으면 처음 실행할 때 만들어 준다.
 */

const { spawn, spawnSync } = require('node:child_process');
const fs = require('node:fs');
const path = require('node:path');

const HOME = __dirname;
const ROOT = path.join(HOME, '..');
const CONFIG_PATH = path.join(HOME, '설정.json');
const LOG_DIR = path.join(HOME, 'logs');
const BACKUP_DIR = path.join(HOME, 'backups');

/** 이 폴더에 맞춘 기본값. 두 시스템을 한 PC에서 같이 돌리므로 포트를 다르게 둔다. */
const DEFAULTS = {
  이름: '보성군 통합돌봄 주문관리',
  포트: 4000,
  최초_운영자_비밀번호: 'boseong2026',
  백업_시각: '03:30',
  백업_보관일수: 14,
  데이터_폴더: '',
};

const pad = (n) => String(n).padStart(2, '0');
const stamp = (d = new Date()) =>
  `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`;
const today = (d = new Date()) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

function loadConfig() {
  if (!fs.existsSync(CONFIG_PATH)) {
    fs.mkdirSync(HOME, { recursive: true });
    fs.writeFileSync(CONFIG_PATH, JSON.stringify(DEFAULTS, null, 2) + '\n', 'utf8');
    console.log(`  설정 파일을 만들었습니다: ${CONFIG_PATH}`);
  }
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8'));
  } catch (err) {
    console.error(`  [주의] 설정.json 을 읽지 못해 기본값으로 실행합니다. (${err.message})`);
    raw = {};
  }
  const cfg = { ...DEFAULTS, ...raw };
  const [h, m] = String(cfg.백업_시각 || '03:30').split(':');
  cfg._백업시 = Math.min(23, Math.max(0, parseInt(h, 10) || 3));
  cfg._백업분 = Math.min(59, Math.max(0, parseInt(m, 10) || 30));
  cfg._데이터폴더 = cfg.데이터_폴더 ? path.resolve(ROOT, cfg.데이터_폴더) : path.join(ROOT, 'data');
  return cfg;
}

function log(line) {
  fs.mkdirSync(LOG_DIR, { recursive: true });
  const d = new Date();
  const file = path.join(LOG_DIR, `홈서버-${d.getFullYear()}-${pad(d.getMonth() + 1)}.log`);
  const text = `[${d.toLocaleString('ko-KR')}] ${line}`;
  console.log(text);
  try { fs.appendFileSync(file, text + '\n', 'utf8'); } catch { /* 로그 실패로 서버를 멈추지는 않는다 */ }
}

/** node:sqlite 를 옵션 없이 쓸 수 있는지 (구버전 Node 대비) */
function sqliteFlag() {
  const r = spawnSync(process.execPath, ['-e', "require('node:sqlite')"], { stdio: 'ignore' });
  return r.status === 0 ? [] : ['--experimental-sqlite'];
}

/* ── 백업 ──────────────────────────────────────────────────────────── */

/**
 * SQLite 는 서버가 쓰고 있는 중에 파일을 그냥 복사하면 깨질 수 있다.
 * VACUUM INTO 는 실행 중에도 일관된 스냅샷을 새 파일로 떠 주므로 그 방법을 쓴다.
 */
function backupDatabase(cfg, destDir) {
  const dataDir = cfg._데이터폴더;
  if (!fs.existsSync(dataDir)) return { copied: 0, note: '데이터 폴더가 아직 없습니다' };

  const dbFiles = fs.readdirSync(dataDir).filter((f) => f.endsWith('.db'));
  if (!dbFiles.length) return { copied: 0, note: '백업할 데이터베이스가 없습니다' };

  let copied = 0;
  for (const name of dbFiles) {
    const src = path.join(dataDir, name);
    const dest = path.join(destDir, name);
    try {
      const { DatabaseSync } = require('node:sqlite');
      const db = new DatabaseSync(src, { readOnly: true });
      // SQL 문자열 안에 들어가므로 홑따옴표만 이스케이프한다.
      db.exec(`VACUUM INTO '${dest.replace(/'/g, "''")}'`);
      db.close();
      copied += 1;
    } catch (err) {
      // 스냅샷이 안 되면 최후 수단으로 파일 복사라도 해 둔다.
      log(`  [주의] ${name} 스냅샷 실패 → 파일 복사로 대체합니다. (${err.message})`);
      fs.copyFileSync(src, dest);
      copied += 1;
    }
  }
  return { copied, note: '' };
}

/** 공급처가 올린 상품 사진 등, DB 밖에 있는 파일도 같이 보관한다. */
function backupUploads(destDir) {
  const src = path.join(ROOT, 'public', 'uploads');
  if (!fs.existsSync(src)) return 0;
  const dest = path.join(destDir, 'uploads');
  fs.cpSync(src, dest, { recursive: true });
  return fs.readdirSync(dest).filter((f) => f !== '.gitkeep').length;
}

function pruneBackups(keepDays) {
  if (!fs.existsSync(BACKUP_DIR)) return 0;
  const limit = Date.now() - keepDays * 24 * 60 * 60 * 1000;
  let removed = 0;
  for (const name of fs.readdirSync(BACKUP_DIR)) {
    const dir = path.join(BACKUP_DIR, name);
    let st;
    try { st = fs.statSync(dir); } catch { continue; }
    if (!st.isDirectory()) continue;
    if (st.mtimeMs < limit) {
      fs.rmSync(dir, { recursive: true, force: true });
      removed += 1;
    }
  }
  return removed;
}

function runBackup(cfg) {
  const destDir = path.join(BACKUP_DIR, stamp());
  fs.mkdirSync(destDir, { recursive: true });
  const { copied, note } = backupDatabase(cfg, destDir);
  const photos = backupUploads(destDir);
  const removed = pruneBackups(cfg.백업_보관일수);

  if (!copied && note) {
    fs.rmSync(destDir, { recursive: true, force: true });
    log(`백업 건너뜀 — ${note}`);
    return null;
  }
  const parts = [`데이터베이스 ${copied}개`];
  if (photos) parts.push(`사진 ${photos}장`);
  if (removed) parts.push(`오래된 백업 ${removed}건 삭제`);
  log(`백업 완료 → 홈서버/backups/${path.basename(destDir)} (${parts.join(' · ')})`);
  return destDir;
}

function lastBackup() {
  if (!fs.existsSync(BACKUP_DIR)) return null;
  const dirs = fs.readdirSync(BACKUP_DIR)
    .map((n) => ({ n, p: path.join(BACKUP_DIR, n) }))
    .filter((x) => { try { return fs.statSync(x.p).isDirectory(); } catch { return false; } })
    .sort((a, b) => fs.statSync(b.p).mtimeMs - fs.statSync(a.p).mtimeMs);
  return dirs[0] ? dirs[0].n : null;
}

/* ── 서버 상주 실행 ────────────────────────────────────────────────── */

function startLoop(cfg) {
  const flag = sqliteFlag();
  let stopping = false;
  let child = null;
  let delay = 3000;          // 재시작 대기 (실패가 이어지면 늘린다)
  let startedAt = 0;
  let backupDoneOn = null;   // 같은 날 두 번 백업하지 않도록

  function launch() {
    startedAt = Date.now();
    child = spawn(process.execPath, [...flag, 'server.js'], {
      cwd: ROOT,
      env: {
        ...process.env,
        PORT: String(cfg.포트),
        DATA_DIR: cfg._데이터폴더,
        ADMIN_PASSWORD: process.env.ADMIN_PASSWORD || cfg.최초_운영자_비밀번호,
      },
      stdio: ['ignore', 'inherit', 'inherit'],
    });

    child.on('exit', (code, signal) => {
      if (stopping) return;
      const lived = Date.now() - startedAt;
      // 한동안 잘 돌았다면 일시적인 문제로 보고 대기시간을 초기화한다.
      if (lived > 60_000) delay = 3000;
      log(`서버가 멈췄습니다 (code=${code} signal=${signal}). ${Math.round(delay / 1000)}초 뒤 다시 켭니다.`);
      setTimeout(launch, delay);
      delay = Math.min(delay * 2, 60_000);
    });

    child.on('error', (err) => log(`  [오류] 서버를 띄우지 못했습니다: ${err.message}`));
  }

  function stop(why) {
    if (stopping) return;
    stopping = true;
    log(`홈서버를 종료합니다. (${why})`);
    if (child) child.kill();
    setTimeout(() => process.exit(0), 500);
  }

  process.on('SIGINT', () => stop('Ctrl+C'));
  process.on('SIGTERM', () => stop('시스템 종료'));

  // 1분마다 백업 시각인지 확인한다.
  setInterval(() => {
    const now = new Date();
    if (now.getHours() !== cfg._백업시 || now.getMinutes() !== cfg._백업분) return;
    const day = today(now);
    if (backupDoneOn === day) return;
    backupDoneOn = day;
    try { runBackup(cfg); } catch (err) { log(`  [오류] 백업 실패: ${err.message}`); }
  }, 60_000);

  log(`홈서버 시작 — ${cfg.이름} · 포트 ${cfg.포트} · 매일 ${pad(cfg._백업시)}:${pad(cfg._백업분)} 자동 백업 (${cfg.백업_보관일수}일 보관)`);
  console.log('');
  console.log(`  이 PC에서      http://localhost:${cfg.포트}/`);
  console.log(`  같은 인터넷에서 http://<이 PC의 내부 IP>:${cfg.포트}/`);
  console.log('');
  console.log('  === 이 창을 닫으면 서버가 꺼집니다 ===');
  console.log('');
  launch();
}

/* ── 상태 확인 ─────────────────────────────────────────────────────── */

async function showStatus(cfg) {
  console.log('');
  console.log(`  ${cfg.이름}`);
  console.log(`  포트        ${cfg.포트}`);
  console.log(`  데이터 폴더 ${cfg._데이터폴더}`);

  let alive = false;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 2500);
    const res = await fetch(`http://127.0.0.1:${cfg.포트}/`, { signal: ctrl.signal });
    clearTimeout(timer);
    alive = res.ok || res.status < 500;
  } catch { alive = false; }
  console.log(`  서버 상태   ${alive ? '켜져 있음' : '꺼져 있음'}`);

  const last = lastBackup();
  console.log(`  마지막 백업 ${last || '아직 없음'}`);
  if (fs.existsSync(BACKUP_DIR)) {
    const n = fs.readdirSync(BACKUP_DIR).length;
    console.log(`  보관 중     ${n}건`);
  }
  console.log('');
}

/* ── 진입점 ────────────────────────────────────────────────────────── */

const cfg = loadConfig();
const arg = process.argv[2];

if (arg === '--backup-now') {
  runBackup(cfg);
} else if (arg === '--status') {
  showStatus(cfg);
} else {
  startLoop(cfg);
}
