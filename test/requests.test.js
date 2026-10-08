'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const crypto=require('node:crypto');const {setup}=require('./helpers');const rules=require('../shared/request-rules');const {digest}=require('../src/security');const {validateChange}=require('../src/inventory-service');
function products(){return [
 {id:'liquid',name:'Foliar A',category:'Foliar',requestCategory:'AGROQUIMICOS',presentation:'Bidón 20 L',unit:'bidones',active:true,openingStock:0,minStock:0},
 {id:'powder',name:'Fertilizante B',category:'Fertilizante',requestCategory:'AGROQUIMICOS',presentation:'Saco 25 kg',unit:'sacos',active:true,openingStock:0,minStock:0},
 {id:'tool',name:'Tijera',category:'Herramientas',requestCategory:'HERRAMIENTAS',presentation:'Unidad',unit:'unidades',active:true,openingStock:0,minStock:0},
 {id:'other',name:'Cinta',category:'Material',requestCategory:'OTROS',presentation:'Unidad',unit:'unidades',active:true,openingStock:0,minStock:0},
 {id:'unclassified',name:'Sin clasificación',category:'Foliar',presentation:'1 L',unit:'unidades',active:true,openingStock:10,minStock:0},
 {id:'expired',name:'Vencido',category:'Foliar',requestCategory:'AGROQUIMICOS',presentation:'1 L',unit:'unidades',active:true,expired:true,openingStock:10,minStock:0},
 {id:'inactive',name:'Inactivo',category:'Foliar',requestCategory:'AGROQUIMICOS',presentation:'1 L',unit:'unidades',active:false,openingStock:10,minStock:0}
 ];}
function input(overrides={}){return {requestVersion:2,operationId:crypto.randomUUID(),privateKey:crypto.randomBytes(32).toString('hex'),category:'AGROQUIMICOS',requester:'María Pérez',destination:'Fundo, sector 3',crop:'Arándano',applicationMode:'CILINDROS',containerCount:'3',items:[{productId:'liquid',doseQuantity:'0.125',unit:'L'},{productId:'powder',doseQuantity:'25.5',unit:'g'}],...overrides};}
async function prepare(t){const c=await setup(t);await c.store.transact(tx=>tx.saveInventory({products:products(),purchases:[],outputs:[]},'2'));return c;}
test('decimales exactos, conversión de dimensiones y límites',()=>{
 assert.equal(rules.multiply('0.1','3'),'0.3');assert.equal(rules.multiply('0,125','2.5'),'0.3125');assert.equal(rules.convert('0.125','L',products()[0]).baseQuantity,'125');assert.equal(rules.convert('0.125','kg',products()[1]).baseQuantity,'125');
 for(const value of ['-1','NaN','Infinity','0','1e3','0.1234567'])assert.throws(()=>rules.normalize(value));assert.throws(()=>rules.multiply('0.000001','0.5'),/QUANTITY_PRECISION/);assert.throws(()=>rules.convert('1','kg',products()[0]),/INCOMPATIBLE_UNIT/);assert.throws(()=>rules.convert('1','galones',products()[0]),/INCOMPATIBLE_UNIT/);
});
test('catálogo: categorías expresas, vigencia, stock cero y sin datos privados',async t=>{
 const c=await prepare(t);const all=await c.api('/api/public/catalog');assert.equal(all.status,200);assert.deepEqual(all.body.map(p=>p.id),['liquid','powder','tool','other']);
 for(const category of Object.keys(rules.CATEGORIES)){const result=await c.api('/api/public/catalog?category='+category);assert.ok(result.body.every(p=>p.requestCategory===category));}
 assert.equal((await c.api('/api/public/catalog?category=INVALID')).status,422);
 assert.ok(all.body.every(p=>!Object.hasOwn(p,'openingStock')&&!Object.hasOwn(p,'minStock')&&!Object.hasOwn(p,'activeIngredient')));
});
test('cilindros: varias dosis, fecha del servidor y conservación del inventario',async t=>{
 const c=await prepare(t);const before=await c.store.transact(tx=>tx.getInventory());const request=input();const result=await c.api('/api/public/requests','POST',request);assert.equal(result.status,201);assert.equal(result.body.status,'PENDIENTE');assert.deepEqual(result.body.items.map(i=>i.quantity),['0.375','76.5']);assert.deepEqual(result.body.items.map(i=>i.doseQuantity),['0.125','25.5']);assert.equal(result.body.containerCount,'3');assert.ok(Math.abs(Date.now()-Date.parse(result.body.createdAt))<5000);assert.deepEqual(await c.store.transact(tx=>tx.getInventory()),before);
 const stored=await c.store.transact(tx=>tx.findRequest(result.body.code));assert.deepEqual(stored.items.map(i=>i.baseQuantity),['375','76.5']);assert.equal(stored.privateKey,undefined);assert.equal(stored.privateKeyHash,digest(request.privateKey));
});
test('tanques y cantidades fraccionadas producen totales exactos',async t=>{
 const c=await prepare(t);const result=await c.api('/api/public/requests','POST',input({applicationMode:'TANQUES',containerCount:'2.5'}));assert.equal(result.status,201);assert.equal(result.body.applicationMode,'TANQUES');assert.deepEqual(result.body.items.map(i=>i.quantity),['0.3125','63.75']);
});
test('herramientas y otros admiten varias líneas sin campos de dosis',async t=>{
 const c=await prepare(t);for(const [category,id] of [['HERRAMIENTAS','tool'],['OTROS','other']]){const result=await c.api('/api/public/requests','POST',input({category,crop:undefined,applicationMode:undefined,containerCount:undefined,items:[{productId:id,quantity:'2.5',unit:'unidades'}]}));assert.equal(result.status,201);assert.equal(result.body.items[0].quantity,'2.5');assert.equal(result.body.applicationMode,null);assert.equal(result.body.crop,null);}
});
test('doble envío concurrente idempotente y conflicto con distinto contenido',async t=>{
 const c=await prepare(t);const data=input();const outcomes=await Promise.all([c.api('/api/public/requests','POST',{...data,operationId:data.operationId.toUpperCase()}),c.api('/api/public/requests','POST',data)]);assert.ok(outcomes.every(r=>r.status===201));assert.equal(outcomes[0].body.code,outcomes[1].body.code);const list=await c.store.transact(tx=>tx.listRequests());assert.equal(list.length,1);assert.equal((await c.api('/api/public/requests','POST',{...data,containerCount:'4'})).status,409);
 // Replay must continue to work when the product was renamed or deactivated.
 await c.store.transact(async tx=>{const current=await tx.getInventory();current.state.products[0].active=false;await tx.saveInventory(current.state,'3');});assert.equal((await c.api('/api/public/requests','POST',data)).status,201);
});
test('validaciones de categoría, unidades, campos y productos',async t=>{
 const c=await prepare(t);const variants=[
 {operationId:[crypto.randomUUID()]}, {category:'INVALID'}, {applicationMode:['CILINDROS','TANQUES']}, {containerCount:'-2'}, {containerCount:'NaN'}, {containerCount:'1000001'},
 {items:[{productId:'liquid',doseQuantity:'1',unit:'kg'}]}, {items:[{productId:'expired',doseQuantity:'1',unit:'L'}]},
 {items:[{productId:'unclassified',doseQuantity:'1',unit:'L'}]}, {items:[{productId:'tool',doseQuantity:'1',unit:'unidades'}]},
 {items:[{productId:'liquid',doseQuantity:'1',quantity:'3',unit:'L'}]},
 {category:'HERRAMIENTAS',items:[{productId:'tool',quantity:'1',unit:'unidades'}]},
 {items:[{productId:'liquid',doseQuantity:'1',unit:'L'},{productId:'liquid',doseQuantity:'2',unit:'L'}]}
 ];for(const variant of variants){await assert.rejects(c.services.registerRequest(input(variant)),error=>error.status===422);} assert.equal((await c.api('/api/public/requests','POST',input({category:'INVALID'}))).status,422);
 assert.equal((await c.store.transact(tx=>tx.listRequests())).length,0);
});
test('seguimiento privado y permisos: solo la solicitud propia, sin despachos',async t=>{
 const c=await prepare(t);const data=input();const created=await c.api('/api/public/requests','POST',data);const status=await c.api('/api/public/requests/status','POST',{code:created.body.code.toLowerCase(),privateKey:data.privateKey});assert.equal(status.status,200);assert.equal(status.body.requester,data.requester);assert.equal(status.body.privateKeyHash,undefined);assert.equal(status.body.operationId,undefined);assert.equal(status.body.payloadHash,undefined);
 assert.equal((await c.api('/api/public/requests/status','POST',{code:created.body.code,privateKey:'wrong'})).status,404);for(const route of ['/api/state','/api/requests','/api/users','/api/audit','/api/dispatches'])assert.equal((await c.api(route)).status,401);
});
test('Fase 1: solicitud histórica y reintento existente se conservan',async t=>{
 const c=await prepare(t);const id=crypto.randomUUID(),key=crypto.randomBytes(32).toString('hex');const legacy={id:crypto.randomUUID(),code:'JAP-'+digest(id).slice(0,20).toUpperCase(),privateKeyHash:digest(key),requester:'Anterior',destination:'Campo',notes:'',status:'REGISTRADA',createdAt:'2026-10-08T10:00:00.000Z',items:[{id:crypto.randomUUID(),productId:'liquid',productSnapshot:{name:'Producto anterior',unit:'bidones'},presentation:'Bidón 20 L',quantity:2,unit:'bidones'}]};await c.store.transact(tx=>tx.putRequest(legacy));
 const previous=structuredClone(legacy);const result=await c.api('/api/public/requests/status','POST',{code:legacy.code,privateKey:key});assert.equal(result.body.status,'PENDIENTE');const replay=await c.api('/api/public/requests','POST',{operationId:id,privateKey:key,requester:'Anterior',destination:'Campo',items:[{productId:'liquid',presentation:'Bidón 20 L',quantity:2,unit:'bidones'}]});assert.equal(replay.status,201);assert.deepEqual(await c.store.transact(tx=>tx.findRequest(legacy.code)),previous);
});
test('productos referenciados por solicitudes no pueden eliminarse; clasificación validada',()=>{
 const before={products:products(),purchases:[],outputs:[]};const next=structuredClone(before);next.products=next.products.filter(p=>p.id!=='tool');assert.throws(()=>validateChange(before,next,[],['tool']),/PRODUCT_HAS_REQUESTS/);
 const invalid=structuredClone(before);invalid.products[0].requestCategory='INVALID';assert.throws(()=>validateChange(before,invalid),/INVALID_REQUEST_CATEGORY/);
});
test('fallo de auditoría revierte solicitud y detalles sin modificar stock',async t=>{
 const c=await prepare(t);const before=await c.store.transact(tx=>tx.getInventory());const original=c.store.transact.bind(c.store);c.store.transact=work=>original(async tx=>{const audit=tx.audit.bind(tx);tx.audit=async event=>{if(event.action==='REQUEST_PUBLIC_CREATE')throw new Error('Injected audit failure');return audit(event);};return work(tx);});assert.equal((await c.api('/api/public/requests','POST',input())).status,500);assert.equal((await c.store.transact(tx=>tx.listRequests())).length,0);assert.deepEqual(await c.store.transact(tx=>tx.getInventory()),before);
});
module.exports={products,input};
