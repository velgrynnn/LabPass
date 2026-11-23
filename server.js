import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { openDatabase, passwordMatches } from './lib/database.js';
import { LabService, AppError, REJECTION_SCENARIOS } from './lib/service.js';
import { openChain } from './lib/chain.js';
import { acquireStoreLock } from './lib/store-lock.js';

const root = path.dirname(fileURLToPath(import.meta.url));
const dataDir = process.env.LABPASS_DATA_DIR || path.join(root, 'data');
fs.mkdirSync(dataDir, { recursive: true });
const releaseStore = acquireStoreLock(dataDir);
process.once('exit', releaseStore);
const db = openDatabase(path.join(dataDir, 'labpass.sqlite'));

let chain = null;
let chainError = null;
try {
  chain = await openChain(dataDir, { users: db.prepare('SELECT id,role FROM users').all() });
} catch (error) {
  chainError = error.message;
  console.error('Blockchain lokal belum tersedia:', error.message);
}
const service = new LabService(db, dataDir, chain);
const sessions = new Map();
const attempts = new Map();
const port = Number(process.env.PORT || 8787);
const demoShortcuts = process.env.LABPASS_DEMO_SHORTCUTS === '1';

function json(res, status, data, headers = {}) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store', ...headers });
  res.end(JSON.stringify(data));
}

async function body(req) {
  let size = 0;
  const chunks = [];
  for await (const chunk of req) {
    size += chunk.length;
    if (size > 4500000) throw new AppError('Permintaan terlalu besar.', 413);
    chunks.push(chunk);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString() || '{}');
  } catch {
    throw new AppError('Format JSON tidak valid.');
  }
}

function session(req) {
  const token = (req.headers.cookie || '').split(';').map(part => part.trim()).find(part => part.startsWith('labpass='))?.slice(8);
  const active = token && sessions.get(token);
  if (!active || active.expires < Date.now()) throw new AppError('Silakan masuk kembali.', 401);
  return { token, user: db.prepare('SELECT * FROM users WHERE id=?').get(active.userId) };
}

const me = user => ({ ...service.publicUser(user), wallet: chain?.walletOf(user.id) || null });

// Detail peminjaman + status menurut kontrak, agar UI bisa membandingkan database dan chain.
async function fullDetail(id, user) {
  const detail = service.detail(id, user);
  try {
    detail.chainState = await service.chainState(id, user);
  } catch (error) {
    detail.chainState = { available: false, error: error.message };
  }
  return detail;
}

const server = http.createServer(async (req, res) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'");
  try {
    const url = new URL(req.url, `http://127.0.0.1:${port}`);
    const route = url.pathname;
    if (['POST', 'PUT', 'DELETE', 'PATCH'].includes(req.method) && req.headers.origin && req.headers.origin !== `http://${req.headers.host}`) {
      throw new AppError('Origin tidak diizinkan.', 403);
    }

    if (route === '/api/login' && req.method === 'POST') {
      const input = await body(req);
      const key = String(input.id || '').trim().slice(0, 80);
      const trial = attempts.get(key);
      if (trial && trial.until > Date.now() && trial.count >= 10) throw new AppError('Terlalu banyak percobaan. Tunggu satu menit.', 429);
      const user = db.prepare('SELECT * FROM users WHERE id=?').get(key);
      if (!user || typeof input.password !== 'string' || input.password.length > 100 || !passwordMatches(input.password, user.password_hash)) {
        const old = trial && trial.until > Date.now() ? trial : { count: 0, until: Date.now() + 60000 };
        attempts.set(key, { ...old, count: old.count + 1 });
        throw new AppError('Akun atau kata sandi salah.', 401);
      }
      attempts.delete(key);
      const token = randomBytes(32).toString('hex');
      sessions.set(token, { userId: user.id, expires: Date.now() + 8 * 60 * 60 * 1000 });
      return json(res, 200, { user: me(user) }, { 'Set-Cookie': `labpass=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800` });
    }

    if (route === '/api/demo-accounts' && req.method === 'GET') {
      return json(res, 200, {
        demoShortcuts,
        accounts: demoShortcuts ? db.prepare('SELECT id,name,role FROM users ORDER BY role,id').all() : [],
        warning: 'Akun simulasi untuk penggunaan lokal.'
      });
    }

    if (route.startsWith('/api/')) {
      const { user, token } = session(req);
      let match;

      if (route === '/api/me') return json(res, 200, { user: me(user) });
      if (route === '/api/logout' && req.method === 'POST') {
        sessions.delete(token);
        return json(res, 200, { ok: true }, { 'Set-Cookie': 'labpass=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0' });
      }
      if (route === '/api/health') {
        const names = Object.fromEntries(db.prepare('SELECT id,name,role FROM users').all().map(item => [item.id, item]));
        return json(res, 200, {
          database: 'sqlite',
          chain: chain
            ? { ...chain.metadata, status: 'CONNECTED', wallets: Object.entries(chain.metadata.wallets).map(([id, address]) => ({ id, address, name: names[id]?.name, role: names[id]?.role })) }
            : { mode: 'unavailable', status: 'FAILED', error: chainError },
          trustModel: 'custodial-wallet-per-akun',
          scenarios: REJECTION_SCENARIOS,
          pending: service.pendingCount()
        });
      }
      if (route === '/api/assets' && req.method === 'GET') return json(res, 200, { assets: service.listAssets() });
      if ((match = route.match(/^\/api\/assets\/([^/]+)\/chain-history$/)) && req.method === 'GET') {
        return json(res, 200, await service.assetHistory(match[1]));
      }
      if ((match = route.match(/^\/api\/assets\/([^/]+)\/release$/)) && req.method === 'POST') {
        const asset = service.releaseAsset(match[1], user);
        await service.flushEvidence();
        return json(res, 200, { asset });
      }
      if (route === '/api/loans' && req.method === 'GET') return json(res, 200, { loans: service.listLoans(user) });
      if (route === '/api/loans' && req.method === 'POST') {
        const loan = service.createLoan(user, await body(req));
        await service.flushEvidence();
        return json(res, 201, { loan });
      }
      if ((match = route.match(/^\/api\/loans\/([^/]+)$/)) && req.method === 'GET') return json(res, 200, await fullDetail(match[1], user));
      if ((match = route.match(/^\/api\/loans\/([^/]+)\/actions\/([a-z-]+)$/)) && req.method === 'POST') {
        const detail = service.action(match[1], user, match[2], await body(req));
        await service.flushEvidence();
        return json(res, 200, await fullDetail(detail.loan.id, user));
      }
      if ((match = route.match(/^\/api\/loans\/([^/]+)\/attachments$/)) && req.method === 'POST') {
        return json(res, 201, service.addAttachment(match[1], user, await body(req)));
      }
      if ((match = route.match(/^\/api\/evidence\/([^/]+)\/verify$/)) && req.method === 'POST') {
        const input = await body(req);
        return json(res, 200, await service.verify(match[1], user, input.candidate ?? null));
      }
      if ((match = route.match(/^\/api\/evidence\/([^/]+)\/download$/)) && req.method === 'GET') {
        const proof = service.proof(match[1], user);
        res.setHeader('Content-Disposition', `attachment; filename="${proof.id}.json"`);
        return json(res, 200, JSON.parse(proof.payload_json));
      }
      if (route === '/api/evidence/retry' && req.method === 'POST') {
        service.checkRole(user, 'staff');
        await service.flushEvidence();
        return json(res, 200, { ok: true });
      }
      if (route === '/api/chain/rejection-test' && req.method === 'POST') {
        const input = await body(req);
        const result = await service.rejectionTest(user, String(input.scenario || ''), input.loanId ? String(input.loanId) : null);
        console.log(`Uji penolakan ${result.scenario}: ${result.error}, tx ${result.txHash}, status ${result.status}`);
        return json(res, 200, result);
      }
      if ((match = route.match(/^\/api\/attachments\/([^/]+)$/)) && req.method === 'GET') {
        const file = db.prepare('SELECT * FROM attachments WHERE id=?').get(match[1]);
        if (!file) throw new AppError('Foto tidak ditemukan.', 404);
        service.loan(file.loan_id, user);
        const data = fs.readFileSync(path.join(dataDir, file.relative_path));
        res.writeHead(200, { 'Content-Type': file.mime, 'Cache-Control': 'no-store' });
        return res.end(data);
      }
      throw new AppError('Endpoint tidak ditemukan.', 404);
    }

    if (req.method !== 'GET') throw new AppError('Metode tidak diizinkan.', 405);
    const files = { '/': 'index.html', '/app.js': 'app.js', '/style.css': 'style.css' };
    const file = files[route];
    if (!file) throw new AppError('Halaman tidak ditemukan.', 404);
    const type = file.endsWith('.js') ? 'text/javascript; charset=utf-8' : file.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8';
    res.writeHead(200, { 'Content-Type': type, 'Cache-Control': 'no-cache' });
    res.end(fs.readFileSync(path.join(root, 'public', file)));
  } catch (error) {
    if (res.headersSent) {
      res.end();
      return;
    }
    json(res, error.status || 500, { error: error instanceof AppError ? error.message : 'Terjadi kesalahan server. Coba lagi.' });
    if (!(error instanceof AppError)) console.error(error);
  }
});

await service.flushEvidence();
server.listen(port, '127.0.0.1', () => {
  console.log(`LabPass siap: http://127.0.0.1:${port}`);
  console.log(`Database SQLite aktif. Blockchain: ${chain ? `Ethereum lokal, chain ID 1337, kontrak v${chain.metadata.version} ${chain.metadata.address}` : 'belum tersedia (bukan simulasi sukses)'}.`);
  if (chain?.metadata.legacy?.length) console.log(`Kontrak lama tetap dibaca untuk bukti sebelumnya: ${chain.metadata.legacy.map(item => item.address).join(', ')}`);
  console.log('Gunakan ID akun dan kata sandi pada README untuk masuk.');
});

async function close() {
  server.close();
  if (chain) await chain.close();
  db.close();
  process.exit(0);
}
process.on('SIGINT', close);
process.on('SIGTERM', close);
