import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import net from 'node:net';
import { once } from 'node:events';
import { resetDemo } from '../lib/reset-demo.js';
import { acquireStoreLock } from '../lib/store-lock.js';

test('Reset menolak server aktif dan menyimpan seluruh data demo sebagai satu cadangan', async t => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'labpass-reset-'));
  t.after(() => {
    if (path.dirname(root) === path.resolve(os.tmpdir()) && path.basename(root).startsWith('labpass-reset-')) {
      fs.rmSync(root, { recursive: true, force: true });
    }
  });
  const data = path.join(root, 'data');
  fs.mkdirSync(path.join(data, 'archives'), { recursive: true });
  fs.mkdirSync(path.join(data, 'uploads'));
  fs.mkdirSync(path.join(data, 'chain'));
  const sample = {
    'labpass.sqlite': 'dummy-database',
    'wallet-seed.json': '{"seed":"dummy-seed"}',
    'contract.json': '{"address":"dummy-address"}',
    'archives/proof.json': '{"proof":"dummy-proof"}',
    'uploads/photo.png': 'dummy-photo',
    'chain/ledger': 'dummy-blocks'
  };
  for (const [name, value] of Object.entries(sample)) fs.writeFileSync(path.join(data, name), value);
  const release = acquireStoreLock(data);
  await assert.rejects(resetDemo(root), /sedang digunakan/);
  assert.throws(() => acquireStoreLock(data), /sedang digunakan/);
  release();
  const server = net.createServer();
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const port = server.address().port;
  try { await assert.rejects(resetDemo(root, port), /masih aktif/); }
  finally { await new Promise(resolve => server.close(resolve)); }
  assert.ok(fs.existsSync(data));
  const result = await resetDemo(root, port);
  assert.equal(path.dirname(result.backupPath), path.join(root, 'backups'));
  assert.equal(fs.existsSync(data), false);
  assert.equal(fs.existsSync(data + '.lock'), false);
  for (const [name, value] of Object.entries(sample)) assert.equal(fs.readFileSync(path.join(result.backupPath, name), 'utf8'), value);
  assert.equal((await resetDemo(root, port)).backupPath, null);
});
