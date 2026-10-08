'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const crypto=require('node:crypto');const fs=require('node:fs/promises');const path=require('node:path');
const {setup}=require('./helpers');const {hashPassword,verifyPassword,digest}=require('../src/security');
test('scrypt: sal individual, verificacion y longitud minima',async()=>{const a=await hashPassword('Password-test-2026');const b=await hashPassword('Password-test-2026');assert.notEqual(a,b);assert.ok(await verifyPassword('Password-test-2026',a));assert.equal(await verifyPassword('incorrect',a),false);await assert.rejects(hashPassword('admin123'));});
test('autenticacion, cookie segura, csrf y revocacion',async t=>{
 const c=await setup(t);
 assert.equal((await c.api('/api/state')).status,401);
 assert.equal((await c.api('/api/login','POST',{user:'admin',password:'admin123'})).status,401);
 const login=await c.api('/api/login','POST',{user:'testadmin',password:'Test-password-admin-2026'});assert.equal(login.status,200);assert.match(login.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);assert.equal(login.body.user.passwordHash,undefined);
 const session=await c.api('/api/session','GET',null,c.admin);assert.equal(session.body.role,'ADMINISTRADOR');
 const noCsrf=await c.api('/api/users','POST',{username:'badcsrf',password:'Password-test-2026',role:'ALMACENERO'},{token:c.admin.token,csrfToken:'wrong'});assert.equal(noCsrf.status,403);
 assert.equal((await c.api('/api/logout','POST',{},c.admin)).status,200);assert.equal((await c.api('/api/state','GET',null,c.admin)).status,401);
});
test('sesiones persistidas como hash, expiracion y cambios de rol',async t=>{
 const c=await setup(t);const raw=await fs.readFile(path.join(c.dir,'phase1.json'),'utf8');assert.ok(!raw.includes(c.admin.token));assert.ok(!raw.includes('Test-password-admin-2026'));
 const users=await c.api('/api/users','GET',null,c.admin);assert.ok(users.body.every(u=>!u.passwordHash));
 const warehouse=users.body.find(u=>u.username==='warehouse');assert.equal((await c.api('/api/users/'+warehouse.id,'PATCH',{role:'ADMINISTRADOR'},c.admin)).status,200);assert.equal((await c.api('/api/state','GET',null,c.warehouse)).status,401);
 const fresh=await c.services.login('warehouse','Test-password-warehouse-2026');await c.store.transact(async tx=>{const s=await tx.getSession(digest(fresh.token));s.expiresAt=0;await tx.putSession(s);});assert.equal((await c.api('/api/state','GET',null,fresh)).status,401);
});
test('ALMACENERO consulta existencias y Kardex pero no administra ni escribe',async t=>{
 const c=await setup(t);assert.equal((await c.api('/api/state','GET',null,c.warehouse)).status,200);
 for(const route of ['/api/users','/api/audit'])assert.equal((await c.api(route,'GET',null,c.warehouse)).status,403);
 assert.equal((await c.write(c.initial,'1',crypto.randomUUID(),c.warehouse)).status,403);
 assert.equal((await c.api('/api/users','POST',{username:'blocked',password:'Password-test-2026',role:'ADMINISTRADOR'},c.warehouse)).status,403);
});
test('ultimo administrador protegido; desactivacion y cambio de clave revocan sesiones',async t=>{
 const c=await setup(t);const users=(await c.api('/api/users','GET',null,c.admin)).body;const admin=users.find(u=>u.role==='ADMINISTRADOR');const warehouse=users.find(u=>u.role==='ALMACENERO');
 assert.equal((await c.api('/api/users/'+admin.id,'PATCH',{active:false},c.admin)).status,409);
 assert.equal((await c.api('/api/users/'+warehouse.id,'PATCH',{password:'New-password-test-2026'},c.admin)).status,200);
 assert.equal((await c.api('/api/state','GET',null,c.warehouse)).status,401);
 await assert.rejects(c.services.login('warehouse','Test-password-warehouse-2026'));
 const fresh=await c.services.login('warehouse','New-password-test-2026');assert.equal((await c.api('/api/users/'+warehouse.id,'PATCH',{active:false},c.admin)).status,200);assert.equal((await c.api('/api/state','GET',null,fresh)).status,401);
});
test('origen cruzado, archivos privados y errores sin secretos',async t=>{
 const c=await setup(t);assert.equal((await c.api('/api/login','POST',{user:'testadmin',password:'Test-password-admin-2026'},null,{Origin:'https://attacker.example'})).status,403);
 for(const route of ['/data/inventory.json','/src/store.js','/.env','/migrations/001_phase1.sql'])assert.equal((await c.api(route)).status,403);
 const invalid=await fetch(c.base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:'{'});assert.equal(invalid.status,400);assert.equal((await invalid.json()).error,'INVALID_JSON');
});
test('limites de intentos de login',async t=>{const c=await setup(t);for(let i=0;i<10;i++)assert.equal((await c.api('/api/login','POST',{user:'missing',password:'wrong'})).status,401);assert.equal((await c.api('/api/login','POST',{user:'missing',password:'wrong'})).status,429);});
test('dos guardados concurrentes: ganador preservado y conflicto explicito',async t=>{
 const c=await setup(t);const a=structuredClone(c.initial);a.products[0].name='Cambio A';const b=structuredClone(c.initial);b.products[0].name='Cambio B';
 const results=await Promise.all([c.write(a),c.write(b)]);assert.deepEqual(results.map(r=>r.status).sort(),[200,409]);const winner=results[0].status===200?a:b;
 const current=await c.api('/api/state','GET',null,c.admin);assert.equal(current.headers.get('x-state-revision'),'2');assert.deepEqual(current.body,winner);
 const audit=await c.api('/api/audit','GET',null,c.admin);assert.equal(audit.body.filter(a=>a.action==='INVENTORY_WRITE').length,1);
});
test('reintento idempotente no duplica movimientos ni auditoria',async t=>{
 const c=await setup(t);const next=structuredClone(c.initial);next.outputs.push({id:'out1',productId:'p1',date:'2026-10-08',destination:'Campo',reason:'Aplicacion',quantity:2});const id=crypto.randomUUID();
 assert.equal((await c.write(next,'1',id)).status,200);const replay=await c.write(next,'1',id);assert.equal(replay.status,200);assert.equal(replay.body.replayed,true);
 const changed=structuredClone(next);changed.outputs[0].quantity=3;assert.equal((await c.write(changed,'2',id)).status,409);
 assert.equal((await c.api('/api/state','GET',null,c.admin)).body.outputs.length,1);
});
test('version ausente y payload invalidos no persisten',async t=>{
 const c=await setup(t);assert.equal((await c.api('/api/state','POST',c.initial,c.admin,{'X-Operation-Id':crypto.randomUUID()})).status,428);
 const negative=structuredClone(c.initial);negative.products[0].openingStock=-5;assert.equal((await c.write(negative)).status,422);
 const duplicate=structuredClone(c.initial);duplicate.products.push({...duplicate.products[0]});assert.equal((await c.write(duplicate)).status,422);
 assert.deepEqual((await c.api('/api/state','GET',null,c.admin)).body,c.initial);
});
test('agotamiento por multiples lineas y unidades fisicas inconsistentes',async t=>{
 const c=await setup(t);const next=structuredClone(c.initial);for(let i=0;i<2;i++)next.outputs.push({id:'o'+i,productId:'p1',date:'2026-10-08',destination:'Campo',reason:'Aplicacion',quantity:6});assert.equal((await c.write(next)).body.error,'INSUFFICIENT_STOCK');
 next.outputs=[{id:'physical',productId:'p1',presentation:'Saco 50 kg',date:'2026-10-08',destination:'Campo',reason:'Aplicacion',quantity:1,allocations:[{presentation:'Saco 50 kg',quantity:1}],quantityMode:'physical',usedQuantity:5,usedUnit:'kg'}];assert.equal((await c.write(next)).body.error,'PHYSICAL_QUANTITY_MISMATCH');
 next.outputs[0].usedQuantity=50;assert.equal((await c.write(next)).status,200);
});
test('rollback atomico ante fallo de auditoria',async t=>{
 const c=await setup(t);const transact=c.store.transact.bind(c.store);c.store.transact=work=>transact(async tx=>{const audit=tx.audit.bind(tx);tx.audit=async e=>{if(e.action==='INVENTORY_WRITE')throw new Error('Simulated failure');return audit(e);};return work(tx);});
 const next=structuredClone(c.initial);next.products[0].name='Should roll back';assert.equal((await c.write(next)).status,500);
 assert.deepEqual((await c.api('/api/state','GET',null,c.admin)).body,c.initial);
});
test('bloqueo local de segundo proceso y preservacion exacta del JSON original',async t=>{
 const c=await setup(t);const {FileStore}=require('../src/store');await assert.rejects(new FileStore(c.dir).init(),/LOCAL_STORE_LOCKED/);
 const before=await fs.readFile(path.join(c.dir,'inventory.json'));const next=structuredClone(c.initial);next.products[0].name='Updated';assert.equal((await c.write(next)).status,200);assert.deepEqual(await fs.readFile(path.join(c.dir,'inventory.json')),before);
});
test('registro publico idempotente y consulta privada limitada',async t=>{
 const c=await setup(t);const input={operationId:crypto.randomUUID(),privateKey:crypto.randomBytes(32).toString('hex'),requestVersion:2,category:'AGROQUIMICOS',crop:'Arándano',applicationMode:'CILINDROS',containerCount:'1',requester:'Solicitante',destination:'Campo',items:[{productId:'p1',doseQuantity:'2',unit:'sacos'}]};
 const one=await c.api('/api/public/requests','POST',input);assert.equal(one.status,201);assert.equal(one.body.privateKeyHash,undefined);const two=await c.api('/api/public/requests','POST',input);assert.equal(one.body.code,two.body.code);
 assert.equal((await c.api('/api/public/requests/status','POST',{code:one.body.code,privateKey:'wrong'})).status,404);
 const status=await c.api('/api/public/requests/status','POST',{code:one.body.code,privateKey:input.privateKey});assert.equal(status.status,200);assert.equal(status.body.status,'PENDIENTE');assert.equal(status.body.privateKeyHash,undefined);assert.equal(status.body.operationId,undefined);
 const catalog=await c.api('/api/public/catalog');assert.ok(catalog.body.every(p=>p.openingStock===undefined));
 assert.equal((await c.api('/api/requests')).status,401);const internal=await c.api('/api/requests','GET',null,c.warehouse);assert.equal(internal.body.length,1);assert.equal(internal.body[0].privateKeyHash,undefined);
 assert.deepEqual((await c.api('/api/state','GET',null,c.admin)).body,c.initial);
 const audit=await c.api('/api/audit','GET',null,c.admin);assert.ok(!JSON.stringify(audit.body).includes(input.privateKey));
});

test('sesion de produccion siempre emite Secure y exige origen permitido',async t=>{
 const c=await setup(t);const {createServer}=require('../server');const server=createServer({store:c.store,services:c.services,production:true,publicOrigin:'https://japurima.example'});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>new Promise(resolve=>server.close(resolve)));
 const url='http://127.0.0.1:'+server.address().port;const response=await fetch(url+'/api/login',{method:'POST',headers:{'Content-Type':'application/json',Origin:'https://japurima.example'},body:JSON.stringify({user:'testadmin',password:'Test-password-admin-2026'})});assert.equal(response.status,200);assert.match(response.headers.get('set-cookie'),/; Secure$/);assert.match(response.headers.get('strict-transport-security'),/max-age/);
});
test('JSON null, registro invalido y salida de producto vencido se rechazan',async t=>{
 const c=await setup(t);const response=await fetch(c.base+'/api/login',{method:'POST',headers:{'Content-Type':'application/json'},body:'null'});assert.equal(response.status,400);
 const bad={operationId:crypto.randomUUID(),privateKey:crypto.randomBytes(32).toString('hex'),requester:'Solicitante',destination:'Campo',items:[{productId:'missing',presentation:'50 kg',quantity:2,unit:'sacos'}]};assert.equal((await c.api('/api/public/requests','POST',bad)).status,422);
 const next=structuredClone(c.initial);next.products[0].expired=true;next.outputs.push({id:'x',productId:'p1',date:'2026-10-08',quantity:1,destination:'Campo',reason:'Aplicacion'});assert.equal((await c.write(next)).body.error,'PRODUCT_NOT_AVAILABLE');
});
