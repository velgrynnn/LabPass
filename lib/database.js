import { DatabaseSync } from 'node:sqlite';
import { scryptSync, randomBytes, timingSafeEqual } from 'node:crypto';

export function passwordHash(password, salt = randomBytes(16).toString('hex')) { return `${salt}:${scryptSync(password, salt, 32).toString('hex')}`; }
export function passwordMatches(password, stored) {
  const [salt, hash] = stored.split(':');
  return timingSafeEqual(scryptSync(password, salt, 32), Buffer.from(hash, 'hex'));
}
export function openDatabase(filename) {
  const db = new DatabaseSync(filename);
  db.exec(`PRAGMA foreign_keys=ON; PRAGMA journal_mode=WAL;
    CREATE TABLE IF NOT EXISTS users(id TEXT PRIMARY KEY,name TEXT NOT NULL,nim TEXT,role TEXT NOT NULL CHECK(role IN ('student','staff')),password_hash TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS assets(id TEXT PRIMARY KEY,name TEXT NOT NULL,category TEXT NOT NULL,description TEXT NOT NULL,inventory_number TEXT,condition TEXT NOT NULL,status TEXT NOT NULL CHECK(status IN ('AVAILABLE','RESERVED','BORROWED','INSPECTION')));
    CREATE TABLE IF NOT EXISTS asset_components(id TEXT PRIMARY KEY,asset_id TEXT NOT NULL REFERENCES assets(id),name TEXT NOT NULL,quantity INTEGER NOT NULL CHECK(quantity>0));
    CREATE TABLE IF NOT EXISTS loans(id TEXT PRIMARY KEY,asset_id TEXT NOT NULL REFERENCES assets(id),borrower_id TEXT NOT NULL REFERENCES users(id),purpose TEXT NOT NULL,lecturer TEXT NOT NULL,start_date TEXT NOT NULL,due_date TEXT NOT NULL,status TEXT NOT NULL,created_at TEXT NOT NULL,updated_at TEXT NOT NULL,staff_id TEXT REFERENCES users(id),rejection_note TEXT,checkout_json TEXT,return_json TEXT);
    CREATE TABLE IF NOT EXISTS loan_events(id TEXT PRIMARY KEY,loan_id TEXT NOT NULL REFERENCES loans(id),actor_id TEXT NOT NULL REFERENCES users(id),type TEXT NOT NULL,created_at TEXT NOT NULL,note TEXT NOT NULL);
    CREATE TABLE IF NOT EXISTS evidence_records(id TEXT PRIMARY KEY,event_id TEXT NOT NULL REFERENCES loan_events(id),payload_json TEXT NOT NULL,digest TEXT NOT NULL,archive_path TEXT NOT NULL,chain_status TEXT NOT NULL DEFAULT 'PENDING',tx_hash TEXT,block_number INTEGER,gas_used TEXT,chain_error TEXT);
    CREATE TABLE IF NOT EXISTS attachments(id TEXT PRIMARY KEY,loan_id TEXT NOT NULL REFERENCES loans(id),filename TEXT NOT NULL,mime TEXT NOT NULL,digest TEXT NOT NULL,relative_path TEXT NOT NULL,created_by TEXT NOT NULL REFERENCES users(id),created_at TEXT NOT NULL);
    CREATE UNIQUE INDEX IF NOT EXISTS one_active_custody ON loans(asset_id) WHERE status IN ('APPROVED','HANDOVER_PENDING','BORROWED','RETURN_REQUESTED','RETURN_PENDING');
  `);
  if (!db.prepare('SELECT count(*) as n FROM users').get().n) seed(db);
  return db;
}
function seed(db) {
  const users = [ ['staff-zaenal','Pak Zaenal (akun dummy)',null,'staff'],['staff-pkl','Petugas PKL (akun dummy)',null,'staff'],...Array.from({length:5},(_,i)=>[`mhs-${i+1}`,['Alya','Bima','Citra','Dimas','Elin'][i]+' (dummy)',`DUMMY-ET-00${i+1}`,'student']) ];
  const insert = db.prepare('INSERT INTO users VALUES(?,?,?,?,?)');
  for(const u of users) insert.run(...u,passwordHash('demo123'));
  const examples = [
    ['LP-RL-001','Board RL M-2','Board praktikum','Modul latihan RL, unit simulasi 01',null,['Kabel penghubung','Kabel catu daya']],
    ['LP-RL-002','Board RL M-2','Board praktikum','Modul latihan RL, unit simulasi 02',null,['Kabel penghubung','Kabel catu daya']],
    ['LP-DSK-001','DSP Starter Kit','Pemrosesan sinyal','Paket DSP untuk latihan, bukan inventaris resmi',null,['Adaptor','Kabel USB']],
    ['LP-PLT-001','ADALM-Pluto','Radio digital','Paket radio simulasi untuk penelitian',null,['Kabel USB','Kabel coax','Antena']],
    ['LP-OSC-001','Osiloskop Digital','Pengukuran','Unit simulasi untuk pengukuran dasar','DUMMY-ASSET-005',['Probe kanal 1','Probe kanal 2','Kabel daya']],
    ['LP-PSU-001','Power Supply DC','Catu daya','Catu daya laboratorium simulasi','DUMMY-ASSET-006',['Kabel daya','Kabel keluaran']],
    ['LP-SGN-001','Signal Generator','Pengukuran','Generator sinyal simulasi','DUMMY-ASSET-007',['Kabel daya','Kabel BNC']],
    ['LP-SPC-001','Spectrum Analyzer','Pengukuran','Unit dummy sedang menunggu pemeriksaan','DUMMY-ASSET-008',['Kabel daya','Atenuator']]
  ];
  for (const [id,name,cat,desc,inv,parts] of examples) {
    db.prepare('INSERT INTO assets VALUES(?,?,?,?,?,?,?)').run(id,name,cat,desc,inv,id==='LP-SPC-001'?'Perlu pemeriksaan':'Baik',id==='LP-SPC-001'?'INSPECTION':'AVAILABLE');
    parts.forEach((p,i)=>db.prepare('INSERT INTO asset_components VALUES(?,?,?,?)').run(`${id}-C${i+1}`,id,p,1));
  }
}
