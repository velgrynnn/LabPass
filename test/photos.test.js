import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../lib/database.js';
import { LabService, digest } from '../lib/service.js';
import { openChain } from '../lib/chain.js';

test('Foto per tahap masuk bukti yang sesuai dan terkunci selama konfirmasi', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'labpass-photos-'));
  const db = openDatabase(':memory:');
  const chain = await openChain(directory, { memory: true });
  const service = new LabService(db, directory, chain);
  t.after(async () => {
    await chain.close();
    db.close();
    if (path.dirname(directory) === path.resolve(os.tmpdir()) && path.basename(directory).startsWith('labpass-photos-')) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
  const student = db.prepare("SELECT * FROM users WHERE id='mhs-1'").get();
  const staff = db.prepare("SELECT * FROM users WHERE id='staff-zaenal'").get();
  const body = { asset_id: 'LP-RL-001', purpose: 'Uji foto per tahap', lecturer: 'Dosen Demo', start_date: '2026-11-16', due_date: '2026-11-17' };
  const loan = service.createLoan(student, body);
  const file = { filename: 'dummy.png', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jr9sAAAAASUVORK5CYII=' };
  const checklist = { condition: 'Baik', components: service.asset(body.asset_id).components.map(item => ({ id: item.id, received: item.quantity })) };
  const photo = service.addAttachment(loan.id, student, file);
  assert.equal(photo.stage, 'CHECKOUT');
  service.action(loan.id, staff, 'approve');
  service.action(loan.id, staff, 'handover', checklist);
  assert.throws(() => service.addAttachment(loan.id, staff, file), { status: 409 });
  service.action(loan.id, student, 'confirm-pickup');
  const checkout = db.prepare("SELECT p.* FROM evidence_records p JOIN loan_events e ON e.id=p.event_id WHERE e.loan_id=? AND e.type='handover'").get(loan.id);
  const initialPayload = checkout.payload_json;
  assert.deepEqual(JSON.parse(initialPayload).attachments.map(item => item.id), [photo.id]);
  assert.throws(() => service.addAttachment(loan.id, staff, { ...file, stage: 'CHECKOUT' }), { status: 409 });
  const returnedPhoto = service.addAttachment(loan.id, student, { ...file, stage: 'RETURN' });
  service.action(loan.id, student, 'request-return');
  service.action(loan.id, staff, 'inspect-return', checklist);
  assert.throws(() => service.addAttachment(loan.id, student, file), { status: 409 });
  service.action(loan.id, student, 'confirm-return');
  await service.flushEvidence();
  for (const event of service.detail(loan.id, student).events.filter(event => event.evidence_id)) {
    const stored = service.proof(event.evidence_id, student);
    const payload = JSON.parse(stored.payload_json);
    const expected = ['handover', 'confirm-pickup'].includes(event.type) ? photo.id : returnedPhoto.id;
    assert.deepEqual(payload.attachments.map(item => item.id), [expected]);
    assert.ok(event.tx_hash);
    const verification = await service.verify(event.evidence_id, student);
    assert.ok(verification.chainMatches && verification.archiveMatches && verification.files[0].matches);
  }
  assert.equal(db.prepare('SELECT payload_json FROM evidence_records WHERE id=?').get(checkout.id).payload_json, initialPayload);
  assert.equal(digest(initialPayload), checkout.digest);
  assert.deepEqual(service.detail(loan.id, student).attachments.map(item => item.stage), ['CHECKOUT', 'RETURN']);
});

test('Database lama mendapat label LEGACY tanpa menulis ulang bukti dan arsip', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'labpass-migration-'));
  const filename = path.join(directory, 'legacy.sqlite');
  let db = openDatabase(filename);
  t.after(() => {
    db.close();
    if (path.dirname(directory) === path.resolve(os.tmpdir()) && path.basename(directory).startsWith('labpass-migration-')) {
      fs.rmSync(directory, { recursive: true, force: true });
    }
  });
  const service = new LabService(db, directory, null);
  const student = db.prepare("SELECT * FROM users WHERE id='mhs-1'").get();
  const loan = service.createLoan(student, { asset_id: 'LP-RL-001', purpose: 'Data lama', lecturer: 'Dosen Demo', start_date: '2026-11-09', due_date: '2026-11-10' });
  const photo = service.addAttachment(loan.id, student, { filename: 'legacy.png', base64: 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jr9sAAAAASUVORK5CYII=' });
  const event = db.prepare('SELECT id FROM loan_events WHERE loan_id=? LIMIT 1').get(loan.id);
  const payload = JSON.stringify({ schema: 'labpass-evidence-v1', attachments: [{ id: photo.id, filename: photo.filename, digest: photo.digest }] });
  fs.writeFileSync(path.join(directory, 'archives', 'old.json'), payload);
  db.prepare('INSERT INTO evidence_records(id,event_id,payload_json,digest,archive_path) VALUES(?,?,?,?,?)').run('old-proof', event.id, payload, digest(payload), 'archives/old.json');
  db.exec('ALTER TABLE attachments DROP COLUMN stage');
  db.close();
  db = openDatabase(filename);
  assert.equal(db.prepare('SELECT stage FROM attachments WHERE id=?').get(photo.id).stage, 'LEGACY');
  assert.equal(db.prepare('SELECT payload_json FROM evidence_records WHERE id=?').get('old-proof').payload_json, payload);
  assert.equal(fs.readFileSync(path.join(directory, 'archives', 'old.json'), 'utf8'), payload);
  db.close();
  db = openDatabase(filename);
  assert.equal(db.prepare('PRAGMA table_info(attachments)').all().filter(column => column.name === 'stage').length, 1);
});
