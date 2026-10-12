'use strict';
const http = require('node:http');
const fs = require('node:fs/promises');
const path = require('node:path');
const { AppError, requireRole } = require('./src/errors');
const { FileStore, PostgresStore } = require('./src/store');
const { Services } = require('./src/services');
const { digest, equal, safeUser } = require('./src/security');
const {limits:operationalLimits,WorkGate,databaseError}=require('./src/operational-limits');
const ROOT = __dirname;
const COOKIE = 'japurima_session';
function cookieHash(req) { const value=(req.headers.cookie||'').split(';').map(x=>x.trim()).find(x=>x.startsWith(COOKIE+'=')); if(!value)return null;try{return digest(decodeURIComponent(value.slice(COOKIE.length+1)));}catch{return null;} }
function cookie(token,secure) {return `${COOKIE}=${encodeURIComponent(token)}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${token?43200:0}${secure?'; Secure':''}`;}
async function body(req,maxBytes=operationalLimits().bodyBytes) {
 if(!String(req.headers['content-type']||'').startsWith('application/json'))throw new AppError(415,'JSON_REQUIRED');
 if(Number(req.headers['content-length']||0)>maxBytes){req.resume();throw new AppError(413,'BODY_TOO_LARGE');}
 let bytes=0;const chunks=[];
 for await(const chunk of req.iterator({destroyOnReturn:false})){bytes+=chunk.length;if(bytes>maxBytes){req.resume();throw new AppError(413,'BODY_TOO_LARGE');}chunks.push(chunk);}
 let value;try {value=JSON.parse(Buffer.concat(chunks).toString('utf8'));}catch{throw new AppError(400,'INVALID_JSON');}
 if(!value || typeof value!=='object' || Array.isArray(value))throw new AppError(400,'JSON_OBJECT_REQUIRED');return value;
}
function createServer({store,services,production=false,publicOrigin='',trustProxy=false,maintenance=process.env.MAINTENANCE_MODE==='1',limits=operationalLimits()}) {
 const rates=new Map();const inventoryGate=new WorkGate({limit:2,queue:28,waitMs:5000,rssBytes:limits.rssBytes});const httpGate=new WorkGate({limit:32,queue:0,rssBytes:limits.rssBytes});
 let draining=false; const readiness={until:0,value:null,pending:null};
 async function ready(){if(draining)throw new AppError(503,'MAINTENANCE');if(readiness.pending)return readiness.pending;if(Date.now()<readiness.until)return readiness.value;readiness.pending=store.health().then(value=>{readiness.value=value;readiness.until=Date.now()+1000;return value;}).finally(()=>{readiness.pending=null;});return readiness.pending;}
 function rate(req,group,max=20,identity) {
  const ip=identity||(trustProxy?String(req.headers['x-forwarded-for']||req.socket.remoteAddress).split(',').pop().trim():req.socket.remoteAddress);
  const key=group+':'+ip;const now=Date.now();const current=rates.get(key);if(rates.size>=10000&&!current){for(const [k,v] of rates)if(v.until<=now)rates.delete(k);if(rates.size>=10000)throw new AppError(429,'RATE_LIMIT');}
  if(!current||current.until<=now){rates.set(key,{count:1,until:now+60000});}else if(++current.count>max)throw new AppError(429,'RATE_LIMIT');
  if(rates.size>10000)for(const [k,v] of rates)if(v.until<=now)rates.delete(k);
 }
 const server=http.createServer(async(req,res)=>{
  const sendFile=(bytes,name,type,headers={})=>{res.writeHead(200,{'Content-Type':type,'Content-Disposition':'attachment; filename="'+name+'"','Cache-Control':'private, no-store','Content-Length':bytes.length,...headers});res.end(bytes);};
  const json=(status,payload,headers={})=>{res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store',...headers});res.end(JSON.stringify(payload));};
  res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Referrer-Policy','no-referrer');
  res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'self'; form-action 'self'");
  if(production)res.setHeader('Strict-Transport-Security','max-age=31536000');
  let admitted=false;
  try {
   const url=new URL(req.url,'http://localhost');const route=url.pathname;const hash=cookieHash(req);
   if(!['GET','HEAD','POST','PATCH'].includes(req.method))throw new AppError(405,'METHOD_NOT_ALLOWED');
   if(['POST','PATCH'].includes(req.method)) {
    const origin=req.headers.origin;const expected=publicOrigin||`http://${req.headers.host}`;
    if(origin&&origin!==expected)throw new AppError(403,'ORIGIN_REJECTED');
    if(req.headers['sec-fetch-site']==='cross-site')throw new AppError(403,'ORIGIN_REJECTED');
   }
   if(route==='/api/health'&&req.method==='GET') {json(draining?503:200,{ok:!draining,http:!draining});return;}
   if(route==='/api/ready'&&req.method==='GET'){try{const status=await ready();json(200,{ok:true,http:true,storage:status.storage,maintenance});}catch{json(503,{ok:false,http:true,storage:'unavailable'});}return;}
   if((maintenance||draining)&&route.startsWith('/api/')&&(!['GET','HEAD'].includes(req.method)||route.endsWith('/pdf')))throw new AppError(503,'MAINTENANCE');
   await httpGate.acquire();admitted=true;
   if(route==='/api/login'&&req.method==='POST') {
    rate(req,'login-ip',60);const input=await body(req);rate(req,'login-account',10,digest(String(input.user||'').trim().toLowerCase()));const result=await services.login(input.user,input.password,hash);
    json(200,{ok:true,user:result.user,csrfToken:result.csrfToken},{'Set-Cookie':cookie(result.token,production)});return;
   }
   if(route==='/api/session'&&req.method==='GET') {const session=await services.session(hash);json(200,session?{authenticated:true,user:session.user.username,role:session.user.role,csrfToken:session.csrfToken}:{authenticated:false});return;}
   if(route==='/api/public/catalog'&&req.method==='GET') {
    rate(req,'catalog',120);json(200,await services.requests.catalog(url.searchParams.get('category')||undefined));return;
   }
   if(route==='/api/public/requests'&&req.method==='POST') {if((await services.session(hash))?.user.role==='SUPERVISOR')throw new AppError(403,'FORBIDDEN');rate(req,'request',60);json(201,await services.registerRequest(await body(req)));return;}
   if(route==='/api/public/requests/status'&&req.method==='POST') {rate(req,'lookup',20);const input=await body(req);if(!input||typeof input!=='object'||Array.isArray(input))throw new AppError(422,'INVALID_REQUEST_FIELDS');json(200,await services.lookupRequest(input.code,input.privateKey));return;}
   if(route==='/api/public/requests/pdf'&&req.method==='POST'){if((await services.session(hash))?.user.role==='SUPERVISOR')throw new AppError(403,'FORBIDDEN');rate(req,'public-document',20);const d=await services.documents.publicRequest(await body(req));sendFile(d.pdf,d.filename,'application/pdf',{'X-Document-SHA256':d.sha256});return;}
   if(route.startsWith('/api/')) {
    const session=await services.authenticated(hash);
    if(session.user.role==='SUPERVISOR'&&!((req.method==='GET'&&['/api/state','/api/state-meta'].includes(route))||(req.method==='POST'&&route==='/api/logout')))throw new AppError(403,'FORBIDDEN');
    if(['POST','PATCH'].includes(req.method)&&!equal(req.headers['x-csrf-token']||'',session.csrfToken))throw new AppError(403,'CSRF_REJECTED');
    if(route==='/api/logout'&&req.method==='POST') {await store.transact(async tx=>{await tx.revokeSessions(null,hash);await tx.audit({actorId:session.user.id,action:'LOGOUT'});});json(200,{ok:true},{'Set-Cookie':cookie('',production)});return;}
    if(route==='/api/state'&&req.method==='GET') {
     await inventoryGate.acquire();let inventory;try{inventory=await store.transact(tx=>tx.getInventory());}finally{inventoryGate.release();}
     const state=['ADMINISTRADOR','ALMACENERO'].includes(session.user.role)?inventory.state:{products:inventory.state.products,purchases:inventory.state.purchases.map(p=>({id:p.id,productId:p.productId,date:p.date,presentation:p.presentation,quantity:p.quantity})),outputs:inventory.state.outputs.map(o=>({id:o.id,productId:o.productId,date:o.date,presentation:o.presentation,quantity:o.quantity,allocations:o.allocations,usedQuantity:o.usedQuantity,usedUnit:o.usedUnit,quantityMode:o.quantityMode,reason:o.reason,destination:o.destination,dispatchId:o.dispatchId,dispatchCode:o.dispatchCode}))};
     json(200,state,{'X-State-Revision':inventory.version});return;
    }
    if(route==='/api/state-meta'&&req.method==='GET') {const i=await store.transact(tx=>tx.getInventory());json(200,{revision:i.version});return;}
    if(route==='/api/state'&&req.method==='POST') {require('./src/permissions').requireOperator(session.user);json(200,await inventoryGate.run(async()=>services.inventoryWrite(hash,await body(req,limits.inventoryBytes),req.headers['x-state-revision'],req.headers['x-operation-id'])));return;}
    if(route==='/api/users') {
     requireRole(session.user,'ADMINISTRADOR');
     if(req.method==='GET'){json(200,await store.transact(async tx=>(await tx.listUsers()).map(safeUser)));return;}
     if(req.method==='POST'){json(201,await services.createUser(await body(req),hash));return;}
    }
    if(route.startsWith('/api/users/')&&req.method==='PATCH'){requireRole(session.user,'ADMINISTRADOR');json(200,await services.updateUser(hash,route.slice('/api/users/'.length),await body(req)));return;}
    if(route==='/api/audit'&&req.method==='GET'){requireRole(session.user,'ADMINISTRADOR');json(200,await store.transact(tx=>tx.listAudit()));return;}
    if(/^\/api\/documents\/(requests|dispatches)\/[a-f0-9-]+\/pdf$/i.test(route)&&req.method==='GET'){rate(req,'internal-document',60);const parts=route.split('/');const d=await services.documents.document(parts[3]==='requests'?'REQUEST':'DISPATCH',parts[4],{hash});sendFile(d.pdf,d.filename,'application/pdf',{'X-Document-SHA256':d.sha256});return;}
    if(route==='/api/reports'&&req.method==='GET'){requireRole(session.user,'ADMINISTRADOR');rate(req,'reports',30);json(200,await services.reports.list(hash,Object.fromEntries(url.searchParams)));return;}
    if(route==='/api/reports/excel'&&req.method==='GET'){requireRole(session.user,'ADMINISTRADOR');rate(req,'report-export',10);const d=await services.reports.excel(hash,Object.fromEntries(url.searchParams));sendFile(d.buffer,d.filename,'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');return;}
    if(route==='/api/dispatch-requests'&&req.method==='GET'){json(200,await services.dispatches.list(hash,Object.fromEntries(url.searchParams)));return;}
    if(/^\/api\/dispatch-requests\/[a-f0-9-]+$/i.test(route)&&req.method==='GET'){json(200,await services.dispatches.detail(hash,route.split('/').pop()));return;}
    if(route==='/api/dispatches'&&req.method==='POST'){rate(req,'dispatch',60);json(201,await services.dispatches.confirmation(hash,await body(req)));return;}
    if(/^\/api\/dispatches\/[a-f0-9-]+$/i.test(route)&&req.method==='GET'){json(200,await services.dispatches.receipt(hash,route.split('/').pop()));return;}
    if(route==='/api/requests'&&req.method==='GET'){json(200,await store.transact(async tx=>(await tx.listRequests()).map(r=>({id:r.id,code:r.code,requester:r.requester,destination:r.destination,status:require('./src/request-service').publicRequest(r).status,createdAt:r.createdAt,category:r.category,requestVersion:r.requestVersion,crop:r.crop,applicationMode:r.applicationMode,containerCount:r.containerCount,items:r.items}))));return;}
    throw new AppError(404,'NOT_FOUND');
   }
   if(!['GET','HEAD'].includes(req.method))throw new AppError(405,'METHOD_NOT_ALLOWED');
   const requested=route==='/'?'public.html':decodeURIComponent(route).replace(/^\/+/, '');
   const allowed=['index.html','app.js','styles.css','users.js','public.html','public.js','shared/inventory-rules.js','shared/request-rules.js','public.css','dispatches.js','dispatches.css','shared/dispatch-rules.js','shared/xlsx-writer.js','shared/csv-writer.js','documents.js','reports.js','reports.css'];
   const file=path.resolve(ROOT,requested);const relative=path.relative(ROOT,file).split(path.sep).join('/');
   if(relative.startsWith('../')||path.isAbsolute(relative)||(!allowed.includes(relative)&&!/^assets\/[a-zA-Z0-9 ._-]+\.(png|jpg|jpeg|webp|svg|ico)$/.test(relative)))throw new AppError(403,'FORBIDDEN');
   const data=await fs.readFile(file).catch(e=>{if(e.code==='ENOENT')throw new AppError(404,'NOT_FOUND');throw e;});
   const mime={'.html':'text/html; charset=utf-8','.js':'application/javascript; charset=utf-8','.css':'text/css; charset=utf-8','.png':'image/png','.jpg':'image/jpeg','.svg':'image/svg+xml'};
   res.writeHead(200,{'Content-Type':mime[path.extname(file)]||'application/octet-stream','Cache-Control':'no-store'});res.end(req.method==='HEAD'?undefined:data);
  } catch(failure) {
   const error=databaseError(failure);
   if(!error.status)console.error('Error interno:',error.code||error.name);
   if(error.status===503||error.status===429)res.setHeader('Retry-After','3');
   if(!res.headersSent)json(error.status||500,{ok:false,error:error.status?error.code:'INTERNAL_ERROR'});else res.end();
  }finally{if(admitted)httpGate.release();}
 });
 server.beginDrain=()=>{draining=true;};server.workload={http:httpGate,inventory:inventoryGate};
 server.requestTimeout=30000;server.headersTimeout=15000;
 return server;
}
async function main() {
 const production=process.env.NODE_ENV==='production';
 if(production){const origin=new URL(process.env.PUBLIC_ORIGIN||'http://invalid');if(!process.env.DATABASE_URL||origin.protocol!=='https:'||origin.origin!==process.env.PUBLIC_ORIGIN)throw new Error('DATABASE_URL y PUBLIC_ORIGIN HTTPS exacto son obligatorios en produccion');}
 const store=process.env.DATABASE_URL?new PostgresStore(process.env.DATABASE_URL):new FileStore(process.env.DATA_DIR||path.join(ROOT,'data'));
 try { await store.init(); } catch(error) { await store.close().catch(()=>{}); throw error; }
 const services=new Services(store);try { await services.init(); } catch(error) { await store.close(); throw error; }
 const server=createServer({store,services,production,publicOrigin:process.env.PUBLIC_ORIGIN||'',trustProxy:process.env.TRUST_PROXY==='1'});
 server.on('error', async error => { console.error(error.code || 'SERVER_ERROR'); await store.close(); process.exitCode=1; });
 server.listen(Number(process.env.PORT||8080),process.env.HOST||'0.0.0.0',()=>console.log('JAPURIMA iniciado. Sin usuarios predeterminados. Consulte docs/FASE1.md.'));
 let stopping=false;
 const stop=()=>{if(stopping)return;stopping=true;server.beginDrain();const deadline=setTimeout(()=>{server.closeAllConnections();},20000);deadline.unref();server.close(async()=>{clearTimeout(deadline);await store.close();process.exit(0);});};
 process.on('SIGINT',stop);process.on('SIGTERM',stop);
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});
module.exports={createServer,body,cookieHash};
