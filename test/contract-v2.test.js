import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../lib/database.js';
import { LabService } from '../lib/service.js';
import { openChain, idKey, proofKey, revertReason } from '../lib/chain.js';

async function setup(t, prefix) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), prefix));
  const db = openDatabase(':memory:');
  const chain = await openChain(dir, { memory: true, users: db.prepare('SELECT id,role FROM users').all() });
  const service = new LabService(db, dir, chain);
  t.after(async () => {
    await chain.close();
    db.close();
    if (path.basename(dir).startsWith(prefix)) fs.rmSync(dir, { recursive: true, force: true });
  });
  const user = id => db.prepare('SELECT * FROM users WHERE id=?').get(id);
  return { dir, db, chain, service, user };
}

// Mensimulasikan panggilan yang seharusnya gagal (eth_call) dan mengembalikan nama custom error-nya.
async function revertName(contract, method, ...args) {
  try {
    await contract[method].staticCall(...args);
  } catch (error) {
    return revertReason(error)?.text || error.message;
  }
  assert.fail(`${method} seharusnya ditolak kontrak.`);
}

test('Status peminjaman on-chain mengikuti database dan dikirim dari wallet aktor', async t => {
  const { db, chain, service, user } = await setup(t, 'labpass-v2-flow-');
  const student = user('mhs-1');
  const staff = user('staff-zaenal');
  const body = { asset_id: 'LP-OSC-001', purpose: 'Uji kontrak v2', lecturer: 'Dosen Demo', start_date: '2026-11-23', due_date: '2026-11-24' };
  const check = { condition: 'Baik', components: service.asset(body.asset_id).components.map(item => ({ id: item.id, received: item.quantity })) };
  const loan = service.createLoan(student, body);
  const expect = async (status, dbStatus) => {
    await service.flushEvidence();
    const state = await service.chainState(loan.id, staff);
    assert.equal(state.status, status);
    assert.equal(state.matchesDatabase, true);
    assert.equal(service.loan(loan.id, staff).status, dbStatus);
  };
  await expect('Requested', 'REQUESTED');
  service.action(loan.id, staff, 'approve');
  await expect('Approved', 'APPROVED');
  service.action(loan.id, staff, 'handover', check);
  await expect('HandoverPending', 'HANDOVER_PENDING');
  service.action(loan.id, student, 'confirm-pickup');
  await expect('Borrowed', 'BORROWED');
  service.action(loan.id, student, 'request-return');
  await expect('ReturnRequested', 'RETURN_REQUESTED');
  const missing = structuredClone(check);
  missing.components[0].received = 0;
  service.action(loan.id, staff, 'inspect-return', missing);
  await expect('ReturnPending', 'RETURN_PENDING');
  service.action(loan.id, student, 'confirm-return');
  await expect('Closed', 'CLOSED');

  // Setiap kejadian punya tx hash dan pengirimnya adalah wallet akun yang bertindak.
  const events = service.detail(loan.id, staff).events;
  for (const event of events) {
    assert.equal(event.chain_status, 'RECORDED', event.type);
    assert.match(event.tx_hash, /^0x[0-9a-f]{64}$/);
    assert.equal(event.chain_from.toLowerCase(), chain.walletOf(event.actor_id).toLowerCase());
  }
  assert.equal(db.prepare("SELECT count(*) n FROM chain_ops WHERE status!='RECORDED'").get().n, 0);

  // Alat kurang lengkap: kontrak juga menandai perlu pemeriksaan, lalu petugas melepasnya.
  assert.equal((await chain.readAsset(body.asset_id)).needsInspection, true);
  assert.throws(() => service.releaseAsset(body.asset_id, student), { status: 403 });
  service.releaseAsset(body.asset_id, staff);
  await service.flushEvidence();
  assert.equal((await chain.readAsset(body.asset_id)).needsInspection, false);

  // Paspor alat dibaca dari log event, termasuk rantai hash bukti.
  const history = await service.assetHistory(body.asset_id);
  const moves = history.items.filter(item => item.kind === 'status').map(item => item.to);
  assert.deepEqual(moves, ['Requested', 'Approved', 'HandoverPending', 'Borrowed', 'ReturnRequested', 'ReturnPending', 'Closed']);
  const proofs = history.items.filter(item => item.kind === 'evidence');
  assert.equal(proofs.length, 4);
  for (let index = 1; index < proofs.length; index++) assert.equal(proofs[index].previousDigest, proofs[index - 1].digest);
  assert.equal(history.items.at(-1).kind, 'release');
  assert.equal(history.state.lastDigest, proofs.at(-1).digest);
});

test('Kontrak menolak aktor dan urutan status yang salah walau backend dilewati', async t => {
  const { chain, service, user } = await setup(t, 'labpass-v2-reject-');
  const student = user('mhs-1');
  const other = user('mhs-2');
  const staff = user('staff-pkl');
  const loan = service.createLoan(student, { asset_id: 'LP-RL-001', purpose: 'Uji penolakan', lecturer: 'Dosen Demo', start_date: '2026-11-23', due_date: '2026-11-24' });
  const competing = service.createLoan(other, { asset_id: 'LP-RL-001', purpose: 'Pengajuan pesaing', lecturer: 'Dosen Demo', start_date: '2026-11-23', due_date: '2026-11-24' });
  await service.flushEvidence();
  const as = async id => chain.contract.connect(await chain.provider.getSigner(chain.walletOf(id)));
  const key = idKey(loan.id);
  const fakeProof = [proofKey('UJI-' + loan.id), '0x' + '11'.repeat(32)];

  assert.equal(await revertName(await as('mhs-1'), 'approve', key), 'NotStaff');
  assert.equal(await revertName(await as('staff-pkl'), 'requestLoan', idKey('LOAN-PALSU'), idKey('LP-RL-001')), 'NotStudent');
  assert.equal(await revertName(await as('staff-pkl'), 'confirmPickup', key, ...fakeProof), 'NotBorrower');
  assert.equal(await revertName(await as('mhs-2'), 'cancel', key, ...fakeProof), 'NotBorrower');
  assert.equal(await revertName(await as('mhs-1'), 'confirmPickup', key, ...fakeProof), 'InvalidStatus(Requested)');
  assert.equal(await revertName(await as('staff-pkl'), 'approve', idKey('LOAN-TIDAK-ADA')), 'LoanNotFound');
  assert.equal(await revertName(await as('mhs-1'), 'requestLoan', key, idKey('LP-RL-001')), 'LoanExists');

  // Satu unit hanya bisa dipegang satu peminjaman aktif, juga di level kontrak.
  service.action(loan.id, staff, 'approve');
  await service.flushEvidence();
  assert.equal(await revertName(await as('staff-pkl'), 'approve', idKey(competing.id)), 'AssetUnavailable');
  assert.equal(await revertName(await as('staff-pkl'), 'releaseAsset', idKey('LP-RL-001')), 'AssetInUse');

  // Akun luar dan admin palsu tidak bisa mencatat bukti atau mengubah peran.
  const outsider = chain.contract.connect(await chain.provider.getSigner(chain.metadata.outsider));
  assert.equal(await revertName(outsider, 'recordEvidence', proofKey('X'), '0x' + '22'.repeat(32)), 'Unauthorized');
  assert.equal(await revertName(outsider, 'setRole', chain.metadata.outsider, 2), 'Unauthorized');
  assert.equal(await revertName(chain.contract, 'recordEvidence', proofKey('X'), '0x' + '00'.repeat(32)), 'EmptyDigest');
  assert.equal((await chain.readLoan(loan.id)).status, 'Approved');
});

test('Uji penolakan dari aplikasi menghasilkan transaksi gagal yang tercatat di blok', async t => {
  const { chain, service, user } = await setup(t, 'labpass-v2-negative-');
  const student = user('mhs-4');
  const staff = user('staff-pkl');
  const loan = service.createLoan(student, { asset_id: 'LP-PSU-001', purpose: 'Uji demo', lecturer: 'Dosen Demo', start_date: '2026-11-23', due_date: '2026-11-24' });
  service.action(loan.id, staff, 'approve');
  service.action(loan.id, staff, 'handover', { condition: 'Baik', components: service.asset('LP-PSU-001').components.map(item => ({ id: item.id, received: item.quantity })) });
  await service.flushEvidence();

  await assert.rejects(service.rejectionTest(student, 'staff-confirm', loan.id), { status: 403 });
  const confirm = await service.rejectionTest(staff, 'staff-confirm', loan.id);
  assert.equal(confirm.errorName, 'NotBorrower');
  assert.equal(confirm.status, 0);
  assert.match(confirm.txHash, /^0x[0-9a-f]{64}$/);
  assert.equal(confirm.caller.toLowerCase(), chain.walletOf('staff-pkl').toLowerCase());
  assert.equal(confirm.statusBefore, 'HandoverPending');
  assert.equal(confirm.statusAfter, 'HandoverPending');
  const receipt = await chain.provider.getTransactionReceipt(confirm.txHash);
  assert.equal(receipt.status, 0);

  const approve = await service.rejectionTest(staff, 'student-approve', loan.id);
  assert.equal(approve.errorName, 'NotStaff');
  assert.equal(approve.callerId, 'mhs-4');
  const outsider = await service.rejectionTest(staff, 'outsider-record');
  assert.equal(outsider.errorName, 'Unauthorized');
  assert.equal(outsider.status, 0);
  assert.equal(service.loan(loan.id, staff).status, 'HANDOVER_PENDING');
});

test('Peminjaman sebelum v2 tetap berjalan; buktinya dicatat admin lewat recordEvidence', async t => {
  const { db, chain, service, user } = await setup(t, 'labpass-v2-legacy-');
  const student = user('mhs-1');
  const staff = user('staff-zaenal');
  const loan = service.createLoan(student, { asset_id: 'LP-SGN-001', purpose: 'Data lama', lecturer: 'Dosen Demo', start_date: '2026-11-23', due_date: '2026-11-24' });
  // Simulasikan transaksi lama: belum dikenal kontrak v2.
  db.prepare("DELETE FROM chain_ops WHERE loan_id=?").run(loan.id);
  db.prepare('UPDATE loans SET onchain=0 WHERE id=?').run(loan.id);
  service.action(loan.id, staff, 'approve');
  service.action(loan.id, staff, 'handover', { condition: 'Baik', components: service.asset('LP-SGN-001').components.map(item => ({ id: item.id, received: item.quantity })) });
  await service.flushEvidence();
  const ops = db.prepare('SELECT method,actor_id,status FROM chain_ops WHERE loan_id=?').all(loan.id).map(row => ({ ...row }));
  assert.deepEqual(ops, [{ method: 'recordEvidence', actor_id: '__admin', status: 'RECORDED' }]);
  const handover = service.detail(loan.id, student).events.find(event => event.type === 'handover');
  assert.ok((await service.verify(handover.evidence_id, student)).chainMatches);
  assert.equal((await service.chainState(loan.id, student)).onchain, false);
  assert.equal((await chain.readLoan(loan.id)).exists, false);
});

test('Transaksi yang gagal menahan transaksi berikutnya untuk alat yang sama sampai dicoba ulang', async t => {
  const { db, chain, service, user } = await setup(t, 'labpass-v2-order-');
  const student = user('mhs-1');
  const staff = user('staff-zaenal');
  const loan = service.createLoan(student, { asset_id: 'LP-DSK-001', purpose: 'Uji urutan', lecturer: 'Dosen Demo', start_date: '2026-11-23', due_date: '2026-11-24' });
  service.action(loan.id, staff, 'approve');
  service.chain = null;
  await service.flushEvidence();
  const failed = db.prepare('SELECT method,status,error FROM chain_ops WHERE loan_id=? ORDER BY rowid').all(loan.id);
  assert.deepEqual(failed.map(op => op.status), ['FAILED', 'FAILED']);
  assert.match(failed[1].error, /Menunggu transaksi sebelumnya|Jaringan lokal/);
  service.chain = chain;
  await service.flushEvidence();
  assert.deepEqual(db.prepare('SELECT status FROM chain_ops WHERE loan_id=? ORDER BY rowid').all(loan.id).map(op => op.status), ['RECORDED', 'RECORDED']);
  assert.equal((await chain.readLoan(loan.id)).status, 'Approved');
  // Simulasi server mati setelah transaksi masuk blok tetapi sebelum database diperbarui:
  // retry mendeteksi status kontrak sudah sesuai dan tidak mengirim ulang.
  const last = db.prepare("SELECT id,tx_hash FROM chain_ops WHERE loan_id=? AND method='approve'").get(loan.id);
  db.prepare("UPDATE chain_ops SET status='PENDING' WHERE id=?").run(last.id);
  const blockBefore = await chain.provider.getBlockNumber();
  await service.flushEvidence();
  assert.equal(db.prepare('SELECT status,tx_hash FROM chain_ops WHERE id=?').get(last.id).status, 'RECORDED');
  assert.equal(db.prepare('SELECT tx_hash FROM chain_ops WHERE id=?').get(last.id).tx_hash, last.tx_hash);
  assert.equal(await chain.provider.getBlockNumber(), blockBefore);
});
