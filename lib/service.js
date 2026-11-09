import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

export class AppError extends Error { constructor(message, status=400) { super(message); this.status=status; } }
export const canonical = value => JSON.stringify(sort(value));
function sort(value) { if(Array.isArray(value)) return value.map(sort); if(value && typeof value==='object') return Object.fromEntries(Object.keys(value).sort().map(k=>[k,sort(value[k])])); return value; }
export const digest = value => '0x'+createHash('sha256').update(typeof value==='string'||Buffer.isBuffer(value)?value:canonical(value)).digest('hex');
const now = () => new Date().toISOString();
function text(value,name,max=1000) { if(typeof value!=='string'||!value.trim()||value.trim().length>max) throw new AppError(`${name} wajib diisi (maks. ${max} karakter).`); return value.trim(); }
export class LabService {
  constructor(db,dataDir,chain) { this.db=db; this.dataDir=dataDir; this.chain=chain; fs.mkdirSync(path.join(dataDir,'archives'),{recursive:true}); fs.mkdirSync(path.join(dataDir,'uploads'),{recursive:true}); }
  transaction(fn) { this.db.exec('BEGIN IMMEDIATE'); try { const r=fn();this.db.exec('COMMIT');return r; } catch(e) {this.db.exec('ROLLBACK');throw e;} }
  publicUser(u) { return {id:u.id,name:u.name,nim:u.nim,role:u.role}; }
  asset(id) { const a=this.db.prepare('SELECT * FROM assets WHERE id=?').get(id);if(!a)throw new AppError('Alat tidak ditemukan.',404);return {...a,components:this.db.prepare('SELECT * FROM asset_components WHERE asset_id=?').all(id)}; }
  listAssets(){return this.db.prepare('SELECT id FROM assets ORDER BY id').all().map(a=>this.asset(a.id));}
  loan(id,user) {const l=this.db.prepare('SELECT l.*,a.name as asset_name,u.name as borrower_name FROM loans l JOIN assets a ON a.id=l.asset_id JOIN users u ON u.id=l.borrower_id WHERE l.id=?').get(id);if(!l)throw new AppError('Peminjaman tidak ditemukan.',404);if(user.role!=='staff'&&l.borrower_id!==user.id)throw new AppError('Tidak berhak membuka transaksi ini.',403);return l;}
  listLoans(user) {const rows=user.role==='staff'?this.db.prepare('SELECT id FROM loans ORDER BY created_at DESC').all():this.db.prepare('SELECT id FROM loans WHERE borrower_id=? ORDER BY created_at DESC').all(user.id);return rows.map(r=>this.loan(r.id,user));}
  detail(id,user) {const loan=this.loan(id,user);return {loan,asset:this.asset(loan.asset_id),events:this.db.prepare('SELECT e.*,u.name as actor_name,p.id as evidence_id,p.digest,p.chain_status,p.tx_hash,p.block_number,p.gas_used,p.chain_error FROM loan_events e JOIN users u ON u.id=e.actor_id LEFT JOIN evidence_records p ON p.event_id=e.id WHERE e.loan_id=? ORDER BY e.rowid').all(id),attachments:this.db.prepare('SELECT id,filename,mime,digest,created_at FROM attachments WHERE loan_id=? ORDER BY rowid').all(id)};}
  createLoan(user,body) {
    if (body.expected_borrower_id !== undefined && body.expected_borrower_id !== user.id) {
      throw new AppError('Akun aktif di browser ini sudah berganti. Muat ulang LabPass dan masuk sebagai mahasiswa. Gunakan jendela Incognito untuk akun petugas.', 409);
    }
    if(user.role!=='student')throw new AppError('Pengajuan hanya untuk akun mahasiswa.',403);
    const purpose=text(body.purpose,'Tujuan',600), lecturer=text(body.lecturer,'Dosen terkait',150);
    const validDate=v=>typeof v==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(v)&&Number.isFinite(Date.parse(v))&&new Date(v).toISOString().slice(0,10)===v;
    if(!validDate(body.start_date)||!validDate(body.due_date)||body.due_date<body.start_date)throw new AppError('Tanggal peminjaman tidak valid.');
    const date=now(); const id='LOAN-'+randomUUID().slice(0,8).toUpperCase();
    return this.transaction(()=>{if(this.asset(body.asset_id).status!=='AVAILABLE')throw new AppError('Alat tidak tersedia.',409);this.db.prepare('INSERT INTO loans(id,asset_id,borrower_id,purpose,lecturer,start_date,due_date,status,created_at,updated_at) VALUES(?,?,?,?,?,?,?,?,?,?)').run(id,body.asset_id,user.id,purpose,lecturer,body.start_date,body.due_date,'REQUESTED',date,date);this.event(id,user,'REQUESTED','Pengajuan mahasiswa');return this.loan(id,user);});
  }
  event(loanId,user,type,note,evidence=null) {
    const id=randomUUID();this.db.prepare('INSERT INTO loan_events VALUES(?,?,?,?,?,?)').run(id,loanId,user.id,type,now(),note);
    if(evidence) {
      const proofId='PROOF-'+randomUUID();const loan=this.db.prepare('SELECT * FROM loans WHERE id=?').get(loanId);const borrower=this.publicUser(this.db.prepare('SELECT * FROM users WHERE id=?').get(loan.borrower_id));
      const attachments=this.db.prepare('SELECT id,filename,digest FROM attachments WHERE loan_id=? ORDER BY rowid').all(loanId);
      const payload={schema:'labpass-evidence-v1',id:proofId,eventId:id,eventType:type,createdAt:now(),nonce:randomBytes(32).toString('hex'),loan:{id:loan.id,assetId:loan.asset_id,purpose:loan.purpose,lecturer:loan.lecturer,startDate:loan.start_date,dueDate:loan.due_date},borrower,actor:this.publicUser(user),evidence,attachments};
      const encoded=canonical(payload);this.db.prepare('INSERT INTO evidence_records(id,event_id,payload_json,digest,archive_path) VALUES(?,?,?,?,?)').run(proofId,id,encoded,digest(encoded),`archives/${proofId}.json`);
    }
    return id;
  }
  checkRole(user,role) {if(user.role!==role)throw new AppError('Peran tidak diizinkan.',403);}
  checklist(asset,body) {
    const c=body.components;if(!Array.isArray(c)||c.length!==asset.components.length)throw new AppError('Checklist seluruh kelengkapan harus diisi.');
    const seen=new Set();for(const item of c){const expected=asset.components.find(x=>x.id===item.id);if(!expected||seen.has(item.id)||!Number.isInteger(item.received)||item.received<0||item.received>expected.quantity)throw new AppError('Checklist kelengkapan tidak valid.');seen.add(item.id);}
    if(!['Baik','Lecet','Rusak','Perlu pemeriksaan'].includes(body.condition))throw new AppError('Kondisi tidak valid.');
    return {condition:body.condition,notes:typeof body.notes==='string'?body.notes.trim().slice(0,1200):'',components:asset.components.map(x=>({...x,received:c.find(c=>c.id===x.id).received}))};
  }
  action(id,user,action,body={}) {
    return this.transaction(()=>{
      const l=this.loan(id,user),a=this.asset(l.asset_id);let status=l.status, note='',proof=null;
      const staff=()=>this.checkRole(user,'staff');const borrower=()=>{if(user.id!==l.borrower_id)throw new AppError('Hanya peminjam terkait yang dapat mengonfirmasi.',403);};
      const requireState=(s)=>{if(!s.includes(l.status))throw new AppError('Tindakan tidak sesuai status transaksi.',409);};
      switch(action){
        case 'approve':staff();requireState(['REQUESTED']);if(a.status!=='AVAILABLE')throw new AppError('Alat sudah dipesan atau tidak tersedia.',409);status='APPROVED';this.db.prepare("UPDATE assets SET status='RESERVED' WHERE id=?").run(a.id);this.db.prepare('UPDATE loans SET staff_id=? WHERE id=?').run(user.id,id);note='Petugas menyetujui; alat belum diserahkan';break;
        case 'reject':staff();requireState(['REQUESTED']);status='REJECTED';note=text(body.notes,'Alasan penolakan',600);this.db.prepare('UPDATE loans SET rejection_note=? WHERE id=?').run(note,id);break;
        case 'cancel':borrower();requireState(['REQUESTED','APPROVED']);status='CANCELLED';if(l.status==='APPROVED')this.db.prepare("UPDATE assets SET status='AVAILABLE' WHERE id=?").run(a.id);note='Peminjam membatalkan pengajuan';break;
        case 'handover':staff();requireState(['APPROVED']);proof=this.checklist(a,body);if(proof.components.some(x=>x.received!==x.quantity))throw new AppError('Serah terima awal harus lengkap. Perbaiki paket alat terlebih dahulu.');if(['Rusak','Perlu pemeriksaan'].includes(proof.condition))throw new AppError('Alat perlu pemeriksaan tidak dapat diserahkan.');status='HANDOVER_PENDING';this.db.prepare('UPDATE loans SET checkout_json=? WHERE id=?').run(canonical(proof),id);note='Petugas mencatat kondisi awal; menunggu konfirmasi peminjam';break;
        case 'confirm-pickup':borrower();requireState(['HANDOVER_PENDING']);status='BORROWED';proof={...JSON.parse(l.checkout_json),confirmation:'Peminjam menyetujui rekaman serah terima melalui aplikasi',confirmationMode:'backend-custodial'};this.db.prepare("UPDATE assets SET status='BORROWED' WHERE id=?").run(a.id);note='Peminjam mengonfirmasi penerimaan alat';break;
        case 'request-return':borrower();requireState(['BORROWED']);status='RETURN_REQUESTED';note='Peminjam mengajukan pengembalian; belum selesai diperiksa';break;
        case 'inspect-return':staff();requireState(['RETURN_REQUESTED']);proof=this.checklist(a,body);status='RETURN_PENDING';this.db.prepare('UPDATE loans SET return_json=? WHERE id=?').run(canonical(proof),id);this.db.prepare("UPDATE assets SET status='INSPECTION' WHERE id=?").run(a.id);note='Petugas mencatat hasil pemeriksaan pengembalian';break;
        case 'confirm-return':borrower();requireState(['RETURN_PENDING']);status='CLOSED';proof={...JSON.parse(l.return_json),confirmation:'Peminjam menyetujui rekaman pengembalian melalui aplikasi',confirmationMode:'backend-custodial'};const needsInspection=proof.components.some(x=>x.received!==x.quantity)||['Rusak','Perlu pemeriksaan'].includes(proof.condition);this.db.prepare('UPDATE assets SET status=?,condition=? WHERE id=?').run(needsInspection?'INSPECTION':'AVAILABLE',proof.condition,a.id);note=needsInspection?'Transaksi selesai; alat memerlukan pemeriksaan':'Transaksi selesai; alat tersedia kembali';break;
        default:throw new AppError('Tindakan tidak dikenal.',404);
      }
      this.db.prepare('UPDATE loans SET status=?,updated_at=? WHERE id=?').run(status,now(),id);this.event(id,user,action,note,proof);return this.detail(id,user);
    });
  }
  async flushEvidence() {
    if(this.flushing)return;this.flushing=true;
    try {for(const record of this.db.prepare("SELECT * FROM evidence_records WHERE chain_status IN ('PENDING','FAILED') ORDER BY rowid").all()){
      try{
        // Archives are written after DB commit. Retries never replace an existing archive.
        const archive=path.join(this.dataDir,record.archive_path);if(!fs.existsSync(archive))fs.writeFileSync(archive,record.payload_json,{flag:'wx'});
        if(digest(fs.readFileSync(archive,'utf8'))!==record.digest)throw new Error('Arsip tidak cocok dengan hash tersimpan.');
        if(!this.chain)throw new Error('Jaringan lokal tidak tersedia. Bukti menunggu pencatatan, bukan bukti on-chain.');
        const receipt=await this.chain.anchor(record.id,record.digest);this.db.prepare("UPDATE evidence_records SET chain_status='RECORDED',tx_hash=coalesce(?,tx_hash),block_number=coalesce(?,block_number),gas_used=coalesce(?,gas_used),chain_error=NULL WHERE id=?").run(receipt.txHash,receipt.blockNumber,receipt.gasUsed,record.id);
      }catch(e){this.db.prepare("UPDATE evidence_records SET chain_status='FAILED',chain_error=? WHERE id=?").run(e.message.slice(0,500),record.id);}
    }}finally{this.flushing=false;}
  }
  proof(id,user) {const p=this.db.prepare('SELECT p.*,e.loan_id FROM evidence_records p JOIN loan_events e ON e.id=p.event_id WHERE p.id=?').get(id);if(!p)throw new AppError('Bukti tidak ditemukan.',404);this.loan(p.loan_id,user);return p;}
  async verify(id,user,candidate=null) {
    const p=this.proof(id,user);const stored=JSON.parse(p.payload_json);const archivedPath=path.join(this.dataDir,p.archive_path);const archived=fs.existsSync(archivedPath)?fs.readFileSync(archivedPath,'utf8'):null;
    const chainProof=this.chain?await this.chain.read(id):null;
    const currentBorrower=this.publicUser(this.db.prepare('SELECT * FROM users WHERE id=?').get(stored.borrower.id));
    const live={...stored,borrower:currentBorrower};
    const files=stored.attachments.map(a=>{const row=this.db.prepare('SELECT * FROM attachments WHERE id=?').get(a.id);const f=row&&path.join(this.dataDir,row.relative_path);return {id:a.id,filename:a.filename,available:Boolean(f&&fs.existsSync(f)),matches:Boolean(f&&fs.existsSync(f)&&digest(fs.readFileSync(f))===a.digest)};});
    const actualCandidate=candidate===null?null:digest(canonical(candidate));
    return {id,algorithm:'SHA-256',expectedHash:p.digest,chainHash:chainProof?.digest||null,chainStatus:p.chain_status,dbMatches:digest(p.payload_json)===p.digest,archiveAvailable:archived!==null,archiveMatches:archived!==null&&digest(archived)===p.digest,chainMatches:Boolean(chainProof?.recordedAt&&chainProof.digest.toLowerCase()===p.digest.toLowerCase()),liveIdentityMatches:digest(live)===p.digest,files,candidateHash:actualCandidate,candidateMatches:actualCandidate===null?null:actualCandidate===p.digest,txHash:p.tx_hash,blockNumber:p.block_number,gasUsed:p.gas_used};
  }
  addAttachment(loanId,user,body) {
    const loan=this.loan(loanId,user);if(['CLOSED','REJECTED','CANCELLED'].includes(loan.status))throw new AppError('Transaksi selesai tidak menerima bukti baru.',409);
    const filename=text(body.filename,'Nama file',120).replace(/[\\/]/g,'_');const buffer=Buffer.from(body.base64||'','base64');
    if(!buffer.length||buffer.length>3*1024*1024)throw new AppError('Foto wajib diisi, maksimum 3 MB.');
    const png=buffer.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]));const jpeg=buffer[0]===255&&buffer[1]===216&&buffer[2]===255;
    if(!png&&!jpeg)throw new AppError('Hanya foto PNG atau JPEG yang diizinkan.');
    const id=randomUUID(),mime=png?'image/png':'image/jpeg',relative=`uploads/${id}.${png?'png':'jpg'}`;fs.writeFileSync(path.join(this.dataDir,relative),buffer,{flag:'wx'});
    this.db.prepare('INSERT INTO attachments VALUES(?,?,?,?,?,?,?,?)').run(id,loanId,filename,mime,digest(buffer),relative,user.id,now());this.event(loanId,user,'attachment','Foto bukti ditambahkan');return {id,filename,digest:digest(buffer)};
  }
}
