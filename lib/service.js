import fs from 'node:fs';
import path from 'node:path';
import { createHash, randomBytes, randomUUID } from 'node:crypto';

export class AppError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}

export const canonical = value => JSON.stringify(sort(value));
function sort(value) {
  if (Array.isArray(value)) return value.map(sort);
  if (value && typeof value === 'object') return Object.fromEntries(Object.keys(value).sort().map(key => [key, sort(value[key])]));
  return value;
}
export const digest = value => '0x' + createHash('sha256')
  .update(typeof value === 'string' || Buffer.isBuffer(value) ? value : canonical(value))
  .digest('hex');

const now = () => new Date().toISOString();
function text(value, name, max = 1000) {
  if (typeof value !== 'string' || !value.trim() || value.trim().length > max) throw new AppError(`${name} wajib diisi (maks. ${max} karakter).`);
  return value.trim();
}

const ACTIVE_STATUSES = ['APPROVED', 'HANDOVER_PENDING', 'BORROWED', 'RETURN_REQUESTED', 'RETURN_PENDING'];

// Tindakan aplikasi -> fungsi kontrak v2 yang dipanggil dari wallet aktor.
const CONTRACT_METHOD = {
  REQUESTED: 'requestLoan',
  approve: 'approve',
  reject: 'reject',
  cancel: 'cancel',
  handover: 'handover',
  'confirm-pickup': 'confirmPickup',
  'request-return': 'requestReturn',
  'inspect-return': 'inspectReturn',
  'confirm-return': 'confirmReturn'
};

// Skenario uji penolakan yang dapat dijalankan dari aplikasi.
export const REJECTION_SCENARIOS = {
  'student-approve': 'Wallet mahasiswa mencoba menyetujui pengajuan (harus NotStaff)',
  'staff-confirm': 'Wallet petugas mencoba konfirmasi penerimaan atas nama peminjam (harus NotBorrower)',
  'outsider-record': 'Wallet tanpa peran mencoba mencatat bukti (harus Unauthorized)'
};

const needsInspection = record => record.components.some(item => item.received !== item.quantity) || ['Rusak', 'Perlu pemeriksaan'].includes(record.condition);

export class LabService {
  constructor(db, dataDir, chain) {
    this.db = db;
    this.dataDir = dataDir;
    this.chain = chain;
    this.flushing = null;
    fs.mkdirSync(path.join(dataDir, 'archives'), { recursive: true });
    fs.mkdirSync(path.join(dataDir, 'uploads'), { recursive: true });
    this.queueLegacyEvidence();
  }

  transaction(fn) {
    this.db.exec('BEGIN IMMEDIATE');
    try {
      const result = fn();
      this.db.exec('COMMIT');
      return result;
    } catch (error) {
      this.db.exec('ROLLBACK');
      throw error;
    }
  }

  publicUser(user) {
    return { id: user.id, name: user.name, nim: user.nim, role: user.role };
  }

  // ---------- Baca data ----------

  asset(id) {
    const asset = this.db.prepare('SELECT * FROM assets WHERE id=?').get(id);
    if (!asset) throw new AppError('Alat tidak ditemukan.', 404);
    return { ...asset, components: this.db.prepare('SELECT * FROM asset_components WHERE asset_id=?').all(id) };
  }

  listAssets() {
    return this.db.prepare('SELECT id FROM assets ORDER BY id').all().map(asset => this.asset(asset.id));
  }

  loan(id, user) {
    const loan = this.db.prepare('SELECT l.*,a.name as asset_name,u.name as borrower_name FROM loans l JOIN assets a ON a.id=l.asset_id JOIN users u ON u.id=l.borrower_id WHERE l.id=?').get(id);
    if (!loan) throw new AppError('Peminjaman tidak ditemukan.', 404);
    if (user.role !== 'staff' && loan.borrower_id !== user.id) throw new AppError('Tidak berhak membuka transaksi ini.', 403);
    return loan;
  }

  listLoans(user) {
    const rows = user.role === 'staff'
      ? this.db.prepare('SELECT id FROM loans ORDER BY created_at DESC').all()
      : this.db.prepare('SELECT id FROM loans WHERE borrower_id=? ORDER BY created_at DESC').all(user.id);
    return rows.map(row => this.loan(row.id, user));
  }

  detail(id, user) {
    const loan = this.loan(id, user);
    // Tx hash diambil dari antrian kontrak (semua tindakan v2) atau dari rekaman bukti (data sebelum v2).
    const events = this.db.prepare(`SELECT e.*, u.name as actor_name,
        p.id as evidence_id, p.digest,
        coalesce(o.status, p.chain_status) as chain_status,
        coalesce(o.tx_hash, p.tx_hash) as tx_hash,
        coalesce(o.block_number, p.block_number) as block_number,
        coalesce(o.gas_used, p.gas_used) as gas_used,
        coalesce(o.error, p.chain_error) as chain_error,
        o.method as chain_method, o.from_address as chain_from
      FROM loan_events e
      JOIN users u ON u.id=e.actor_id
      LEFT JOIN evidence_records p ON p.event_id=e.id
      LEFT JOIN chain_ops o ON o.event_id=e.id
      WHERE e.loan_id=? ORDER BY e.rowid`).all(id);
    return {
      loan,
      asset: this.asset(loan.asset_id),
      events,
      attachments: this.db.prepare('SELECT id,filename,mime,digest,stage,created_at FROM attachments WHERE loan_id=? ORDER BY rowid').all(id)
    };
  }

  // ---------- Pengajuan dan tindakan ----------

  createLoan(user, body) {
    if (body.expected_borrower_id !== undefined && body.expected_borrower_id !== user.id) {
      throw new AppError('Akun aktif di browser ini sudah berganti. Muat ulang LabPass dan masuk sebagai mahasiswa. Gunakan jendela Incognito untuk akun petugas.', 409);
    }
    if (user.role !== 'student') throw new AppError('Pengajuan hanya untuk akun mahasiswa.', 403);
    const purpose = text(body.purpose, 'Tujuan', 600);
    const lecturer = text(body.lecturer, 'Dosen terkait', 150);
    const validDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
    if (!validDate(body.start_date) || !validDate(body.due_date) || body.due_date < body.start_date) throw new AppError('Tanggal peminjaman tidak valid.');
    const date = now();
    const id = 'LOAN-' + randomUUID().slice(0, 8).toUpperCase();
    return this.transaction(() => {
      if (this.asset(body.asset_id).status !== 'AVAILABLE') throw new AppError('Alat tidak tersedia.', 409);
      this.db.prepare('INSERT INTO loans(id,asset_id,borrower_id,purpose,lecturer,start_date,due_date,status,created_at,updated_at,onchain) VALUES(?,?,?,?,?,?,?,?,?,?,1)')
        .run(id, body.asset_id, user.id, purpose, lecturer, body.start_date, body.due_date, 'REQUESTED', date, date);
      const recorded = this.event(id, user, 'REQUESTED', 'Pengajuan mahasiswa');
      this.queueContractCall(this.db.prepare('SELECT * FROM loans WHERE id=?').get(id), user, 'REQUESTED', recorded);
      return this.loan(id, user);
    });
  }

  event(loanId, user, type, note, evidence = null) {
    const id = randomUUID();
    this.db.prepare('INSERT INTO loan_events VALUES(?,?,?,?,?,?)').run(id, loanId, user.id, type, now(), note);
    if (!evidence) return { eventId: id, proofId: null, digest: null };
    const proofId = 'PROOF-' + randomUUID();
    const loan = this.db.prepare('SELECT * FROM loans WHERE id=?').get(loanId);
    const borrower = this.publicUser(this.db.prepare('SELECT * FROM users WHERE id=?').get(loan.borrower_id));
    const stage = ['handover', 'confirm-pickup', 'cancel'].includes(type) ? 'CHECKOUT' : 'RETURN';
    const attachments = this.db.prepare("SELECT id,filename,digest,stage FROM attachments WHERE loan_id=? AND stage IN (?, 'LEGACY') ORDER BY rowid").all(loanId, stage);
    const payload = {
      schema: 'labpass-evidence-v1', id: proofId, eventId: id, eventType: type, createdAt: now(),
      nonce: randomBytes(32).toString('hex'),
      loan: { id: loan.id, assetId: loan.asset_id, purpose: loan.purpose, lecturer: loan.lecturer, startDate: loan.start_date, dueDate: loan.due_date },
      borrower, actor: this.publicUser(user), evidence, attachments
    };
    const encoded = canonical(payload);
    const hash = digest(encoded);
    this.db.prepare('INSERT INTO evidence_records(id,event_id,payload_json,digest,archive_path) VALUES(?,?,?,?,?)').run(proofId, id, encoded, hash, `archives/${proofId}.json`);
    return { eventId: id, proofId, digest: hash };
  }

  /**
   * Memasukkan satu transaksi kontrak ke antrian (dalam transaksi DB yang sama dengan tindakan).
   * Peminjaman v2 memanggil fungsi status dari wallet aktor. Peminjaman lama hanya mencatat bukti lewat admin.
   */
  queueContractCall(loan, user, action, recorded, extra = {}) {
    let method, actorId, args;
    if (loan.onchain) {
      method = CONTRACT_METHOD[action];
      actorId = user.id;
      args = { loanId: loan.id, assetId: loan.asset_id, proofId: recorded.proofId, digest: recorded.digest, ...extra };
    } else if (recorded.proofId) {
      method = 'recordEvidence';
      actorId = '__admin';
      args = { proofId: recorded.proofId, digest: recorded.digest };
    } else return null;
    const id = randomUUID();
    this.db.prepare('INSERT INTO chain_ops(id,loan_id,asset_id,event_id,evidence_id,actor_id,method,args_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
      .run(id, loan.id, loan.asset_id, recorded.eventId, recorded.proofId, actorId, method, JSON.stringify(args), now());
    return id;
  }

  // Bukti lama (sebelum v2) yang belum tercatat dimasukkan ke antrian sebagai recordEvidence oleh admin.
  queueLegacyEvidence() {
    const pending = this.db.prepare(`SELECT p.id, p.digest, p.event_id, e.loan_id, l.asset_id FROM evidence_records p
      JOIN loan_events e ON e.id=p.event_id JOIN loans l ON l.id=e.loan_id
      WHERE p.chain_status!='RECORDED' AND NOT EXISTS (SELECT 1 FROM chain_ops o WHERE o.evidence_id=p.id) ORDER BY p.rowid`).all();
    for (const record of pending) {
      this.db.prepare('INSERT INTO chain_ops(id,loan_id,asset_id,event_id,evidence_id,actor_id,method,args_json,created_at) VALUES(?,?,?,?,?,?,?,?,?)')
        .run(randomUUID(), record.loan_id, record.asset_id, record.event_id, record.id, '__admin', 'recordEvidence', JSON.stringify({ proofId: record.id, digest: record.digest }), now());
    }
  }

  checkRole(user, role) {
    if (user.role !== role) throw new AppError('Peran tidak diizinkan.', 403);
  }

  checklist(asset, body) {
    const items = body.components;
    if (!Array.isArray(items) || items.length !== asset.components.length) throw new AppError('Checklist seluruh kelengkapan harus diisi.');
    const seen = new Set();
    for (const item of items) {
      const expected = asset.components.find(component => component.id === item.id);
      if (!expected || seen.has(item.id) || !Number.isInteger(item.received) || item.received < 0 || item.received > expected.quantity) throw new AppError('Checklist kelengkapan tidak valid.');
      seen.add(item.id);
    }
    if (!['Baik', 'Lecet', 'Rusak', 'Perlu pemeriksaan'].includes(body.condition)) throw new AppError('Kondisi tidak valid.');
    return {
      condition: body.condition,
      notes: typeof body.notes === 'string' ? body.notes.trim().slice(0, 1200) : '',
      components: asset.components.map(component => ({ ...component, received: items.find(item => item.id === component.id).received }))
    };
  }

  action(id, user, action, body = {}) {
    return this.transaction(() => {
      const loan = this.loan(id, user);
      const asset = this.asset(loan.asset_id);
      let status = loan.status;
      let note = '';
      let proof = null;
      let extra = {};
      const staff = () => this.checkRole(user, 'staff');
      const borrower = () => {
        if (user.id !== loan.borrower_id) throw new AppError('Hanya peminjam terkait yang dapat mengonfirmasi.', 403);
      };
      const requireState = allowed => {
        if (!allowed.includes(loan.status)) throw new AppError('Tindakan tidak sesuai status transaksi.', 409);
      };
      const setAsset = (assetStatus, condition) => condition === undefined
        ? this.db.prepare('UPDATE assets SET status=? WHERE id=?').run(assetStatus, asset.id)
        : this.db.prepare('UPDATE assets SET status=?,condition=? WHERE id=?').run(assetStatus, condition, asset.id);

      switch (action) {
        case 'approve':
          staff();
          requireState(['REQUESTED']);
          if (asset.status !== 'AVAILABLE') throw new AppError('Alat sudah dipesan atau tidak tersedia.', 409);
          status = 'APPROVED';
          setAsset('RESERVED');
          this.db.prepare('UPDATE loans SET staff_id=? WHERE id=?').run(user.id, id);
          note = 'Petugas menyetujui; alat belum diserahkan';
          break;
        case 'reject':
          staff();
          requireState(['REQUESTED']);
          status = 'REJECTED';
          note = text(body.notes, 'Alasan penolakan', 600);
          this.db.prepare('UPDATE loans SET rejection_note=? WHERE id=?').run(note, id);
          break;
        case 'cancel':
          borrower();
          requireState(['REQUESTED', 'APPROVED', 'HANDOVER_PENDING']);
          status = 'CANCELLED';
          if (['APPROVED', 'HANDOVER_PENDING'].includes(loan.status)) setAsset('AVAILABLE');
          note = 'Peminjam membatalkan sebelum konfirmasi penerimaan alat';
          if (loan.status === 'HANDOVER_PENDING') proof = { previousStatus: loan.status, reason: note, checkout: JSON.parse(loan.checkout_json) };
          break;
        case 'handover':
          staff();
          requireState(['APPROVED']);
          proof = this.checklist(asset, body);
          if (proof.components.some(item => item.received !== item.quantity)) throw new AppError('Serah terima awal harus lengkap. Perbaiki paket alat terlebih dahulu.');
          if (['Rusak', 'Perlu pemeriksaan'].includes(proof.condition)) throw new AppError('Alat perlu pemeriksaan tidak dapat diserahkan.');
          status = 'HANDOVER_PENDING';
          this.db.prepare('UPDATE loans SET checkout_json=? WHERE id=?').run(canonical(proof), id);
          note = 'Petugas mencatat kondisi awal; menunggu konfirmasi peminjam';
          break;
        case 'confirm-pickup':
          borrower();
          requireState(['HANDOVER_PENDING']);
          status = 'BORROWED';
          proof = { ...JSON.parse(loan.checkout_json), confirmation: 'Peminjam menyetujui rekaman serah terima melalui aplikasi', confirmationMode: loan.onchain ? 'custodial-wallet-per-akun' : 'backend-custodial' };
          setAsset('BORROWED');
          note = 'Peminjam mengonfirmasi penerimaan alat';
          break;
        case 'request-return':
          borrower();
          requireState(['BORROWED']);
          status = 'RETURN_REQUESTED';
          note = 'Peminjam mengajukan pengembalian; belum selesai diperiksa';
          break;
        case 'inspect-return':
          staff();
          requireState(['RETURN_REQUESTED']);
          proof = this.checklist(asset, body);
          status = 'RETURN_PENDING';
          extra = { flagInspection: needsInspection(proof) };
          this.db.prepare('UPDATE loans SET return_json=? WHERE id=?').run(canonical(proof), id);
          setAsset('INSPECTION');
          note = 'Petugas mencatat hasil pemeriksaan pengembalian';
          break;
        case 'confirm-return': {
          borrower();
          requireState(['RETURN_PENDING']);
          status = 'CLOSED';
          proof = { ...JSON.parse(loan.return_json), confirmation: 'Peminjam menyetujui rekaman pengembalian melalui aplikasi', confirmationMode: loan.onchain ? 'custodial-wallet-per-akun' : 'backend-custodial' };
          const inspect = needsInspection(proof);
          setAsset(inspect ? 'INSPECTION' : 'AVAILABLE', proof.condition);
          note = inspect ? 'Transaksi selesai; alat memerlukan pemeriksaan' : 'Transaksi selesai; alat tersedia kembali';
          break;
        }
        default:
          throw new AppError('Tindakan tidak dikenal.', 404);
      }
      this.db.prepare('UPDATE loans SET status=?,updated_at=? WHERE id=?').run(status, now(), id);
      const recorded = this.event(id, user, action, note, proof);
      this.queueContractCall(loan, user, action, recorded, extra);
      return this.detail(id, user);
    });
  }

  /** Petugas menandai alat selesai diperiksa. Dicatat on-chain sebagai releaseAsset dari wallet petugas. */
  releaseAsset(assetId, user) {
    this.checkRole(user, 'staff');
    return this.transaction(() => {
      const asset = this.asset(assetId);
      if (asset.status !== 'INSPECTION') throw new AppError('Alat tidak sedang perlu pemeriksaan.', 409);
      const active = this.db.prepare(`SELECT id FROM loans WHERE asset_id=? AND status IN (${ACTIVE_STATUSES.map(() => '?').join(',')})`).get(asset.id, ...ACTIVE_STATUSES);
      if (active) throw new AppError('Selesaikan pengembalian terlebih dahulu.', 409);
      this.db.prepare("UPDATE assets SET status='AVAILABLE',condition='Baik' WHERE id=?").run(asset.id);
      this.db.prepare('INSERT INTO chain_ops(id,loan_id,asset_id,actor_id,method,args_json,created_at) VALUES(?,?,?,?,?,?,?)')
        .run(randomUUID(), null, asset.id, user.id, 'releaseAsset', JSON.stringify({ assetId: asset.id }), now());
      return this.asset(asset.id);
    });
  }

  // ---------- Pencatatan ke blockchain ----------

  /** Memproses antrian kontrak. Panggilan bersamaan menunggu putaran yang sedang berjalan. */
  flushEvidence() {
    const run = (this.flushing || Promise.resolve()).then(() => this.processChainQueue());
    this.flushing = run.catch(() => {});
    return run;
  }

  async processChainQueue() {
    // Urutan per alat dijaga: jika satu transaksi gagal, transaksi berikutnya untuk alat/peminjaman itu ditahan.
    const blocked = new Set();
    const ops = this.db.prepare("SELECT * FROM chain_ops WHERE status IN ('PENDING','FAILED') ORDER BY rowid").all();
    for (const op of ops) {
      const keys = [op.loan_id && `loan:${op.loan_id}`, op.asset_id && `asset:${op.asset_id}`].filter(Boolean);
      const record = op.evidence_id ? this.db.prepare('SELECT * FROM evidence_records WHERE id=?').get(op.evidence_id) : null;
      try {
        if (record) {
          // Arsip ditulis setelah commit DB. Retry tidak pernah menimpa arsip yang sudah ada.
          const archive = path.join(this.dataDir, record.archive_path);
          if (!fs.existsSync(archive)) fs.writeFileSync(archive, record.payload_json, { flag: 'wx' });
          if (digest(fs.readFileSync(archive, 'utf8')) !== record.digest) throw new Error('Arsip tidak cocok dengan hash tersimpan.');
        }
        if (keys.some(key => blocked.has(key))) throw new Error('Menunggu transaksi sebelumnya untuk alat ini tercatat.');
        if (!this.chain) throw new Error('Jaringan lokal tidak tersedia. Bukti menunggu pencatatan, bukan bukti on-chain.');
        const receipt = await this.chain.execute(op.method, op.actor_id, JSON.parse(op.args_json));
        this.db.prepare("UPDATE chain_ops SET status='RECORDED',tx_hash=coalesce(?,tx_hash),block_number=coalesce(?,block_number),gas_used=coalesce(?,gas_used),from_address=coalesce(?,from_address),error=NULL WHERE id=?")
          .run(receipt.txHash, receipt.blockNumber, receipt.gasUsed, receipt.from, op.id);
        if (record) {
          this.db.prepare("UPDATE evidence_records SET chain_status='RECORDED',tx_hash=coalesce(?,tx_hash),block_number=coalesce(?,block_number),gas_used=coalesce(?,gas_used),chain_error=NULL WHERE id=?")
            .run(receipt.txHash, receipt.blockNumber, receipt.gasUsed, record.id);
        }
      } catch (error) {
        keys.forEach(key => blocked.add(key));
        const message = error.message.slice(0, 500);
        this.db.prepare("UPDATE chain_ops SET status='FAILED',error=? WHERE id=?").run(message, op.id);
        if (record) this.db.prepare("UPDATE evidence_records SET chain_status='FAILED',chain_error=? WHERE id=?").run(message, record.id);
      }
    }
  }

  pendingCount() {
    return this.db.prepare("SELECT count(*) as n FROM chain_ops WHERE status!='RECORDED'").get().n;
  }

  /** Status peminjaman menurut kontrak, untuk dibandingkan dengan status database. */
  async chainState(loanId, user) {
    const loan = this.loan(loanId, user);
    const base = { onchain: Boolean(loan.onchain), contractVersion: loan.onchain ? 2 : 1 };
    if (!loan.onchain) return { ...base, note: 'Peminjaman dibuat sebelum kontrak v2; hanya bukti yang dicatat on-chain.' };
    if (!this.chain) return { ...base, available: false };
    const state = await this.chain.readLoan(loan.id);
    const expected = { REQUESTED: 'Requested', APPROVED: 'Approved', HANDOVER_PENDING: 'HandoverPending', BORROWED: 'Borrowed', RETURN_REQUESTED: 'ReturnRequested', RETURN_PENDING: 'ReturnPending', CLOSED: 'Closed', REJECTED: 'Rejected', CANCELLED: 'Cancelled' }[loan.status];
    return {
      ...base, available: true, ...state,
      borrowerWallet: this.chain.walletOf(loan.borrower_id),
      matchesDatabase: state.status === expected
    };
  }

  async assetHistory(assetId) {
    const asset = this.asset(assetId);
    if (!this.chain) throw new AppError('Jaringan lokal tidak tersedia.', 503);
    const names = Object.fromEntries(this.db.prepare('SELECT id,name FROM users').all().map(user => [user.id, user.name]));
    const items = (await this.chain.assetHistory(asset.id)).map(item => ({ ...item, actorName: item.actorId ? names[item.actorId] || item.actorId : undefined }));
    return { assetId: asset.id, state: await this.chain.readAsset(asset.id), items };
  }

  /** Menjalankan satu transaksi yang harus ditolak kontrak. Tidak mengubah database. */
  async rejectionTest(user, scenario, loanId) {
    this.checkRole(user, 'staff');
    if (!REJECTION_SCENARIOS[scenario]) throw new AppError('Skenario uji tidak dikenal.', 404);
    if (!this.chain) throw new AppError('Jaringan lokal tidak tersedia.', 503);
    const random = () => '0x' + randomBytes(32).toString('hex');
    let loan = null;
    if (loanId) loan = this.loan(loanId, user);
    let actorId, method, args;
    if (scenario === 'student-approve') {
      actorId = loan ? loan.borrower_id : 'mhs-1';
      method = 'approve';
      args = { loanId: loan ? loan.id : 'UJI-TOLAK' };
    } else if (scenario === 'staff-confirm') {
      if (!loan || !loan.onchain) throw new AppError('Pilih peminjaman yang dibuat dengan kontrak v2.', 409);
      actorId = user.id;
      method = 'confirmPickup';
      args = { loanId: loan.id, proofId: 'UJI-TOLAK-' + randomUUID(), digest: random() };
    } else {
      actorId = '__outsider';
      method = 'recordEvidence';
      args = { proofId: 'UJI-TOLAK-' + randomUUID(), digest: random() };
    }
    const before = loan?.onchain ? await this.chain.readLoan(loan.id) : null;
    let result;
    try {
      result = await this.chain.rejectionTest(actorId, method, args);
    } catch (error) {
      throw new AppError(error.message, 409);
    }
    const after = loan?.onchain ? await this.chain.readLoan(loan.id) : null;
    return { scenario, description: REJECTION_SCENARIOS[scenario], loanId: loan?.id || null, ...result, args: undefined, statusBefore: before?.status || null, statusAfter: after?.status || null };
  }

  // ---------- Verifikasi ----------

  proof(id, user) {
    const proof = this.db.prepare('SELECT p.*,e.loan_id FROM evidence_records p JOIN loan_events e ON e.id=p.event_id WHERE p.id=?').get(id);
    if (!proof) throw new AppError('Bukti tidak ditemukan.', 404);
    this.loan(proof.loan_id, user);
    return proof;
  }

  async verify(id, user, candidate = null) {
    const proof = this.proof(id, user);
    const stored = JSON.parse(proof.payload_json);
    const archivedPath = path.join(this.dataDir, proof.archive_path);
    const archived = fs.existsSync(archivedPath) ? fs.readFileSync(archivedPath, 'utf8') : null;
    const chainProof = this.chain ? await this.chain.read(id) : null;
    const currentBorrower = this.publicUser(this.db.prepare('SELECT * FROM users WHERE id=?').get(stored.borrower.id));
    const live = { ...stored, borrower: currentBorrower };
    const files = stored.attachments.map(attachment => {
      const row = this.db.prepare('SELECT * FROM attachments WHERE id=?').get(attachment.id);
      const file = row && path.join(this.dataDir, row.relative_path);
      const available = Boolean(file && fs.existsSync(file));
      return { id: attachment.id, filename: attachment.filename, available, matches: available && digest(fs.readFileSync(file)) === attachment.digest };
    });
    const actualCandidate = candidate === null ? null : digest(canonical(candidate));
    return {
      id, algorithm: 'SHA-256', expectedHash: proof.digest,
      chainHash: chainProof?.digest || null, chainStatus: proof.chain_status,
      chainContract: chainProof?.contract || null, chainVersion: chainProof?.version || null,
      dbMatches: digest(proof.payload_json) === proof.digest,
      archiveAvailable: archived !== null,
      archiveMatches: archived !== null && digest(archived) === proof.digest,
      chainMatches: Boolean(chainProof?.recordedAt && chainProof.digest.toLowerCase() === proof.digest.toLowerCase()),
      liveIdentityMatches: digest(live) === proof.digest,
      files,
      candidateHash: actualCandidate,
      candidateMatches: actualCandidate === null ? null : actualCandidate === proof.digest,
      txHash: proof.tx_hash, blockNumber: proof.block_number, gasUsed: proof.gas_used
    };
  }

  // ---------- Foto ----------

  addAttachment(loanId, user, body) {
    const loan = this.loan(loanId, user);
    if (['CLOSED', 'REJECTED', 'CANCELLED'].includes(loan.status)) throw new AppError('Transaksi selesai tidak menerima bukti baru.', 409);
    const stage = this.photoStage(loan.status);
    if (!stage) throw new AppError('Pemeriksaan sudah tersimpan dan menunggu konfirmasi. Foto pada tahap ini sudah dikunci.', 409);
    if (body.stage !== undefined && body.stage !== stage) throw new AppError('Tahap peminjaman sudah berubah. Perbarui status sebelum mengunggah foto.', 409);
    const filename = text(body.filename, 'Nama file', 120).replace(/[\\/]/g, '_');
    const buffer = Buffer.from(body.base64 || '', 'base64');
    if (!buffer.length || buffer.length > 3 * 1024 * 1024) throw new AppError('Foto wajib diisi, maksimum 3 MB.');
    const png = buffer.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    const jpeg = buffer[0] === 255 && buffer[1] === 216 && buffer[2] === 255;
    if (!png && !jpeg) throw new AppError('Hanya foto PNG atau JPEG yang diizinkan.');
    const id = randomUUID();
    const mime = png ? 'image/png' : 'image/jpeg';
    const relative = `uploads/${id}.${png ? 'png' : 'jpg'}`;
    fs.writeFileSync(path.join(this.dataDir, relative), buffer, { flag: 'wx' });
    try {
      this.transaction(() => {
        this.db.prepare('INSERT INTO attachments(id,loan_id,filename,mime,digest,relative_path,created_by,created_at,stage) VALUES(?,?,?,?,?,?,?,?,?)')
          .run(id, loanId, filename, mime, digest(buffer), relative, user.id, now(), stage);
        this.event(loanId, user, 'attachment', stage === 'CHECKOUT' ? 'Foto serah terima awal ditambahkan' : 'Foto pengembalian ditambahkan');
      });
    } catch (error) {
      fs.unlinkSync(path.join(this.dataDir, relative));
      throw error;
    }
    return { id, filename, digest: digest(buffer), stage };
  }

  photoStage(status) {
    if (['REQUESTED', 'APPROVED'].includes(status)) return 'CHECKOUT';
    if (['BORROWED', 'RETURN_REQUESTED'].includes(status)) return 'RETURN';
    return null;
  }
}
