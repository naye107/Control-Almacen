'use strict';
const test=require('node:test'),assert=require('node:assert/strict');
const A=require('../shared/inventory-accounting'),Q=require('../shared/dispatch-rules'),{validateChange}=require('../src/inventory-service');
const p=()=>({id:'p',name:'Urea',activeIngredient:'N',category:'Fertilizante',requestCategory:'AGROQUIMICOS',unit:'kg',quantityBasis:'TOTAL',presentation:'1 kg',openingStock:10,minStock:0,active:true,expired:false,openingExpiryDate:'2099-12-31',openingUnitPrice:2,openingCurrency:'PEN',openingExchangeRate:null});
const state=product=>({products:[product],purchases:[],outputs:[]});
const buy=(id,date,quantity,unitPrice,expiryDate='2099-01-01',currency='PEN',exchangeRate=null)=>({id,productId:'p',date,quantity,unitPrice,expiryDate,currency,exchangeRate,presentation:'1 kg',supplier:'Proveedor',lot:id});
const out=(id,date,quantity)=>({id,productId:'p',date,quantity,presentation:'1 kg',destination:'Campo',reason:'Aplicación'});

test('moving weighted average values mixed-currency receipts and issues exactly',()=>{
 const product=p(),s=state(product);s.purchases=[buy('b','2026-01-01',10,1,'2099-01-01','USD',4)];s.outputs=[out('o','2026-01-02',5)];
 const a=A.ledger(s,product,'2026-01-03');assert.equal(A.money(a.purchases.get('b').total),'40.00');assert.equal(A.money(a.outputs.get('o').unitPrice),'3.00');assert.equal(A.money(a.outputs.get('o').total),'15.00');assert.equal(A.money(a.value),'45.00');assert.equal(A.number(a.quantity),15);
 s.purchases.push(buy('c','2026-01-03',5,6));s.outputs.push(out('o2','2026-01-04',4));const b=A.ledger(s,product,'2026-01-05');assert.equal(A.money(b.average),'3.75');assert.equal(A.money(b.outputs.get('o2').total),'15.00');assert.equal(A.money(b.value),'60.00');
 // An as-of balance never pulls a later receipt or output into the past.
 assert.equal(A.money(A.ledger(s,product,'2026-01-02').value),'45.00');
});

test('unknown historical price is not silently valued at zero; a real zero price is supported',()=>{
 const product=p();delete product.openingUnitPrice;const s=state(product);s.purchases=[buy('b','2026-01-01',10,4)];let a=A.ledger(s,product,'2026-01-02');assert.equal(a.value,null);assert.equal(a.average,null);
 s.outputs=[out('o','2026-01-03',20)];a=A.ledger(s,product,'2026-01-03');assert.equal(A.money(a.value),'0.00');assert.equal(a.outputs.get('o').total,null);
 s.purchases.push(buy('c','2026-01-04',3,2));assert.equal(A.money(A.ledger(s,product,'2026-01-04').value),'6.00');
 product.openingUnitPrice=0;assert.equal(A.money(A.ledger(state(product),product,'2026-01-01').value),'0.00');
});

test('lot dates change availability automatically, partial expiration and FEFO keep live lots usable',()=>{
 const product=p();product.openingStock=5;product.openingExpiryDate='2026-01-01';const s=state(product);s.purchases=[buy('b','2026-01-01',8,2,'2026-01-10'),buy('c','2026-01-01',4,2,'2026-02-01')];
 assert.equal(A.ledger(s,product,'2026-01-01').status,'');let a=A.ledger(s,product,'2026-01-02');assert.equal(a.status,'Parcialmente vencido');assert.equal(A.number(a.usable),12);assert.equal(A.number(a.expired),5);
 s.outputs=[out('o','2026-01-02',6)];a=A.ledger(s,product,'2026-01-03');assert.equal(A.number(a.expired),5);assert.equal(A.number(a.usable),6);assert.equal(A.number(a.lots.find(l=>l.id==='b').remaining),2);
 a=A.ledger(s,product,'2026-01-11');assert.equal(A.number(a.expired),7);assert.equal(A.number(a.usable),4);assert.equal(A.ledger(s,product,'2026-02-02').status,'Vencido');
});

test('missing expiry stays explicit and does not invent expired stock',()=>{const product=p();product.openingExpiryDate='';const a=A.ledger(state(product),product,'2099-01-01');assert.equal(a.status,'');assert.equal(A.number(a.undated),10);assert.equal(A.number(a.usable),10);});

test('server rejects invalid dates, missing USD rate, negative prices and manual expired toggles',()=>{
 for(const patch of [{openingExpiryDate:'2026-02-30'},{openingUnitPrice:-1},{openingCurrency:'EUR'},{openingCurrency:'USD',openingExchangeRate:null}])assert.throws(()=>validateChange({products:[],purchases:[],outputs:[]},state({...p(),...patch})));
 const product=p(),s=state(product);assert.throws(()=>validateChange(s,state({...product,expired:true})),{code:'EXPIRY_IS_AUTOMATIC'});
 for(const patch of [{expiryDate:'bad'},{unitPrice:-2},{currency:'USD',exchangeRate:0}])assert.throws(()=>validateChange(s,{...s,purchases:[{...buy('b','2026-01-01',2,3),...patch}]}));
});

test('server blocks expired-only issues and cumulative over-issues against unexpired stock',()=>{
 const product=p();product.openingExpiryDate='2000-01-01';const s=state(product),now=A.today();assert.throws(()=>validateChange(s,{...s,outputs:[out('o',now,1)]}),{code:'INSUFFICIENT_UNEXPIRED_STOCK'});
 const next={...s,purchases:[buy('b',now,2,2)],outputs:[out('o',now,2)]};assert.doesNotThrow(()=>validateChange(s,next));assert.throws(()=>validateChange(s,{...next,outputs:[out('o',now,2),out('o2',now,1)]}),{code:'INSUFFICIENT_UNEXPIRED_STOCK'});
});

test('dispatch availability and allocation exclude expired quantities',()=>{const Stock=require('../src/stock-service'),product=p();product.openingExpiryDate='2000-01-01';const s=state(product),item={unit:'kg',presentation:'1 kg',productSnapshot:{...product}};assert.equal(Stock.available(s,product,item).quantity,'0');assert.throws(()=>Stock.allocate(s,product,item,'1'),{message:'INSUFFICIENT_UNEXPIRED_STOCK'});s.purchases=[buy('b',A.today(),2,3)];assert.equal(Stock.available(s,product,item).quantity,'2');assert.equal(Stock.allocate(s,product,item,'2').usedQuantity,2);});

test('money rounds once at display instead of losing fractions in every movement',()=>{assert.equal(A.money(Q.read('0.005')),'0.01');assert.equal(A.money(Q.read('0.004')),'0.00');assert.equal(A.money(Q.q(1,3)),'0.33');assert.equal(A.validDate('2028-02-29'),true);assert.equal(A.validDate('2026-02-29'),false);});

test('a return restores exact cost and expiry without changing earlier issues on its day',()=>{
 const product=p();product.openingStock=2;product.openingUnitPrice=1;const s=state(product);s.outputs=[out('old','2026-01-01',1),out('today','2026-01-02',1)];s.purchases=[buy('b','2026-01-02',1,2)];
 const before=A.ledger(s,product,'2026-01-02');assert.equal(A.money(before.outputs.get('today').total),'1.50');
 s.purchases.push({...buy('return','2026-01-02',1,null),returnOfOutput:'old',returnOfDispatch:'d',returnSequence:2,returnCost:Q.json(Q.read(1))});
 const after=A.ledger(s,product,'2026-01-02');assert.equal(A.money(after.outputs.get('today').total),'1.50');assert.equal(A.money(after.value),'2.50');assert.equal(A.number(after.quantity),2);
 s.outputs.push(out('later','2026-01-02',1));assert.equal(A.money(A.ledger(s,product,'2026-01-02').outputs.get('later').total),'1.25');
});

test('real service requests and dispatches cannot use an expired lot',async t=>{
 const fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os'),crypto=require('node:crypto'),{FileStore}=require('../src/store'),{Services}=require('../src/services'),{digest}=require('../src/security');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'japurima-lots-')),store=new FileStore(dir);await store.init();t.after(()=>store.close());const services=new Services(store);await services.init();const password=crypto.randomBytes(24).toString('hex');await services.createUser({username:'lot_admin',role:'ADMINISTRADOR',password},null,true);const login=await services.login('lot_admin',password),hash=digest(login.token);
 const product=p();product.openingExpiryDate='2000-01-01';let current=await store.transact(tx=>tx.getInventory());const initial=state(product);await services.inventoryWrite(hash,initial,current.version,crypto.randomUUID());assert.equal((await services.requests.catalog()).length,0);
 current=await store.transact(tx=>tx.getInventory());initial.purchases=[buy('good',A.today(),2,1,'2099-01-01','USD',4)];await services.inventoryWrite(hash,initial,current.version,crypto.randomUUID());assert.equal((await services.requests.catalog()).length,1);
 const r=await services.registerRequest({requestVersion:2,operationId:crypto.randomUUID(),privateKey:crypto.randomBytes(32).toString('hex'),category:'AGROQUIMICOS',requester:'Campo',destination:'Campo',crop:'Prueba',applicationMode:'CILINDROS',containerCount:'1',items:[{productId:'p',unit:'kg',doseQuantity:'3'}]});const request=await store.transact(tx=>tx.findRequest(r.code));const detail=await services.dispatches.detail(hash,request.id);assert.equal(detail.items[0].availability.quantity,'2');
 const payload={requestId:request.id,operationId:crypto.randomUUID(),inventoryRevision:detail.inventoryRevision,requestRevision:detail.requestRevision,recipient:'Prueba',items:[{requestItemId:detail.items[0].id,unit:'kg',quantity:'3'}]};await assert.rejects(services.dispatches.confirmation(hash,payload),{code:'INSUFFICIENT_UNEXPIRED_STOCK'});
 payload.items[0].quantity='2';await services.dispatches.confirmation(hash,payload);const after=await store.transact(tx=>tx.getInventory());assert.equal(A.number(A.ledger(after.state,product).expired),10);assert.equal(A.number(A.ledger(after.state,product).usable),0);
});
