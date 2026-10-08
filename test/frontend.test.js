'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const vm=require('node:vm');const fs=require('node:fs');const {fixture}=require('./helpers');
function browser(fetchImpl) {
 const nodes=new Map();const storage=new Map();const messages=[];
 const node=()=>({hidden:false,value:'',textContent:'',classList:{add(){},remove(){},contains(){return false;},toggle(){}},focus(){},addEventListener(){},querySelector(){return node();},querySelectorAll(){return [];},reset(){},dataset:{}});
 const context=vm.createContext({console,Intl,Date,Math,JSON,Number,String,Map,Set,Promise,Blob,TextEncoder,Uint8Array,Uint32Array,URL,crypto:require('node:crypto').webcrypto,InventoryRules:require('../shared/inventory-rules'),JapurimaXlsx:require('../shared/xlsx-writer'),fetch:fetchImpl,sessionStorage:{getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},localStorage:{getItem(){return null;},setItem(){}},document:{querySelector:s=>{if(!nodes.has(s))nodes.set(s,node());return nodes.get(s);},querySelectorAll:()=>[],body:node(),createElement:node},window:{location:{protocol:'http:'},setTimeout(){return 0;},clearTimeout(){},setInterval(){return 0;},clearInterval(){}},confirm:()=>false});
 const source=fs.readFileSync('app.js','utf8').replace(/init\(\);\s*$/,'');vm.runInContext(source,context);
 context.recordMessage=m=>messages.push(m);vm.runInContext("showToast = recordMessage; currentRole='ADMINISTRADOR'; currentUsername='testadmin'; csrfToken='csrf'; backendAvailable=true; lastServerRevision='1';",context);
 context.initial=fixture();vm.runInContext('setState(initial);lastServerSnapshot=JSON.stringify(state);',context);
 return {context,storage,messages,run:code=>vm.runInContext(code,context)};
}
const response=(status,body)=>({ok:status<400,status,json:async()=>body});
test('frontend: conflicto conserva copia y formulario, revierte estado sin mensaje de exito',async()=>{
 const b=browser(async()=>response(409,{error:'STATE_CONFLICT'}));b.run("state.products[0].name='Pending';");assert.equal(await b.run('saveState()'),false);assert.equal(b.run('state.products[0].name'),'Urea');assert.equal(b.run('JSON.parse(pendingOperation.snapshot).products[0].name'),'Pending');assert.ok(b.storage.has('japurima.pending.testadmin'));assert.ok(!b.messages.some(m=>m.includes('Cambios guardados')));
});
test('frontend: fallo de red y reintento usan mismo identificador, version y payload',async()=>{
 const sent=[];let fail=true;const b=browser(async(url,options)=>{sent.push(options);if(fail)throw new Error('Failed to fetch');return response(200,{ok:true,revision:'2',replayed:true});});b.run("state.products[0].name='Pending';");assert.equal(await b.run('saveState()'),false);fail=false;assert.equal(await b.run('saveState(true)'),true);assert.equal(sent[0].headers['X-Operation-Id'],sent[1].headers['X-Operation-Id']);assert.equal(sent[0].headers['X-State-Revision'],sent[1].headers['X-State-Revision']);assert.equal(sent[0].body,sent[1].body);assert.equal(b.run('pendingOperation'),null);assert.equal(b.run('state.products[0].name'),'Pending');assert.equal(b.storage.size,0);
});
test('frontend: sincronizacion no pisa formularios ni una operacion pendiente',async()=>{
 let calls=0;const b=browser(async()=>{calls++;return response(200,{});});b.run('formDirty=true;');await b.run('refreshStateFromServer()');assert.equal(calls,0);b.run('formDirty=false;pendingSave=true;');await b.run('refreshStateFromServer()');assert.equal(calls,0);b.run('pendingSave=false;pendingOperation={id:"pending"};');await b.run('refreshStateFromServer()');assert.equal(calls,0);
});
test('frontend: ALMACENERO no guarda; exportador XLSX y Kardex siguen disponibles',async()=>{
 const b=browser(async()=>{throw new Error('Unexpected request');});b.run("currentRole='ALMACENERO';");assert.equal(await b.run('saveState()'),false);
 const blob=b.run("createXlsxBlob([['Producto','Cantidad'],['Urea',xlsxNumber(38)]], 'Existencias')");const bytes=Buffer.from(await blob.arrayBuffer());assert.equal(bytes.readUInt32LE(0),0x04034b50);assert.ok(bytes.includes(Buffer.from('Urea')));assert.ok(bytes.includes(Buffer.from('xl/worksheets/sheet1.xml')));
 const original=JSON.parse(fs.readFileSync('test/fixtures/legacy-inventory.json','utf8'));b.context.historical=original;b.run('setState(historical);');assert.equal(b.run('getMovements().length'),4);assert.equal(b.run('getProductStats(state.products[0]).stock'),38);
});

test('frontend: errores recuperables SQL y recursos conservan operación y nunca anuncian éxito',async()=>{for(const [status,error] of [[503,'RESOURCE_BUSY'],[503,'DATABASE_TIMEOUT'],[409,'OPERATION_BUSY']]){const b=browser(async()=>response(status,{error}));b.run("state.products[0].name='Pendiente';");assert.equal(await b.run('saveState()'),false);assert.ok(b.storage.has('japurima.pending.testadmin'));assert.equal(b.run('JSON.parse(pendingOperation.snapshot).products[0].name'),'Pendiente');assert.ok(!b.messages.some(m=>m.includes('Cambios guardados')));}});
