import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { randomBytes } from 'node:crypto';
import ganache from 'ganache';
import { BrowserProvider, ContractFactory, keccak256, toUtf8Bytes } from 'ethers';
import { openChain, compileContract } from '../lib/chain.js';
import { digest } from '../lib/service.js';

const users = [{ id: 'mhs-1', role: 'student' }, { id: 'staff-zaenal', role: 'staff' }];
const tempDir = prefix => fs.mkdtempSync(path.join(os.tmpdir(), prefix));
const cleanup = (dir, prefix) => { if (path.basename(dir).startsWith(prefix)) fs.rmSync(dir, { recursive: true, force: true }); };

test('Kontrak v2, admin, wallet akun, dan bukti bertahan setelah chain lokal dimulai ulang', async () => {
  const dir = tempDir('labpass-persistence-');
  let chain;
  try {
    chain = await openChain(dir, { users });
    const address = chain.metadata.address;
    const admin = await chain.contract.admin();
    const wallet = chain.walletOf('mhs-1');
    assert.equal(chain.metadata.version, 2);
    assert.equal(Number(await chain.contract.roles(wallet)), 1);
    assert.equal(Number(await chain.contract.roles(chain.walletOf('staff-zaenal'))), 2);
    const hash = digest({ example: 'persistent' });
    await chain.anchor('persistent-proof', hash);
    await chain.close();
    chain = null;

    chain = await openChain(dir, { users });
    assert.equal(chain.metadata.address, address);
    assert.equal(await chain.contract.admin(), admin);
    assert.equal(chain.walletOf('mhs-1'), wallet);
    assert.equal((await chain.read('persistent-proof')).digest, hash);
    await chain.anchor('after-restart', hash);
    assert.equal((await chain.read('after-restart')).digest, hash);
  } finally {
    if (chain) await chain.close();
    cleanup(dir, 'labpass-persistence-');
  }
});

test('Data dari kontrak v1 tetap terverifikasi setelah upgrade ke v2', async () => {
  const dir = tempDir('labpass-upgrade-');
  let chain;
  try {
    // Siapkan keadaan seperti folder data lama: seed, chain Ganache, dan kontrak v1.
    const seed = randomBytes(32).toString('hex');
    fs.writeFileSync(path.join(dir, 'wallet-seed.json'), JSON.stringify({ seed }));
    const raw = ganache.provider({ logging: { quiet: true }, chain: { chainId: 1337, hardfork: 'shanghai' }, wallet: { totalAccounts: 3, seed }, database: { dbPath: path.join(dir, 'chain') } });
    const provider = new BrowserProvider(raw);
    const v1 = compileContract('legacy/LabPassV1.sol', 'LabPassV1');
    const old = await new ContractFactory(v1.abi, v1.evm.bytecode.object, await provider.getSigner(0)).deploy();
    await old.waitForDeployment();
    const oldHash = digest({ example: 'v1' });
    await (await old.recordEvidence(keccak256(toUtf8Bytes('PROOF-LAMA')), oldHash)).wait();
    const oldAddress = await old.getAddress();
    fs.writeFileSync(path.join(dir, 'contract.json'), JSON.stringify({ address: oldAddress, chainId: 1337, mode: 'local-evm', deployedAt: new Date().toISOString() }));
    await provider.destroy();
    await raw.disconnect();

    chain = await openChain(dir, { users });
    assert.equal(chain.metadata.version, 2);
    assert.notEqual(chain.metadata.address, oldAddress);
    assert.deepEqual(chain.metadata.legacy.map(item => item.address), [oldAddress]);
    const proof = await chain.read('PROOF-LAMA');
    assert.equal(proof.digest, oldHash);
    assert.equal(proof.version, 1);
    // Wallet baru mendapat saldo dari admin walau chain lama dibuat dengan 3 akun.
    assert.ok(await chain.provider.getBalance(chain.walletOf('mhs-1')) > 0n);
    await chain.close();
    chain = await openChain(dir, { users });
    assert.equal(chain.metadata.legacy.length, 1);
    assert.equal((await chain.read('PROOF-LAMA')).digest, oldHash);
  } finally {
    if (chain) await chain.close();
    cleanup(dir, 'labpass-upgrade-');
  }
});
