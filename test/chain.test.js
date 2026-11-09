import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { openChain } from '../lib/chain.js';
import { digest } from '../lib/service.js';

test('Kontrak, operator, dan bukti bertahan setelah chain lokal dimulai ulang',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'labpass-persistence-'));let chain;
 try{
  chain=await openChain(dir);const address=chain.metadata.address,operator=await chain.contract.operator();const hash=digest({example:'persistent'});await chain.anchor('persistent-proof',hash);await chain.close();chain=null;
  chain=await openChain(dir);assert.equal(chain.metadata.address,address);assert.equal(await chain.contract.operator(),operator);assert.equal((await chain.read('persistent-proof')).digest,hash);await chain.anchor('after-restart',hash);assert.equal((await chain.read('after-restart')).digest,hash);
 }finally{if(chain)await chain.close();if(path.basename(dir).startsWith('labpass-persistence-'))fs.rmSync(dir,{recursive:true,force:true});}
});
