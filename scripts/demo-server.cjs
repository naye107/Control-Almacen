'use strict';
// Demonstration only: never imports inventory, users or a database connection.
const fs=require('node:fs/promises'),os=require('node:os'),path=require('node:path');
const {FileStore}=require('../src/store'),{Services}=require('../src/services');
const {createServer}=require('../server');
const PRODUCTS=[
 {id:'demo-agro',name:'DEMO Agroquímico',category:'Agroquímicos',requestCategory:'AGROQUIMICOS',presentation:'Bidón 5 L',unit:'bidones',openingStock:10,minStock:2,active:true},
 {id:'demo-tool',name:'DEMO Herramienta',category:'Herramientas',requestCategory:'HERRAMIENTAS',presentation:'Unidad',unit:'unidades',openingStock:10,minStock:2,active:true},
 {id:'demo-other',name:'DEMO Otro producto',category:'Otros',requestCategory:'OTROS',presentation:'Saco 25 kg',unit:'sacos',openingStock:10,minStock:2,active:true}
];
async function startDemo(env=process.env){
 if(env.DATABASE_URL||env.DEMO_DATABASE_URL)throw Error('DEMO_DATABASE_CONNECTION_FORBIDDEN');
 const raw=env.PUBLIC_ORIGIN||env.RENDER_EXTERNAL_URL;
 let origin;try{origin=new URL(raw);}catch{throw Error('DEMO_HTTPS_ORIGIN_REQUIRED');}
 if(origin.protocol!=='https:'||origin.origin!==raw)throw Error('DEMO_HTTPS_ORIGIN_REQUIRED');
 const username=env.DEMO_ADMIN_USERNAME,password=env.DEMO_ADMIN_PASSWORD;
 if(!username||typeof password!=='string'||password.length<12||password.length>256)throw Error('PRIVATE_DEMO_ADMIN_REQUIRED');
 const port=Number(env.PORT||10000);if(!Number.isInteger(port)||port<1||port>65535)throw Error('INVALID_DEMO_PORT');
 // A fresh private directory each start. Free hosting may discard all test data.
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'japurima-online-demo-'));
 await fs.writeFile(path.join(dir,'inventory.json'),JSON.stringify({products:PRODUCTS,purchases:[],outputs:[]}),{flag:'wx',mode:0o600});
 const store=new FileStore(dir);let server;
 try{
  await store.init();const services=new Services(store);await services.init();
  await services.createUser({username,password,role:'ADMINISTRADOR'},null,true);
  server=createServer({store,services,production:true,publicOrigin:origin.origin,trustProxy:true,maintenance:false});
  await new Promise((resolve,reject)=>{server.once('error',reject);server.listen(port,'0.0.0.0',resolve);});
  return {server,store,async close(){server.beginDrain();await new Promise(resolve=>server.close(resolve));await store.close();}};
 }catch(e){if(server?.listening)await new Promise(resolve=>server.close(resolve));await store.close().catch(()=>{});throw e;}
}
async function main(){
 const demo=await startDemo();console.log('JAPURIMA DEMO iniciada: exclusivamente datos ficticios; almacenamiento temporal.');
 let stopping=false;const stop=()=>{if(stopping)return;stopping=true;const timer=setTimeout(()=>demo.server.closeAllConnections(),20000);timer.unref();demo.close().then(()=>{clearTimeout(timer);process.exit(0);}).catch(()=>process.exit(1));};
 demo.server.on('error',()=>{console.error('DEMO_SERVER_ERROR');stop();});process.on('SIGTERM',stop);process.on('SIGINT',stop);
}
if(require.main===module)main().catch(()=>{console.error('DEMO_START_REJECTED: verificar configuracion privada; detalles originales ocultos.');process.exitCode=1;});
module.exports={startDemo,PRODUCTS};
