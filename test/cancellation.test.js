import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../lib/database.js';
import { LabService } from '../lib/service.js';
import { openChain } from '../lib/chain.js';

test('Mahasiswa membatalkan sebelum penerimaan, bukti lama tetap utuh dan unit bebas lagi', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'labpass-cancel-'));
  const db = openDatabase(':memory:');
  const chain = await openChain(directory, { memory: true, users: db.prepare('SELECT id,role FROM users').all() });
  const service = new LabService(db, directory, chain);
  t.after(async () => {
    await chain.close();
    db.close();
    if (path.dirname(directory) === path.resolve(os.tmpdir()) && path.basename(directory).startsWith('labpass-cancel-')) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
  const student = db.prepare("SELECT * FROM users WHERE id='mhs-1'").get();
  const other = db.prepare("SELECT * FROM users WHERE id='mhs-2'").get();
  const staff = db.prepare("SELECT * FROM users WHERE id='staff-pkl'").get();
  const application = { asset_id: 'LP-RL-001', purpose: 'Uji pembatalan', lecturer: 'Dosen Demo', start_date: '2026-11-16', due_date: '2026-11-17' };
  const checklist = { condition: 'Baik', components: service.asset(application.asset_id).components.map(item => ({ id: item.id, received: item.quantity })) };
  const loan = service.createLoan(student, application);
  service.action(loan.id, staff, 'approve');
  service.action(loan.id, staff, 'handover', checklist);
  await service.flushEvidence();
  const prior = service.detail(loan.id, student).events.find(event => event.type === 'handover');
  const archived = service.proof(prior.evidence_id, student);
  assert.throws(() => service.action(loan.id, other, 'cancel'), { status: 403 });
  assert.throws(() => service.action(loan.id, staff, 'cancel'), { status: 403 });
  const cancelled = service.action(loan.id, student, 'cancel');
  assert.equal(cancelled.loan.status, 'CANCELLED');
  assert.equal(cancelled.asset.status, 'AVAILABLE');
  assert.equal(JSON.parse(cancelled.loan.checkout_json).condition, 'Baik');
  assert.throws(() => service.action(loan.id, student, 'confirm-pickup'), { status: 409 });
  await service.flushEvidence();
  assert.equal(service.proof(prior.evidence_id, student).payload_json, archived.payload_json);
  assert.ok((await service.verify(prior.evidence_id, student)).chainMatches);
  const cancellation = service.detail(loan.id, student).events.find(event => event.type === 'cancel');
  assert.ok(cancellation.tx_hash);
  assert.ok((await service.verify(cancellation.evidence_id, student)).chainMatches);
  const next = service.createLoan(other, application);
  service.action(next.id, staff, 'approve');
  service.action(next.id, staff, 'handover', checklist);
  service.action(next.id, other, 'confirm-pickup');
  assert.throws(() => service.action(next.id, other, 'cancel'), { status: 409 });
  assert.equal(service.asset(application.asset_id).status, 'BORROWED');
});
