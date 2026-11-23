import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import ganache from 'ganache';
import solc from 'solc';
import {
  BrowserProvider, Contract, ContractFactory, keccak256, toUtf8Bytes,
  encodeBytes32String, decodeBytes32String, parseEther, ZeroHash
} from 'ethers';

export const CONTRACT_VERSION = 2;
export const STATUS_NAMES = ['None', 'Requested', 'Approved', 'HandoverPending', 'Borrowed', 'ReturnRequested', 'ReturnPending', 'Closed', 'Rejected', 'Cancelled'];
const ROLE = { student: 1, staff: 2 };
const TOTAL_ACCOUNTS = 12;            // 0 = admin, 1..10 = akun aplikasi, 11 = akun luar tanpa peran
const OUTSIDER_INDEX = TOTAL_ACCOUNTS - 1;
const LEGACY_ABI = ['function proofs(bytes32) view returns (bytes32 digest, uint256 recordedAt)'];

// ID pendek (loan, alat) disimpan sebagai teks bytes32 agar tetap terbaca di Remix/log.
export function idKey(id) {
  return Buffer.byteLength(id, 'utf8') <= 31 ? encodeBytes32String(id) : keccak256(toUtf8Bytes(id));
}
export const proofKey = id => keccak256(toUtf8Bytes(id));
export function keyToText(key) {
  try { return decodeBytes32String(key); } catch { return key; }
}

export function compileContract(file = 'LabPass.sol', name = 'LabPass') {
  const source = fs.readFileSync(new URL(`../contracts/${file}`, import.meta.url), 'utf8');
  const input = {
    language: 'Solidity',
    sources: { [file]: { content: source } },
    settings: { evmVersion: 'shanghai', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } }
  };
  const result = JSON.parse(solc.compile(JSON.stringify(input)));
  const errors = result.errors?.filter(error => error.severity === 'error');
  if (errors?.length) throw new Error(errors.map(error => error.formattedMessage).join('\n'));
  return result.contracts[file][name];
}

function readJson(file) {
  return fs.existsSync(file) ? JSON.parse(fs.readFileSync(file, 'utf8')) : null;
}

// Mengubah error ethers menjadi nama custom error kontrak, misalnya NotBorrower atau InvalidStatus(Borrowed).
export function revertReason(error) {
  const revert = error?.revert;
  if (revert?.name) {
    const args = revert.name === 'InvalidStatus' ? [STATUS_NAMES[Number(revert.args[0])]] : [...(revert.args || [])].map(String);
    return { name: revert.name, args, text: args.length ? `${revert.name}(${args.join(', ')})` : revert.name };
  }
  return null;
}

/**
 * Membuka EVM lokal (Ganache), memasang kontrak v2, dan menyiapkan satu wallet per akun aplikasi.
 * users: [{ id, role }] dari tabel users. Kunci wallet tetap dipegang backend (custodial).
 */
export async function openChain(dataDir, { memory = false, users = [] } = {}) {
  const artifact = compileContract();
  fs.mkdirSync(dataDir, { recursive: true });
  const seedPath = path.join(dataDir, 'wallet-seed.json');
  const seed = !memory && fs.existsSync(seedPath) ? readJson(seedPath).seed : randomBytes(32).toString('hex');
  if (!memory && !fs.existsSync(seedPath)) fs.writeFileSync(seedPath, JSON.stringify({ seed }), { mode: 0o600 });

  const raw = ganache.provider({
    logging: { quiet: true },
    chain: { chainId: 1337, hardfork: 'shanghai' },
    wallet: { totalAccounts: TOTAL_ACCOUNTS, seed },
    ...(memory ? {} : { database: { dbPath: path.join(dataDir, 'chain') } })
  });
  const provider = new BrowserProvider(raw);
  provider.pollingInterval = 100;
  const accounts = await provider.send('eth_accounts', []);
  const adminSigner = await provider.getSigner(accounts[0]);
  const adminAddress = accounts[0];

  // Wallet per akun: urut ID agar tetap sama setiap restart.
  const sortedUsers = [...users].sort((a, b) => a.id.localeCompare(b.id));
  if (sortedUsers.length > OUTSIDER_INDEX - 1) throw new Error('Jumlah akun melebihi wallet lokal yang tersedia.');
  const wallets = Object.fromEntries(sortedUsers.map((user, index) => [user.id, accounts[index + 1]]));
  const outsider = accounts[OUTSIDER_INDEX];

  // Ganache hanya memberi saldo awal saat chain pertama dibuat. Wallet baru diisi dari admin.
  for (const address of [...Object.values(wallets), outsider]) {
    if (await provider.getBalance(address) < parseEther('1')) {
      await (await adminSigner.sendTransaction({ to: address, value: parseEther('10') })).wait();
    }
  }

  const metadataPath = path.join(dataDir, 'contract.json');
  let metadata = memory ? null : readJson(metadataPath);
  const legacy = [...(metadata?.legacy || [])];
  let contract;
  const codeExists = async address => address && await provider.getCode(address) !== '0x';

  if (metadata?.version === CONTRACT_VERSION && await codeExists(metadata.address)) {
    contract = new Contract(metadata.address, artifact.abi, adminSigner);
    if ((await contract.admin()).toLowerCase() !== adminAddress.toLowerCase()) throw new Error('Admin lokal berbeda dari admin kontrak tersimpan.');
  } else {
    // Kontrak v1 yang masih ada di chain disimpan sebagai legacy agar bukti lama tetap dapat diverifikasi.
    if (metadata && !metadata.version && await codeExists(metadata.address)) {
      legacy.push({ version: 1, address: metadata.address, deployedAt: metadata.deployedAt });
    }
    contract = await new ContractFactory(artifact.abi, artifact.evm.bytecode.object, adminSigner).deploy();
    await contract.waitForDeployment();
    metadata = { address: await contract.getAddress(), deployedAt: new Date().toISOString() };
  }

  for (const user of sortedUsers) {
    const expected = ROLE[user.role] ?? 0;
    if (Number(await contract.roles(wallets[user.id])) !== expected) {
      await (await contract.setRole(wallets[user.id], expected)).wait();
    }
  }

  const liveLegacy = [];
  for (const item of legacy) if (await codeExists(item.address)) liveLegacy.push(item);
  legacy.splice(0, legacy.length, ...liveLegacy);
  metadata = { ...metadata, chainId: 1337, mode: 'local-evm', version: CONTRACT_VERSION, admin: adminAddress, wallets, outsider, legacy };
  if (!memory) fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
  const legacyContracts = legacy.map(item => new Contract(item.address, LEGACY_ABI, provider));
  const nameOf = address => {
    const lower = address.toLowerCase();
    if (lower === adminAddress.toLowerCase()) return 'admin';
    if (lower === outsider.toLowerCase()) return 'akun-luar';
    return Object.keys(wallets).find(id => wallets[id].toLowerCase() === lower) || address;
  };

  async function signerFor(actorId) {
    if (actorId === '__admin') return adminSigner;
    if (actorId === '__outsider') return provider.getSigner(outsider);
    if (!wallets[actorId]) throw new Error(`Akun ${actorId} belum punya wallet lokal.`);
    return provider.getSigner(wallets[actorId]);
  }

  // Argumen kontrak untuk setiap metode, dari ID aplikasi.
  function contractArgs(method, args) {
    const proof = () => [args.proofId ? proofKey(args.proofId) : ZeroHash, args.digest || ZeroHash];
    switch (method) {
      case 'requestLoan': return [idKey(args.loanId), idKey(args.assetId)];
      case 'approve': case 'reject': case 'requestReturn': return [idKey(args.loanId)];
      case 'cancel': case 'handover': case 'confirmPickup': case 'confirmReturn': return [idKey(args.loanId), ...proof()];
      case 'inspectReturn': return [idKey(args.loanId), ...proof(), Boolean(args.flagInspection)];
      case 'releaseAsset': return [idKey(args.assetId)];
      case 'recordEvidence': return [proofKey(args.proofId), args.digest];
      default: throw new Error(`Metode kontrak tidak dikenal: ${method}`);
    }
  }

  // Status tujuan tiap metode. Dipakai agar retry tidak mengirim ulang transisi yang sudah tercatat.
  const targetStatus = {
    requestLoan: 'Requested', approve: 'Approved', reject: 'Rejected', cancel: 'Cancelled', handover: 'HandoverPending',
    confirmPickup: 'Borrowed', requestReturn: 'ReturnRequested', inspectReturn: 'ReturnPending', confirmReturn: 'Closed'
  };

  async function alreadyApplied(method, args) {
    if (args.proofId) {
      const existing = await contract.proofs(proofKey(args.proofId));
      if (existing.recordedAt !== 0n) {
        if (existing.digest.toLowerCase() !== String(args.digest).toLowerCase()) throw new Error('ID bukti sudah memiliki hash lain.');
        return true;
      }
      if (method === 'recordEvidence') return false;
    }
    if (targetStatus[method] && args.loanId) {
      const loan = await contract.loans(idKey(args.loanId));
      return STATUS_NAMES[Number(loan.status)] === targetStatus[method];
    }
    return false;
  }

  return {
    metadata,
    contract,
    provider,
    raw,
    walletOf: id => wallets[id] || null,
    nameOf,

    /** Mengirim satu transaksi dari wallet akun yang melakukan tindakan. */
    async execute(method, actorId, args) {
      if (await alreadyApplied(method, args)) return { txHash: null, blockNumber: null, gasUsed: null, from: null, skipped: true };
      const signer = await signerFor(actorId);
      const connected = contract.connect(signer);
      const callArgs = contractArgs(method, args);
      try {
        const receipt = await (await connected[method](...callArgs)).wait();
        return { txHash: receipt.hash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed.toString(), from: await signer.getAddress() };
      } catch (error) {
        // Estimasi gas Ganache tidak membawa data revert; eth_call dipakai untuk membaca nama error kontrak.
        let reason = revertReason(error);
        if (!reason) {
          try { await connected[method].staticCall(...callArgs); } catch (callError) { reason = revertReason(callError); }
        }
        throw new Error(reason ? `Kontrak menolak: ${reason.text}` : (error.shortMessage || error.message));
      }
    },

    /** Kompatibilitas: mencatat bukti oleh admin tanpa transisi status. */
    anchor(id, digest) {
      return this.execute('recordEvidence', '__admin', { proofId: id, digest });
    },

    /** Membaca komitmen bukti dari kontrak v2, lalu kontrak lama bila tidak ditemukan. */
    async read(id) {
      const key = proofKey(id);
      const current = await contract.proofs(key);
      if (current.recordedAt !== 0n) return { digest: current.digest, recordedAt: Number(current.recordedAt), contract: metadata.address, version: CONTRACT_VERSION };
      for (const [index, old] of legacyContracts.entries()) {
        const proof = await old.proofs(key);
        if (proof.recordedAt !== 0n) return { digest: proof.digest, recordedAt: Number(proof.recordedAt), contract: legacy[index].address, version: legacy[index].version };
      }
      return { digest: ZeroHash, recordedAt: 0, contract: null, version: null };
    },

    async readLoan(loanId) {
      const loan = await contract.loans(idKey(loanId));
      const status = STATUS_NAMES[Number(loan.status)];
      if (status === 'None') return { exists: false, status };
      return {
        exists: true, status,
        borrower: loan.borrower, borrowerId: nameOf(loan.borrower),
        staff: loan.staff === '0x0000000000000000000000000000000000000000' ? null : loan.staff,
        staffId: loan.staff === '0x0000000000000000000000000000000000000000' ? null : nameOf(loan.staff),
        flagInspection: loan.flagInspection, updatedAt: Number(loan.updatedAt)
      };
    },

    async readAsset(assetId) {
      const key = idKey(assetId);
      const active = await contract.activeLoanOf(key);
      return { activeLoan: active === ZeroHash ? null : keyToText(active), needsInspection: await contract.needsInspection(key), lastDigest: await contract.lastDigestOf(key) };
    },

    /** Riwayat satu alat langsung dari log event kontrak ("paspor alat"). */
    async assetHistory(assetId) {
      const key = idKey(assetId);
      const [moves, proofs, releases] = await Promise.all([
        contract.queryFilter(contract.filters.LoanStatusChanged(null, key)),
        contract.queryFilter(contract.filters.EvidenceRecorded(null, key)),
        contract.queryFilter(contract.filters.AssetReleased(key))
      ]);
      const items = [
        ...moves.map(log => ({ kind: 'status', loanId: keyToText(log.args.loanId), actor: log.args.actor, from: STATUS_NAMES[Number(log.args.from)], to: STATUS_NAMES[Number(log.args.to)], log })),
        ...proofs.map(log => ({ kind: 'evidence', loanId: keyToText(log.args.loanId), digest: log.args.digest, previousDigest: log.args.previousDigest, log })),
        ...releases.map(log => ({ kind: 'release', actor: log.args.actor, log }))
      ];
      items.sort((a, b) => a.log.blockNumber - b.log.blockNumber || a.log.index - b.log.index);
      return items.map(({ log, ...item }) => ({ ...item, actorId: item.actor ? nameOf(item.actor) : undefined, txHash: log.transactionHash, blockNumber: log.blockNumber }));
    },

    /**
     * Mengirim transaksi yang memang harus ditolak kontrak, lalu mengembalikan bukti penolakan:
     * nama custom error dari simulasi dan tx hash berstatus gagal (status 0) yang benar-benar masuk blok.
     */
    async rejectionTest(actorId, method, args) {
      const signer = await signerFor(actorId);
      const connected = contract.connect(signer);
      const callArgs = contractArgs(method, args);
      let reason = null;
      try {
        await connected[method].staticCall(...callArgs);
      } catch (error) {
        reason = revertReason(error) || { name: 'Revert', args: [], text: error.shortMessage || error.message };
      }
      if (!reason) throw new Error('Skenario ini tidak ditolak kontrak, sehingga tidak dikirim.');
      // gasLimit tetap agar ethers tidak membatalkan di tahap estimasi; transaksi gagal tetap tercatat di blok.
      const tx = await connected[method](...callArgs, { gasLimit: 300000n });
      let receipt = null;
      for (let attempt = 0; attempt < 50 && !receipt; attempt++) {
        receipt = await provider.getTransactionReceipt(tx.hash);
        if (!receipt) await new Promise(resolve => setTimeout(resolve, 100));
      }
      if (!receipt) throw new Error('Transaksi uji belum masuk blok.');
      return {
        method, args: callArgs, caller: await signer.getAddress(), callerId: actorId.startsWith('__') ? nameOf(await signer.getAddress()) : actorId,
        error: reason.text, errorName: reason.name, txHash: tx.hash, blockNumber: receipt.blockNumber, status: receipt.status, gasUsed: receipt.gasUsed.toString()
      };
    },

    async close() {
      await provider.destroy();
      await raw.disconnect();
    }
  };
}
