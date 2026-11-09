import fs from 'node:fs';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import ganache from 'ganache';
import solc from 'solc';
import { BrowserProvider, Contract, ContractFactory, keccak256, toUtf8Bytes } from 'ethers';

export function compileContract() {
  const source = fs.readFileSync(new URL('../contracts/LabPass.sol', import.meta.url), 'utf8');
  const result = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources: { 'LabPass.sol': { content: source } }, settings: { evmVersion: 'shanghai', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object'] } } } })));
  const errors = result.errors?.filter(e => e.severity === 'error');
  if (errors?.length) throw new Error(errors.map(e => e.formattedMessage).join('\n'));
  return result.contracts['LabPass.sol'].LabPass;
}

export async function openChain(dataDir, { memory = false } = {}) {
  const artifact = compileContract();
  fs.mkdirSync(dataDir, { recursive: true });
  const seedPath = path.join(dataDir, 'wallet-seed.json');
  const seed = !memory && fs.existsSync(seedPath) ? JSON.parse(fs.readFileSync(seedPath, 'utf8')).seed : randomBytes(32).toString('hex');
  if (!memory && !fs.existsSync(seedPath)) fs.writeFileSync(seedPath, JSON.stringify({ seed }), { mode: 0o600 });
  const raw = ganache.provider({ logging: { quiet: true }, chain: { chainId: 1337, hardfork: 'shanghai' }, wallet: { totalAccounts: 3, seed }, ...(memory ? {} : { database: { dbPath: path.join(dataDir, 'chain') } }) });
  const provider = new BrowserProvider(raw);
  provider.pollingInterval = 100;
  const signer = await provider.getSigner(0);
  const metadataPath = path.join(dataDir, 'contract.json');
  let metadata = !memory && fs.existsSync(metadataPath) ? JSON.parse(fs.readFileSync(metadataPath, 'utf8')) : null;
  let contract;
  if (metadata && await provider.getCode(metadata.address) !== '0x') {
    contract = new Contract(metadata.address, artifact.abi, signer);
    if ((await contract.operator()).toLowerCase() !== (await signer.getAddress()).toLowerCase()) throw new Error('Operator lokal berbeda dari operator kontrak tersimpan.');
  } else {
    contract = await new ContractFactory(artifact.abi, artifact.evm.bytecode.object, signer).deploy();
    await contract.waitForDeployment();
    metadata = { address: await contract.getAddress(), chainId: 1337, mode: 'local-evm', deployedAt: new Date().toISOString() };
    if (!memory) fs.writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
  }
  return {
    metadata,
    async anchor(id, digest) {
      const key = keccak256(toUtf8Bytes(id));
      const existing = await contract.proofs(key);
      if (existing.recordedAt !== 0n) {
        if (existing.digest.toLowerCase() !== digest.toLowerCase()) throw new Error('ID bukti sudah memiliki hash lain.');
        return { txHash: null, blockNumber: null, gasUsed: null };
      }
      const receipt = await (await contract.recordEvidence(key, digest)).wait();
      return { txHash: receipt.hash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed.toString() };
    },
    async read(id) { const p = await contract.proofs(keccak256(toUtf8Bytes(id))); return { digest: p.digest, recordedAt: Number(p.recordedAt) }; },
    async close() { await provider.destroy(); await raw.disconnect(); },
    contract, provider, raw
  };
}
