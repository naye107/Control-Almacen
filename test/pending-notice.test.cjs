'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm'),crypto=require('node:crypto');

// Load the browser application without its automatic login bootstrap. Save,
// recovery storage and notification code remain the actual shipping functions.
function browser(){
 const nodes=new Map(),storage=new Map(),calls=[];
 const node=selector=>{if(!nodes.has(selector))nodes.set(selector,{hidden:true,textContent:'',value:'',classList:{add(){},remove(){}},focus(){}});return nodes.get(selector);};
 const context=vm.createContext({console,crypto,Intl,InventoryAccounting:require('../shared/inventory-accounting'),JapurimaXlsx:{},window:{location:{protocol:'https:'},clearTimeout(){},setTimeout(){}},document:{querySelector:node,querySelectorAll:()=>[]},sessionStorage:{setItem:(k,v)=>storage.set(k,v),removeItem:k=>storage.delete(k)},fetch:(url,options)=>new Promise((resolve,reject)=>calls.push({url,options,resolve,reject}))});
 const source=fs.readFileSync(path.join(__dirname,'../app.js'),'utf8');
 vm.runInContext(source.replace(/\binit\(\);\s*$/,''),context);
 vm.runInContext("currentRole='ADMINISTRADOR'; currentUsername='test_admin'; csrfToken='test-csrf'; lastServerRevision='6'; lastServerSnapshot=JSON.stringify(state); state.products.push({id:'new-product',unit:'kg'});",context);
 return {run:code=>vm.runInContext(code,context),notice:node('#pending-panel'),storage,calls};
}
const acknowledge=call=>call.resolve({ok:true,status:200,json:async()=>({ok:true,revision:'7'})});

test('a slow successful product save never displays the pending warning',async()=>{
 const b=browser(),saving=b.run('saveState()');
 assert.equal(b.calls.length,1);assert.equal(b.notice.hidden,true);assert.equal(b.storage.size,1,'recovery survives a closed tab during the request');
 acknowledge(b.calls[0]);assert.equal(await saving,true);assert.equal(b.notice.hidden,true);assert.equal(b.storage.size,0);
 assert.equal(b.run('lastServerRevision'),'7');assert.equal(b.run('state.products.length'),1);
});

test('unconfirmed network save retains recovery, and retry hides the warning until its result',async()=>{
 const b=browser(),saving=b.run('saveState()');
 b.calls[0].reject(new Error('Failed to fetch'));assert.equal(await saving,false);
 assert.equal(b.notice.hidden,false);assert.equal(b.storage.size,1);
 const blocked=b.run('saveState()');assert.equal(await blocked,false);assert.equal(b.calls.length,1,'no second operation before resolving the first');
 const retry=b.run('saveState(true)');assert.equal(b.notice.hidden,true);assert.equal(b.calls.length,2);
 assert.equal(b.calls[1].options.headers['X-Operation-Id'],b.calls[0].options.headers['X-Operation-Id']);assert.equal(b.calls[1].options.body,b.calls[0].options.body);
 acknowledge(b.calls[1]);assert.equal(await retry,true);assert.equal(b.notice.hidden,true);assert.equal(b.storage.size,0);
});

test('a rejected save still shows the real problem and preserves its pending copy',async()=>{
 const b=browser(),saving=b.run('saveState()');
 b.calls[0].resolve({ok:false,status:409,json:async()=>({error:'STATE_CONFLICT'})});
 assert.equal(await saving,false);assert.equal(b.notice.hidden,false);assert.equal(b.storage.size,1);
});
