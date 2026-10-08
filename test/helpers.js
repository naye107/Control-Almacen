'use strict';
const fs=require('node:fs/promises');const os=require('node:os');const path=require('node:path');const {FileStore}=require('../src/store');const {Services}=require('../src/services');const {createServer}=require('../server');
const crypto=require('node:crypto');
const fixture=()=>({products:[{id:'p1',name:'Urea',category:'Nitrogenado',requestCategory:'AGROQUIMICOS',presentation:'Saco 50 kg',unit:'sacos',openingStock:10,minStock:2,active:true}],purchases:[],outputs:[]});
async function setup(t) {
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'japurima-test-'));const initial=fixture();await fs.writeFile(path.join(dir,'inventory.json'),JSON.stringify(initial));
 const store=new FileStore(dir);await store.init();const services=new Services(store);await services.init();
 await services.createUser({username:'testadmin',password:'Test-password-admin-2026',role:'ADMINISTRADOR'},null,true);
 const admin=await services.login('testadmin','Test-password-admin-2026');
 const adminHash=require('../src/security').digest(admin.token);
 await services.createUser({username:'warehouse',password:'Test-password-warehouse-2026',role:'ALMACENERO'},adminHash);
 const server=createServer({store,services});await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
 const base='http://127.0.0.1:'+server.address().port;
 t.after(async()=>{await new Promise(resolve=>server.close(resolve));await store.close();await fs.rm(dir,{recursive:true,force:true});});
 async function api(route,method='GET',data,auth,headers={}){
  const response=await fetch(base+route,{method,headers:{...(data?{'Content-Type':'application/json'}:{}),...(auth?{'Cookie':'japurima_session='+auth.token,'X-CSRF-Token':auth.csrfToken}:{}),...headers},body:data?JSON.stringify(data):undefined});
  return {status:response.status,body:await response.json(),headers:response.headers};
 }
 const warehouse=await services.login('warehouse','Test-password-warehouse-2026');
 const write=(state,revision='1',id=crypto.randomUUID(),auth=admin)=>api('/api/state','POST',state,auth,{'X-State-Revision':revision,'X-Operation-Id':id});
 return {dir,store,services,initial,admin,adminHash,warehouse,api,write,base};
}
module.exports={setup,fixture};
