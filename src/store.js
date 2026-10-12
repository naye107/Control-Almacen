'use strict';
const fs = require('node:fs/promises');
const path = require('node:path');
const crypto = require('node:crypto');
const { AppError } = require('./errors');
const { createPool } = require('./database');
const {limits,databaseError}=require('./operational-limits');
const {expectedVersion,finiteTree,verifyDocument}=require('./integrity');
const emptyState = () => ({products:[],purchases:[],outputs:[]});
class FileStore {
 constructor(dir) { this.dir=path.resolve(dir); this.file=path.join(this.dir,'phase1.json'); this.lock=path.join(this.dir,'.phase1.lock'); this.queue=Promise.resolve(); }
 async init() {
  await fs.mkdir(this.dir,{recursive:true});
  // Lifetime lock prevents two processes from writing the local development store.
  try { this.handle=await fs.open(this.lock,'wx'); await this.handle.writeFile(String(process.pid)); }
  catch(error) { if(error.code==='EEXIST') throw new Error('LOCAL_STORE_LOCKED: cierre el otro proceso; revise docs/FASE1.md'); throw error; }
  try {
   try { JSON.parse(await fs.readFile(this.file,'utf8')); }
   catch(error) {
    if(error.code!=='ENOENT') throw new Error('LOCAL_STORE_CORRUPT: no se reemplazaron datos');
    let state=emptyState();
    try { state=JSON.parse(await fs.readFile(path.join(this.dir,'inventory.json'),'utf8')); } catch(e) { if(e.code!=='ENOENT') throw new Error('LEGACY_INVENTORY_CORRUPT'); }
    if(!['products','purchases','outputs'].every(k=>Array.isArray(state[k]))) throw new Error('INVALID_LEGACY_INVENTORY');
    await this.write({schema:1,inventory:{state,version:'1'},users:[],sessions:[],requests:[],audit:[],writes:[],links:[]});
   }
  } catch(error) { await this.close(); throw error; }
 }
 async write(doc) {
  const temp=`${this.file}.${crypto.randomUUID()}.tmp`;
  const handle=await fs.open(temp,'wx');
  try { await handle.writeFile(JSON.stringify(doc,null,2)+'\n'); await handle.sync(); } finally { await handle.close(); }
  try { await fs.rename(temp,this.file); } catch(e) { await fs.unlink(temp).catch(()=>{}); throw e; }
 }
 async transact(work) {
  const run=this.queue.then(async()=>{
   const doc=JSON.parse(await fs.readFile(this.file,'utf8'));
   const tx=new FileTransaction(doc);
   const result=await work(tx);
   if(tx.dirty) await this.write(doc);
   return result;
  });
  this.queue=run.catch(()=>{}); return run;
 }
 async health(){await fs.access(this.file);return {storage:'local'};}
 async close() { await this.queue; if(this.handle) { await this.handle.close(); this.handle=null; await fs.unlink(this.lock); } }
}
class FileTransaction {
 constructor(doc) { this.doc=doc; this.dirty=false; }
 async getInventory() { return structuredClone(this.doc.inventory); }
 async saveInventory(state,expected) { const version=expectedVersion(expected);finiteTree(state);if(this.doc.inventory.version!==version)throw new AppError(409,'STATE_CONFLICT');const next=(BigInt(version)+1n).toString();this.doc.inventory={state:structuredClone(state),version:next};this.dirty=true;return next; }
 async referencedRequestProducts() { return [...new Set(this.doc.requests.flatMap(r=>r.items.map(i=>i.productId)))]; }
 async linkedOutputs() { return this.doc.links.map(x=>x.outputId); }
 async findUser(username) { return this.doc.users.find(u=>u.username===username); }
 async listUsers() { return structuredClone(this.doc.users); }
 async putUser(user) { const idx=this.doc.users.findIndex(u=>u.id===user.id); if(this.doc.users.some(u=>u.username===user.username && u.id!==user.id)) throw new AppError(409,'USERNAME_EXISTS'); if(idx<0)this.doc.users.push(user);else this.doc.users[idx]=user;this.dirty=true; }
 async getSession(hash) { return this.doc.sessions.find(s=>s.hash===hash); }
 async putSession(s) { this.doc.sessions=this.doc.sessions.filter(x=>x.hash!==s.hash);this.doc.sessions.push(s);this.dirty=true; }
 async revokeSessions(userId,hash) { this.doc.sessions=this.doc.sessions.filter(s=>userId?s.userId!==userId:s.hash!==hash);this.dirty=true; }
 async getWrite(id) { return this.doc.writes.find(w=>w.id===id); }
 async putWrite(w) { this.doc.writes.push(w);this.dirty=true; }
 async audit(event) { this.doc.audit.push({...event,id:crypto.randomUUID(),createdAt:new Date().toISOString()});this.dirty=true; }


 async getDocument(kind,id,version){const d=(this.doc.documents||[]).find(x=>x.kind===kind&&x.sourceId===id&&x.templateVersion===version);return d?{...d,pdf:Buffer.from(d.pdf,'base64')}:null;}
 async putDocument(d){verifyDocument(d);const old=await this.getDocument(d.kind,d.sourceId,d.templateVersion);if(old)return verifyDocument(old);this.doc.documents||=[];this.doc.documents.push({...d,pdf:d.pdf.toString('base64')});this.dirty=true;return d;}
 async lockDispatchPrincipal() {}
 async lockLoginUser() {}
 async getRequest(id) { return this.doc.requests.find(r=>r.id===id)||null; }
 async delivered(id) { const rows=this.doc.dispatches||[];const map=new Map();for(const d of rows.filter(d=>d.requestId===id&&d.status==='CONFIRMADO'))for(const i of d.items)map.set(i.requestItemId,require('../shared/dispatch-rules').add(map.get(i.requestItemId)||require('../shared/dispatch-rules').zero,require('../shared/dispatch-rules').read(i.quantity)));return map; }
 async findDispatch(operationId) { return (this.doc.dispatches||[]).find(d=>d.operationId===operationId)||null; }
 async requestDispatches(id) { return (this.doc.dispatches||[]).filter(d=>d.requestId===id&&d.status==='CONFIRMADO').map(d=>d.result); }
 async dispatchById(id) { return (this.doc.dispatches||[]).find(d=>d.id===id)||null; }
 async putDispatch(d) { this.doc.dispatches||=[];this.doc.dispatches.push(d);for(const i of d.items)this.doc.links.push({dispatchItemId:i.id,outputId:i.outputId});this.dirty=true; }
 async updateRequestDispatch(id,status,revision) { const r=await this.getRequest(id);r.status=status;r.dispatchRevision=revision;this.dirty=true; }
 async requestPage(filters) { const {filterRequests}=require('./dispatch-query');const rows=filterRequests(this.doc.requests,filters);return {total:rows.length,requests:structuredClone(rows.slice((filters.page-1)*filters.pageSize,filters.page*filters.pageSize))}; }
 async listAudit(limit=100) { return structuredClone(this.doc.audit.slice(-limit).reverse()); }
 async putRequest(request) { this.doc.requests.push(request);this.dirty=true; }
 async findRequest(code) { return this.doc.requests.find(r=>r.code===code); }
 async listRequests() { return structuredClone(this.doc.requests.slice(-100).reverse()); }
}
function userFrom(row) { return row && {id:row.id,username:row.username,passwordHash:row.password_hash,role:row.role,active:row.active,createdAt:new Date(row.created_at).toISOString()}; }

function requestFrom(row,itemRows){
  const precise=value=>value===null||value===undefined?null:require('../shared/request-rules').normalize(String(value));
  const items=itemRows.map(i=>({id:i.id,productId:i.product_id,productSnapshot:i.product_snapshot,presentation:i.presentation,quantity:row.request_version===2?precise(i.quantity):Number(i.quantity),unit:i.unit,...(row.request_version===2?{lineNumber:i.line_number,doseQuantity:precise(i.dose_quantity),baseQuantity:precise(i.base_quantity),baseUnit:i.base_unit,dimension:i.dimension}:{})}));
  return {dispatchRevision:String(row.dispatch_revision),id:row.id,code:row.code,privateKeyHash:row.private_key_hash,requester:row.requester,destination:row.destination,notes:row.notes,status:row.status,createdAt:new Date(row.created_at).toISOString(),items,...(row.request_version===2?{requestVersion:2,category:row.category,crop:row.crop,applicationMode:row.application_mode,containerCount:precise(row.container_count),operationId:row.operation_id,payloadHash:row.payload_hash}:{})};
}
class PostgresStore {
 constructor(url) { this.pool=createPool(url); }
 async init() {
  // Read-only preflight. Schema changes are performed only by the explicit migration command.
  await this.pool.query({text:'SELECT version FROM inventory_state WHERE id=1',query_timeout:5000});
  const result=await this.pool.query({query_timeout:5000,text:"SELECT version FROM schema_migrations WHERE version IN ('001_phase1.sql','002_public_requests.sql','003_dispatches.sql','004_document_records.sql','005_production_hardening.sql','006_integrity_hardening.sql','007_user_roles.sql')"});
  if(result.rowCount!==7) throw new Error('MIGRATIONS_REQUIRED');
 }
 async health(){const r=await this.pool.query({text:'SELECT version FROM inventory_state WHERE id=1',query_timeout:3000});if(r.rowCount!==1)throw new Error('INVENTORY_MISSING');return {storage:'postgresql'};}
 async transact(work,options={}) {
  let client;try{client=await this.pool.connect();}catch(e){throw e.status?e:new AppError(503,'DATABASE_UNAVAILABLE');}
  let discard=false;
  try { await client.query(options.readOnly?'BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY':'BEGIN'); await client.query("SELECT set_config('lock_timeout',$1,true),set_config('idle_in_transaction_session_timeout',$2,true),set_config('statement_timeout',$3,true)",[String(limits().lockMs),String(limits().idleMs),String(limits().statementMs)]); const result=await work(new PostgresTransaction(client)); await client.query('COMMIT'); return result; }
  catch(error) { try{await client.query('ROLLBACK');}catch{discard=true;} throw databaseError(error); }
  finally { client.release(discard); }
 }
 async close() { await this.pool.end(); }
}
class PostgresTransaction {
 constructor(client) { this.client=client; }
 async getInventory(lock=false) {
  const result=await this.client.query(lock?'SELECT data,version FROM public.lock_inventory_for_write()':'SELECT data,version FROM inventory_state WHERE id=1');
  if(!result.rowCount) throw new Error('INVENTORY_MISSING');
  return {state:result.rows[0].data,version:String(result.rows[0].version)};
 }
 async saveInventory(state,expected) {const version=expectedVersion(expected);finiteTree(state);const data=JSON.stringify(state);if(Buffer.byteLength(data)>limits().inventoryBytes)throw new AppError(413,'INVENTORY_TOO_LARGE');const result=await this.client.query('SELECT version::text FROM public.write_inventory_cas($1::jsonb,$2::bigint)',[data,version]);if(result.rowCount!==1||result.rows[0]?.version!==(BigInt(version)+1n).toString())throw new AppError(409,'STATE_CONFLICT');return result.rows[0].version; }
 async referencedRequestProducts() { return (await this.client.query('SELECT DISTINCT product_id FROM request_items')).rows.map(r=>r.product_id); }
 async linkedOutputs() { return (await this.client.query('SELECT output_id FROM dispatch_inventory_links')).rows.map(r=>r.output_id); }
 async findUser(username) { return userFrom((await this.client.query('SELECT * FROM users WHERE username=$1',[username])).rows[0]); }
 async listUsers(lock=false) { return (await this.client.query('SELECT * FROM users ORDER BY username'+(lock?' FOR UPDATE':''))).rows.map(userFrom); }
 async putUser(u) {
  try { await this.client.query('INSERT INTO users(id,username,password_hash,role,active,created_at) VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(id) DO UPDATE SET username=EXCLUDED.username,password_hash=EXCLUDED.password_hash,role=EXCLUDED.role,active=EXCLUDED.active,updated_at=now()',[u.id,u.username,u.passwordHash,u.role,u.active,u.createdAt]); }
  catch(error) { if(error.code==='23505')throw new AppError(409,'USERNAME_EXISTS');throw error; }
 }
 async getSession(hash) { const row=(await this.client.query('SELECT * FROM sessions WHERE token_hash=$1 AND revoked_at IS NULL',[hash])).rows[0]; return row&&{hash:row.token_hash,userId:row.user_id,csrfToken:row.csrf_token,expiresAt:new Date(row.expires_at).getTime()}; }
 async putSession(s) { await this.client.query('INSERT INTO sessions(token_hash,user_id,csrf_token,expires_at) VALUES($1,$2,$3,$4)',[s.hash,s.userId,s.csrfToken,new Date(s.expiresAt)]); }
 async revokeSessions(userId,hash) { await this.client.query('UPDATE sessions SET revoked_at=now() WHERE '+(userId?'user_id=$1':'token_hash=$1'),[userId||hash]); }
 async getWrite(id) { const row=(await this.client.query('SELECT * FROM inventory_writes WHERE operation_id=$1',[id])).rows[0]; return row&&{id:row.operation_id,actorId:row.actor_id,payloadHash:row.payload_hash,version:String(row.result_version)}; }
 async putWrite(w) { await this.client.query('INSERT INTO inventory_writes(operation_id,actor_id,payload_hash,result_version) VALUES($1,$2,$3,$4)',[w.id,w.actorId,w.payloadHash,w.version]); }
 async audit(e) { await this.client.query('INSERT INTO audit_events(id,actor_id,action,entity_id,details) VALUES($1,$2,$3,$4,$5::jsonb)',[crypto.randomUUID(),e.actorId||null,e.action,e.entityId||null,JSON.stringify(e.details||{})]); }


 async getDocument(kind,id,version){const row=(await this.client.query('SELECT * FROM document_records WHERE kind=$1 AND source_id=$2 AND template_version=$3',[kind,id,version])).rows[0];return row&&{id:row.id,kind:row.kind,sourceId:row.source_id,templateVersion:row.template_version,snapshot:row.snapshot,pdf:row.pdf,sha256:row.sha256,filename:row.filename,generatedAt:new Date(row.generated_at).toISOString(),generatedBy:row.generated_by};}
 async putDocument(d){verifyDocument(d);await this.client.query('INSERT INTO document_records(id,kind,request_id,dispatch_id,source_id,template_version,snapshot,pdf,sha256,filename,generated_at,generated_by) VALUES($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12) ON CONFLICT(kind,source_id,template_version) DO NOTHING',[d.id,d.kind,d.kind==='REQUEST'?d.sourceId:null,d.kind==='DISPATCH'?d.sourceId:null,d.sourceId,d.templateVersion,JSON.stringify(d.snapshot),d.pdf,d.sha256,d.filename,d.generatedAt,d.generatedBy]);return verifyDocument(await this.getDocument(d.kind,d.sourceId,d.templateVersion));}
 async lockLoginUser(id){await this.client.query('SELECT id FROM users WHERE id=$1 FOR SHARE',[id]);}
 async lockDispatchPrincipal(hash) { await this.client.query('SELECT u.id FROM users u JOIN sessions s ON s.user_id=u.id WHERE s.token_hash=$1 FOR SHARE OF u,s',[hash]); }
 async getRequest(id,lock=false) { const row=(await this.client.query('SELECT code FROM requests WHERE id=$1'+(lock?' FOR UPDATE':''),[id])).rows[0];return row?this.findRequest(row.code):null; }
 async delivered(id) { const Q=require('../shared/dispatch-rules');const rows=(await this.client.query("SELECT i.request_item_id,sum(i.quantity)::text AS total FROM dispatch_items i JOIN dispatches d ON d.id=i.dispatch_id WHERE d.request_id=$1 AND d.status='CONFIRMADO' GROUP BY i.request_item_id",[id])).rows;return new Map(rows.map(r=>[r.request_item_id,Q.read(r.total)])); }
 async findDispatch(operationId) { const row=(await this.client.query('SELECT * FROM dispatches WHERE idempotency_key=$1',[operationId])).rows[0];return row?{id:row.id,userId:row.user_id,payloadHash:row.payload_hash,result:row.result_snapshot}:null; }
 async requestDispatches(id) { return (await this.client.query("SELECT result_snapshot FROM dispatches WHERE request_id=$1 AND status='CONFIRMADO' ORDER BY confirmed_at,id",[id])).rows.map(r=>r.result_snapshot); }
 async dispatchById(id) { const row=(await this.client.query("SELECT result_snapshot FROM dispatches WHERE id=$1 AND status='CONFIRMADO'",[id])).rows[0];return row&&{result:row.result_snapshot}; }
 async putDispatch(d) {
  await this.client.query("INSERT INTO dispatches(id,request_id,user_id,idempotency_key,payload_hash,status,created_at,confirmed_at,code,recipient,notes,actor_snapshot,request_snapshot,result_snapshot,inventory_version) VALUES($1,$2,$3,$4,$5,'BORRADOR',$6,$6,$7,$8,$9,$10::jsonb,$11::jsonb,$12::jsonb,$13)",[d.id,d.requestId,d.userId,d.operationId,d.payloadHash,d.createdAt,d.code,d.recipient,d.notes,JSON.stringify(d.actorSnapshot),JSON.stringify(d.requestSnapshot),JSON.stringify(d.result),d.result.inventoryRevision]);
  for(const i of d.items){await this.client.query('INSERT INTO dispatch_items(id,dispatch_id,request_item_id,quantity,unit,allocations,product_snapshot,base_quantity,base_unit) VALUES($1,$2,$3,$4,$5,$6::jsonb,$7::jsonb,$8,$9)',[i.id,d.id,i.requestItemId,i.quantity,i.unit,JSON.stringify(i.allocations),JSON.stringify(i.productSnapshot),i.baseQuantity,i.baseUnit]);for(const [index,fact] of i.allocationFacts.entries())await this.client.query('INSERT INTO public.dispatch_allocation_facts(dispatch_item_id,ordinal,numerator,denominator,capacity) VALUES($1,$2,$3,$4,$5)',[i.id,index+1,fact.numerator,fact.denominator,fact.capacity]);await this.client.query('INSERT INTO dispatch_inventory_links(dispatch_item_id,output_id) VALUES($1,$2)',[i.id,i.outputId]);}
  await this.client.query("UPDATE dispatches SET status='CONFIRMADO' WHERE id=$1",[d.id]);
 }
 async updateRequestDispatch(id,status,revision) { await this.client.query('UPDATE requests SET status=$2,dispatch_revision=$3,updated_at=now() WHERE id=$1',[id,status,revision]); }
 async requestPage(filters) { const {sqlFilters}=require('./dispatch-query');const query=sqlFilters(filters);const total=(await this.client.query('SELECT count(*)::int AS total FROM requests r WHERE '+query.where,query.args)).rows[0].total;const sql='SELECT r.code FROM requests r WHERE '+query.where+' ORDER BY r.created_at '+(filters.order==='oldest'?'ASC':'DESC')+',r.id '+(filters.order==='oldest'?'ASC':'DESC')+' LIMIT $'+(query.args.length+1)+' OFFSET $'+(query.args.length+2);const rows=(await this.client.query(sql,[...query.args,filters.pageSize,(filters.page-1)*filters.pageSize])).rows;const requests=[];for(const r of rows)requests.push(await this.findRequest(r.code));return {total,requests}; }
 async listAudit(limit=100) { return (await this.client.query('SELECT id,actor_id,action,entity_id,details,created_at FROM audit_events ORDER BY created_at DESC LIMIT $1',[limit])).rows; }
 async putRequest(r) {
  await this.client.query('INSERT INTO requests(id,code,private_key_hash,requester,destination,notes,status,created_at,request_version,category,crop,application_mode,container_count,operation_id,payload_hash) VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15)',[r.id,r.code,r.privateKeyHash,r.requester,r.destination,r.notes,r.status,r.createdAt,r.requestVersion??null,r.category??null,r.crop??null,r.applicationMode??null,r.containerCount??null,r.operationId??null,r.payloadHash??null]);
  for(const i of r.items)await this.client.query('INSERT INTO request_items(id,request_id,product_id,product_snapshot,presentation,quantity,unit,line_number,dose_quantity,base_quantity,base_unit,dimension) VALUES($1,$2,$3,$4::jsonb,$5,$6,$7,$8,$9,$10,$11,$12)',[i.id,r.id,i.productId,JSON.stringify(i.productSnapshot),i.presentation,i.quantity,i.unit,i.lineNumber??null,i.doseQuantity??null,i.baseQuantity??null,i.baseUnit??null,i.dimension??null]);
 }
 async findRequest(code,lock=false) {
  const row=(await this.client.query('SELECT * FROM requests WHERE code=$1'+(lock==='share'?' FOR SHARE':lock?' FOR UPDATE':''),[code])).rows[0];if(!row)return null;
  const items=(await this.client.query('SELECT * FROM request_items WHERE request_id=$1 ORDER BY line_number NULLS LAST,id',[row.id])).rows;return requestFrom(row,items);
 }
 async listRequests() { const rows=(await this.client.query('SELECT code FROM requests ORDER BY created_at DESC LIMIT 100')).rows; const list=[];for(const r of rows)list.push(await this.findRequest(r.code));return list; }
}
module.exports = { FileStore, PostgresStore, emptyState, requestFrom };
