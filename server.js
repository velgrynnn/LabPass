import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { randomBytes } from 'node:crypto';
import { openDatabase, passwordMatches } from './lib/database.js';
import { LabService, AppError } from './lib/service.js';
import { openChain } from './lib/chain.js';

const root=path.dirname(fileURLToPath(import.meta.url));
const dataDir=process.env.LABPASS_DATA_DIR||path.join(root,'data');fs.mkdirSync(dataDir,{recursive:true});
const db=openDatabase(path.join(dataDir,'labpass.sqlite'));
let chain=null,chainError=null;
try{chain=await openChain(dataDir);}catch(e){chainError=e.message;console.error('Blockchain lokal belum tersedia:',e.message);}
const service=new LabService(db,dataDir,chain);
const sessions=new Map(),attempts=new Map();
const port=Number(process.env.PORT||8787);
function json(res,status,data,headers={}){res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers});res.end(JSON.stringify(data));}
async function body(req){let size=0;const chunks=[];for await(const chunk of req){size+=chunk.length;if(size>4500000)throw new AppError('Permintaan terlalu besar.',413);chunks.push(chunk);}try{return JSON.parse(Buffer.concat(chunks).toString()||'{}');}catch{throw new AppError('Format JSON tidak valid.');}}
function session(req){const token=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith('labpass='))?.slice(8);const s=token&&sessions.get(token);if(!s||s.expires<Date.now())throw new AppError('Silakan masuk kembali.',401);return {token,user:db.prepare('SELECT * FROM users WHERE id=?').get(s.userId)};}
const server=http.createServer(async(req,res)=>{
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','same-origin');res.setHeader('X-Frame-Options','DENY');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; base-uri 'none'; frame-ancestors 'none'");
  try{
    const url=new URL(req.url,`http://127.0.0.1:${port}`),route=url.pathname;
    if(['POST','PUT','DELETE','PATCH'].includes(req.method)&&req.headers.origin&&req.headers.origin!==`http://${req.headers.host}`)throw new AppError('Origin tidak diizinkan.',403);
    if(route==='/api/login'&&req.method==='POST'){
      const b=await body(req),key=String(b.id||'').slice(0,80);const trial=attempts.get(key);if(trial&&trial.until>Date.now()&&trial.count>=10)throw new AppError('Terlalu banyak percobaan. Tunggu satu menit.',429);
      const u=db.prepare('SELECT * FROM users WHERE id=?').get(key);if(!u||typeof b.password!=='string'||b.password.length>100||!passwordMatches(b.password,u.password_hash)){const old=trial&&trial.until>Date.now()?trial:{count:0,until:Date.now()+60000};attempts.set(key,{...old,count:old.count+1});throw new AppError('Akun atau kata sandi salah.',401);}
      attempts.delete(key);const token=randomBytes(32).toString('hex');sessions.set(token,{userId:u.id,expires:Date.now()+8*60*60*1000});return json(res,200,{user:service.publicUser(u)},{'Set-Cookie':`labpass=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=28800`});
    }
    if(route==='/api/demo-accounts'&&req.method==='GET')return json(res,200,{accounts:db.prepare('SELECT id,name,role FROM users ORDER BY role,id').all(),password:'demo123',warning:'Semua akun dan data adalah dummy. Hanya untuk penggunaan lokal.'});
    if(route.startsWith('/api/')){
      const {user,token}=session(req);
      if(route==='/api/me')return json(res,200,{user:service.publicUser(user)});
      if(route==='/api/logout'&&req.method==='POST'){sessions.delete(token);return json(res,200,{ok:true},{'Set-Cookie':'labpass=; HttpOnly; SameSite=Strict; Path=/; Max-Age=0'});}
      if(route==='/api/health')return json(res,200,{database:'sqlite',chain:chain?{...chain.metadata,status:'CONNECTED'}:{mode:'unavailable',status:'FAILED',error:chainError},trustModel:'backend-custodial',pending:db.prepare("SELECT count(*) as n FROM evidence_records WHERE chain_status!='RECORDED'").get().n});
      if(route==='/api/assets'&&req.method==='GET')return json(res,200,{assets:service.listAssets()});
      if(route==='/api/loans'&&req.method==='GET')return json(res,200,{loans:service.listLoans(user)});
      if(route==='/api/loans'&&req.method==='POST')return json(res,201,{loan:service.createLoan(user,await body(req))});
      let m;
      if((m=route.match(/^\/api\/loans\/([^/]+)$/))&&req.method==='GET')return json(res,200,service.detail(m[1],user));
      if((m=route.match(/^\/api\/loans\/([^/]+)\/actions\/([a-z-]+)$/))&&req.method==='POST'){const detail=service.action(m[1],user,m[2],await body(req));await service.flushEvidence();return json(res,200,service.detail(detail.loan.id,user));}
      if((m=route.match(/^\/api\/loans\/([^/]+)\/attachments$/))&&req.method==='POST')return json(res,201,service.addAttachment(m[1],user,await body(req)));
      if((m=route.match(/^\/api\/evidence\/([^/]+)\/verify$/))&&req.method==='POST'){const b=await body(req);return json(res,200,await service.verify(m[1],user,b.candidate??null));}
      if((m=route.match(/^\/api\/evidence\/([^/]+)\/download$/))&&req.method==='GET'){const p=service.proof(m[1],user);res.setHeader('Content-Disposition',`attachment; filename="${p.id}.json"`);return json(res,200,JSON.parse(p.payload_json));}
      if(route==='/api/evidence/retry'&&req.method==='POST'){service.checkRole(user,'staff');await service.flushEvidence();return json(res,200,{ok:true});}
      if((m=route.match(/^\/api\/attachments\/([^/]+)$/))&&req.method==='GET'){const file=db.prepare('SELECT * FROM attachments WHERE id=?').get(m[1]);if(!file)throw new AppError('Foto tidak ditemukan.',404);service.loan(file.loan_id,user);const data=fs.readFileSync(path.join(dataDir,file.relative_path));res.writeHead(200,{'Content-Type':file.mime,'Cache-Control':'no-store'});return res.end(data);}
      if((m=route.match(/^\/api\/assets\/([^/]+)\/release$/))&&req.method==='POST'){service.checkRole(user,'staff');const asset=service.asset(m[1]);if(asset.status!=='INSPECTION')throw new AppError('Alat tidak sedang perlu pemeriksaan.',409);const active=db.prepare("SELECT id FROM loans WHERE asset_id=? AND status IN ('APPROVED','HANDOVER_PENDING','BORROWED','RETURN_REQUESTED','RETURN_PENDING')").get(asset.id);if(active)throw new AppError('Selesaikan pengembalian terlebih dahulu.',409);db.prepare("UPDATE assets SET status='AVAILABLE',condition='Baik' WHERE id=?").run(asset.id);return json(res,200,{asset:service.asset(asset.id)});}
      throw new AppError('Endpoint tidak ditemukan.',404);
    }
    if(req.method!=='GET')throw new AppError('Metode tidak diizinkan.',405);
    const files={'/':'index.html','/app.js':'app.js','/style.css':'style.css'};const f=files[route];if(!f)throw new AppError('Halaman tidak ditemukan.',404);
    res.writeHead(200,{'Content-Type':f.endsWith('.js')?'text/javascript; charset=utf-8':f.endsWith('.css')?'text/css; charset=utf-8':'text/html; charset=utf-8','Cache-Control':'no-cache'});res.end(fs.readFileSync(path.join(root,'public',f)));
  }catch(e){if(res.headersSent){res.end();return;}json(res,e.status||500,{error:e instanceof AppError?e.message:'Terjadi kesalahan server. Coba lagi.'});if(!(e instanceof AppError))console.error(e);}
});
await service.flushEvidence();
server.listen(port,'127.0.0.1',()=>console.log(`LabPass siap: http://127.0.0.1:${port}\nDatabase SQLite aktif. Blockchain: ${chain?'Ethereum lokal, chain ID 1337':'belum tersedia (bukan simulasi sukses)'}.\nAkun dummy tersedia pada halaman masuk.`));
async function close(){server.close();if(chain)await chain.close();db.close();process.exit(0);}
process.on('SIGINT',close);process.on('SIGTERM',close);
