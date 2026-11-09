import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openDatabase } from '../lib/database.js';
import { LabService, canonical, digest } from '../lib/service.js';
import { openChain } from '../lib/chain.js';

test('Alur lengkap, hak akses, hash identitas, arsip, dan bukti EVM nyata',async t=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'labpass-test-'));const db=openDatabase(':memory:');const chain=await openChain(dir,{memory:true});const s=new LabService(db,dir,chain);
 t.after(async()=>{await chain.close();db.close();if(path.basename(dir).startsWith('labpass-test-'))fs.rmSync(dir,{recursive:true,force:true});});
 const staff=db.prepare("SELECT * FROM users WHERE id='staff-zaenal'").get(),a=db.prepare("SELECT * FROM users WHERE id='mhs-1'").get(),b=db.prepare("SELECT * FROM users WHERE id='mhs-2'").get();
 const body={asset_id:'LP-RL-001',purpose:'Pengujian dummy',lecturer:'Dosen dummy',start_date:'2026-11-08',due_date:'2026-11-09'};
 const loan=s.createLoan(a,body);const competing=s.createLoan(b,body);
 await t.test('pengajuan dari tab lama ditolak saat akun di browser berganti', () => {
   const before = db.prepare('SELECT count(*) AS count FROM loans').get().count;
   for (const activeAccount of [staff, b]) {
     assert.throws(
       () => s.createLoan(activeAccount, { ...body, expected_borrower_id: a.id }),
       { status: 409, message: /Akun aktif di browser ini sudah berganti/ }
     );
   }
   assert.equal(db.prepare('SELECT count(*) AS count FROM loans').get().count, before);
   const matching = s.createLoan(a, { ...body, expected_borrower_id: a.id });
   assert.equal(matching.borrower_id, a.id);
 });
 await t.test('data dummy dan akses transaksi',()=>{assert.equal(s.listAssets().length,8);assert.throws(()=>s.detail(loan.id,b),/Tidak berhak/);assert.throws(()=>s.action(loan.id,a,'approve'),/Peran/);assert.throws(()=>s.createLoan(a,{...body,due_date:'2026-01-01'}),/Tanggal/);assert.throws(()=>s.createLoan(a,{...body,start_date:'2026-02-30'}),/Tanggal/);});
 await t.test('persetujuan memesan alat secara eksklusif',()=>{s.action(loan.id,staff,'approve');assert.equal(s.asset(body.asset_id).status,'RESERVED');assert.throws(()=>s.action(competing.id,staff,'approve'),/sudah dipesan/);assert.throws(()=>s.action(loan.id,a,'confirm-pickup'),/status/);});
 const check={condition:'Baik',notes:'Paket lengkap',components:s.asset(body.asset_id).components.map(c=>({id:c.id,received:c.quantity}))};
 await t.test('checklist wajib lengkap dan konfirmasi peminjam',()=>{assert.throws(()=>s.action(loan.id,staff,'handover',{...check,components:[]}),/Checklist/);s.action(loan.id,staff,'handover',check);assert.equal(s.asset(body.asset_id).status,'RESERVED');assert.throws(()=>s.action(loan.id,staff,'confirm-pickup'),/Hanya peminjam/);s.action(loan.id,a,'confirm-pickup');assert.equal(s.asset(body.asset_id).status,'BORROWED');assert.throws(()=>s.createLoan(b,body),/tidak tersedia/);});
 await s.flushEvidence();const proof=db.prepare('SELECT * FROM evidence_records ORDER BY rowid DESC LIMIT 1').get();
 await t.test('bukti tercatat di blockchain lokal, bukan sekadar hash DB',async()=>{const v=await s.verify(proof.id,a);assert.equal(v.chainStatus,'RECORDED');assert.equal(v.chainMatches,true);assert.equal(v.dbMatches,true);assert.equal(v.archiveMatches,true);assert.equal(v.liveIdentityMatches,true);assert.match(v.txHash,/^0x[0-9a-f]{64}$/);assert.ok(Number(v.gasUsed)>0);});
 await t.test('perubahan kandidat, identitas live, dan arsip dapat dideteksi',async()=>{
   const original=JSON.parse(proof.payload_json),tampered=structuredClone(original);tampered.borrower.nim='NIM-DIUBAH';assert.equal((await s.verify(proof.id,a,tampered)).candidateMatches,false);assert.equal((await s.verify(proof.id,a,original)).candidateMatches,true);
   db.prepare('UPDATE users SET nim=? WHERE id=?').run('NIM-DIUBAH',a.id);assert.equal((await s.verify(proof.id,a)).liveIdentityMatches,false);db.prepare('UPDATE users SET nim=? WHERE id=?').run(a.nim,a.id);
   const archive=path.join(dir,proof.archive_path);fs.writeFileSync(archive,canonical(tampered));const v=await s.verify(proof.id,a);assert.equal(v.archiveMatches,false);assert.equal(v.chainMatches,true);fs.writeFileSync(archive,proof.payload_json);
   assert.notEqual(digest(original),digest({...original,nonce:'different'}));
 });
 await t.test('kontrak menolak operator lain dan penimpaan bukti',async()=>{const {keccak256,toUtf8Bytes}=await import('ethers');const key=keccak256(toUtf8Bytes(proof.id));const outsider=await chain.provider.getSigner(1);await assert.rejects(async()=>{await (await chain.contract.connect(outsider).recordEvidence(key,proof.digest)).wait();});await assert.rejects(async()=>{await (await chain.contract.recordEvidence(key,proof.digest)).wait();});});
 await t.test('pengembalian tidak langsung melepas alat, kekurangan masuk pemeriksaan',()=>{s.action(loan.id,a,'request-return');assert.equal(s.asset(body.asset_id).status,'BORROWED');const missing=structuredClone(check);missing.components[0].received=0;s.action(loan.id,staff,'inspect-return',missing);assert.equal(s.asset(body.asset_id).status,'INSPECTION');s.action(loan.id,a,'confirm-return');assert.equal(s.loan(loan.id,a).status,'CLOSED');assert.equal(s.asset(body.asset_id).status,'INSPECTION');assert.throws(()=>s.action(loan.id,a,'confirm-return'),/status/);});
 await s.flushEvidence();assert.equal(db.prepare("SELECT count(*) as n FROM evidence_records WHERE chain_status!='RECORDED'").get().n,0);
 await t.test('foto memiliki hash bytes yang benar, akses terkunci, dan perubahan file terdeteksi',async()=>{const other=s.createLoan(a,{...body,asset_id:'LP-DSK-001'});const png=Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jr9sAAAAASUVORK5CYII=','base64');const photo=s.addAttachment(other.id,a,{filename:'dummy.png',base64:png.toString('base64')});assert.equal(photo.digest,digest(png));assert.throws(()=>s.addAttachment(other.id,b,{filename:'dummy.png',base64:png.toString('base64')}),/Tidak berhak/);assert.throws(()=>s.addAttachment(other.id,a,{filename:'x.html',base64:Buffer.from('<html>').toString('base64')}),/Hanya foto/);s.action(other.id,staff,'approve');s.action(other.id,staff,'handover',{condition:'Baik',components:s.asset('LP-DSK-001').components.map(c=>({id:c.id,received:c.quantity}))});await s.flushEvidence();const p=db.prepare('SELECT * FROM evidence_records ORDER BY rowid DESC LIMIT 1').get();assert.equal((await s.verify(p.id,a)).files[0].matches,true);const imagePath=path.join(dir,db.prepare('SELECT relative_path FROM attachments WHERE id=?').get(photo.id).relative_path);fs.writeFileSync(imagePath,Buffer.from('changed'));assert.equal((await s.verify(p.id,a)).files[0].matches,false);fs.writeFileSync(imagePath,png);});
 await t.test('kegagalan chain ditampilkan FAILED dan transaksi tidak diulang',async()=>{const other=s.createLoan(a,{...body,asset_id:'LP-PLT-001'});s.action(other.id,staff,'approve');const parts=s.asset('LP-PLT-001').components.map(c=>({id:c.id,received:1}));s.action(other.id,staff,'handover',{condition:'Baik',components:parts});s.chain=null;await s.flushEvidence();const r=db.prepare("SELECT * FROM evidence_records WHERE chain_status='FAILED'").get();assert.ok(r);assert.equal((await s.verify(r.id,a)).chainMatches,false);s.chain=chain;await s.flushEvidence();assert.equal(db.prepare('SELECT chain_status FROM evidence_records WHERE id=?').get(r.id).chain_status,'RECORDED');});
});
