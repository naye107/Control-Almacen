'use strict';
const crypto=require('node:crypto');const {AppError}=require('./errors');const {digest,equal}=require('./security');
const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
const TEMPLATE='corporate-a4-total-v2';
const requestTemplate=r=>BigInt(r.editRevision||1)>1n?TEMPLATE+'-r'+r.editRevision:TEMPLATE;
const {verifyDocument}=require('./integrity');
function requestSnapshot(r){return {kind:'REQUEST',code:r.code,createdAt:r.createdAt,requester:r.requester,destination:r.destination,notes:r.notes||'',category:r.category||null,crop:r.crop||null,applicationMode:r.applicationMode||null,containerCount:r.containerCount||null,items:r.items.map(i=>({product:i.productSnapshot.name,presentation:i.presentation,quantity:String(i.quantity),unit:i.unit,doseQuantity:i.doseQuantity||null}))};}
function dispatchSnapshot(d){if(!d.result)throw new AppError(409,'HISTORICAL_DOCUMENT_UNAVAILABLE');const r=d.result;return {kind:'DISPATCH',code:r.code,requestCode:r.requestCode,createdAt:r.createdAt,actor:r.actor,recipient:r.recipient,notes:r.notes||'',requester:r.requestSnapshot.requester,destination:r.requestSnapshot.destination,crop:r.requestSnapshot.crop||null,category:r.requestSnapshot.category||null,items:r.items.map(i=>({...i}))};}
class DocumentService{
 constructor(store,services){this.store=store;this.services=services;this.generating=new Map();this.render=s=>require('./pdf/document-layout').render(s);}
 async load(tx,kind,id,auth){if(auth.public){if(kind!=='REQUEST')throw new AppError(403,'FORBIDDEN');const r=await tx.findRequest(auth.code,'share');if(!r)throw new AppError(404,'REQUEST_NOT_FOUND');return {id:r.id,snapshot:requestSnapshot(r),templateVersion:requestTemplate(r),actorId:null};}
 const session=await this.services.authenticated(auth.hash,tx);if(!['ADMINISTRADOR','ALMACENERO'].includes(session.user.role))throw new AppError(403,'FORBIDDEN');if(!UUID.test(id))throw new AppError(404,'NOT_FOUND');if(kind==='REQUEST'){const r=await tx.getRequest(id,true);if(!r)throw new AppError(404,'REQUEST_NOT_FOUND');return {id:r.id,snapshot:requestSnapshot(r),templateVersion:requestTemplate(r),actorId:session.user.id};}const d=await tx.dispatchById(id);if(!d)throw new AppError(404,'DISPATCH_NOT_FOUND');return {id,snapshot:dispatchSnapshot(d),actorId:session.user.id};}
 async document(kind,id,auth){return this.services.heavy.run(()=>this.documentChecked(kind,id,auth));}
 async documentChecked(kind,id,auth){const initial=await this.store.transact(async tx=>{const source=await this.load(tx,kind,id,auth);return {...source,existing:await tx.getDocument(kind,source.id,source.templateVersion||TEMPLATE)};});if(initial.existing)return verifyDocument(initial.existing);
 if(initial.snapshot.items.length>100||Buffer.byteLength(JSON.stringify(initial.snapshot))>256*1024)throw new AppError(413,'DOCUMENT_TOO_LARGE');
 const key=kind+':'+initial.id+':'+(initial.templateVersion||TEMPLATE);let pending=this.generating.get(key);if(pending){const document=await pending;const latest=await this.store.transact(tx=>this.load(tx,kind,initial.id,auth));if((latest.templateVersion||TEMPLATE)!==(initial.templateVersion||TEMPLATE))throw new AppError(409,'REQUEST_CONFLICT');return verifyDocument(document);}
 pending=this.generate(kind,initial,auth);this.generating.set(key,pending);try{return await pending;}finally{this.generating.delete(key);}}
 async generate(kind,initial,auth){
 const pdf=await this.render(initial.snapshot);if(pdf.length>5242880)throw new AppError(413,'DOCUMENT_TOO_LARGE');const doc={id:crypto.randomUUID(),kind,sourceId:initial.id,templateVersion:initial.templateVersion||TEMPLATE,snapshot:initial.snapshot,pdf,sha256:crypto.createHash('sha256').update(pdf).digest('hex'),filename:(kind==='REQUEST'?'pedido-':'despacho-')+initial.snapshot.code.replace(/[^A-Za-z0-9_-]/g,'')+'.pdf',generatedAt:new Date().toISOString(),generatedBy:initial.actorId};
 return this.store.transact(async tx=>{const latest=await this.load(tx,kind,initial.id,auth);if((latest.templateVersion||TEMPLATE)!==(initial.templateVersion||TEMPLATE))throw new AppError(409,'REQUEST_CONFLICT');const saved=verifyDocument(await tx.putDocument(verifyDocument(doc)));if(saved.id===doc.id)await tx.audit({actorId:doc.generatedBy,action:'DOCUMENT_CREATE',entityId:doc.id,details:{kind,sourceId:doc.sourceId,templateVersion:doc.templateVersion,sha256:doc.sha256}});return saved;});}
 async publicRequest(input){if(!input||Object.keys(input).some(k=>!['code','privateKey'].includes(k))||typeof input.code!=='string'||input.code.length>40)throw new AppError(404,'REQUEST_NOT_FOUND');return this.document('REQUEST',null,{public:true,code:input.code.trim().toUpperCase(),key:input.privateKey});}
}
module.exports={DocumentService,requestSnapshot,dispatchSnapshot,TEMPLATE};

