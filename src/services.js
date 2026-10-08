'use strict';
const crypto = require('node:crypto');
const { AppError, requireRole } = require('./errors');
const { digest, randomToken, equal, hashPassword, verifyPassword, safeUser, validateUser } = require('./security');
const { validateChange } = require('./inventory-service');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const { RequestService, publicRequest } = require('./request-service');
class Services {
 constructor(store) { this.store=store; this.dummyHash=null; this.requests=new RequestService(store); this.documents=new (require('./document-service').DocumentService)(store,this); this.reports=new (require('./report-service').ReportService)(store,this); this.dispatches=new (require('./dispatch-service').DispatchService)(store,this); }
 async init() { this.dummyHash=await hashPassword(randomToken()); }
 async login(username,password,oldHash) {
  const user=await this.store.transact(tx=>tx.findUser(String(username||'').trim().toLowerCase()));
  const valid=await verifyPassword(password,user?.passwordHash||this.dummyHash);
  if(!valid||!user?.active) { await this.store.transact(tx=>tx.audit({action:'LOGIN_FAILED',details:{}})); throw new AppError(401,'INVALID_LOGIN'); }
  const token=randomToken(); const session={hash:digest(token),userId:user.id,csrfToken:randomToken(),expiresAt:Date.now()+12*60*60*1000};
  await this.store.transact(async tx=>{
   const current=await tx.findUser(user.username);
   if(!current?.active || current.passwordHash!==user.passwordHash)throw new AppError(401,'INVALID_LOGIN');
   if(oldHash)await tx.revokeSessions(null,oldHash);
   await tx.putSession(session);await tx.audit({actorId:user.id,action:'LOGIN'});
  });
  return {token,user:safeUser(user),csrfToken:session.csrfToken};
 }
 async session(hash,tx) {
  if(!hash)return null;
  const run=async t=>{const s=await t.getSession(hash);if(!s||s.expiresAt<=Date.now())return null; const user=(await t.listUsers()).find(u=>u.id===s.userId);return user?.active?{...s,user:safeUser(user)}:null;};
  return tx?run(tx):this.store.transact(run);
 }
 async authenticated(hash,tx,role) {const session=await this.session(hash,tx);if(!session)throw new AppError(401,'UNAUTHORIZED');if(role)requireRole(session.user,role);return session;}
 async inventoryWrite(hash,payload,revision,operationId) {
  if(!revision || !/^\d+$/.test(String(revision)))throw new AppError(428,'REVISION_REQUIRED');
  if(!UUID.test(operationId||''))throw new AppError(422,'OPERATION_ID_REQUIRED');
  const payloadHash=digest(JSON.stringify(payload));
  return this.store.transact(async tx=>{
   const current=await tx.getInventory(true);
   const session=await this.authenticated(hash,tx,'ADMINISTRADOR');
   const replay=await tx.getWrite(operationId);
   if(replay) { if(replay.actorId!==session.user.id||replay.payloadHash!==payloadHash)throw new AppError(409,'IDEMPOTENCY_CONFLICT'); return {ok:true,revision:replay.version,replayed:true}; }
   if(current.version!==String(revision))throw new AppError(409,'STATE_CONFLICT');
   const validated=validateChange(current.state,payload,await tx.linkedOutputs(),await tx.referencedRequestProducts());
   const version=(BigInt(current.version)+1n).toString();
   await tx.saveInventory(validated.state,version);
   await tx.putWrite({id:operationId,actorId:session.user.id,payloadHash,version});
   await tx.audit({actorId:session.user.id,action:'INVENTORY_WRITE',entityId:'1',details:{fromVersion:current.version,toVersion:version,changes:validated.changes}});
   return {ok:true,revision:version};
  });
 }
 async createUser(data,hash,bootstrap=false) {
  const input={username:String(data.username||'').toLowerCase(),role:data.role};validateUser(input);
  const passwordHash=await hashPassword(data.password);
  return this.store.transact(async tx=>{
   if(tx.client)await tx.client.query('SELECT pg_advisory_xact_lock(74182027)');
   const users=await tx.listUsers(true);
   let actorId;
   if(bootstrap) {if(users.some(u=>u.role==='ADMINISTRADOR'))throw new AppError(409,'ADMIN_ALREADY_EXISTS');if(input.role!=='ADMINISTRADOR')throw new AppError(422,'ADMIN_REQUIRED');}
   else actorId=(await this.authenticated(hash,tx,'ADMINISTRADOR')).user.id;
   if(users.some(u=>u.username===input.username))throw new AppError(409,'USERNAME_EXISTS');
   const user={id:crypto.randomUUID(),...input,passwordHash,active:true,createdAt:new Date().toISOString()};
   await tx.putUser(user);await tx.audit({actorId:actorId||user.id,action:bootstrap?'ADMIN_BOOTSTRAP':'USER_CREATE',entityId:user.id,details:{user:safeUser(user)}});return safeUser(user);
  });
 }
 async updateUser(hash,id,data) {
  if(!UUID.test(id))throw new AppError(404,'USER_NOT_FOUND');
  if(Object.keys(data).some(k=>!['role','active','password'].includes(k)))throw new AppError(422,'INVALID_USER_FIELDS');
  const passwordHash=data.password===undefined?null:await hashPassword(data.password);
  return this.store.transact(async tx=>{
   if(tx.client)await tx.client.query('SELECT pg_advisory_xact_lock(74182027)');
   const users=await tx.listUsers(true);const actor=(await this.authenticated(hash,tx,'ADMINISTRADOR')).user;
   const before=users.find(u=>u.id===id);if(!before)throw new AppError(404,'USER_NOT_FOUND');
   const after={...before,role:data.role??before.role,active:data.active??before.active};validateUser(after);
   if(typeof after.active!=='boolean')throw new AppError(422,'INVALID_ACTIVE');
   if(before.role==='ADMINISTRADOR'&&before.active&&(!after.active||after.role!=='ADMINISTRADOR')&&!users.some(u=>u.id!==id&&u.active&&u.role==='ADMINISTRADOR'))throw new AppError(409,'LAST_ADMINISTRATOR');
   if(passwordHash)after.passwordHash=passwordHash;
   await tx.putUser(after);await tx.revokeSessions(id);await tx.audit({actorId:actor.id,action:'USER_UPDATE',entityId:id,details:{before:safeUser(before),after:safeUser(after),passwordChanged:Boolean(passwordHash)}});return safeUser(after);
  });
 }
 async registerRequest(input) { return this.requests.register(input); }
 async lookupRequest(code,key) { return this.requests.lookup(code,key); }

}
module.exports = { Services, publicRequest };
