'use strict';
// Starts an isolated localhost PostgreSQL cluster; never reads DATABASE_URL.
const fs=require('node:fs/promises');const path=require('node:path');const crypto=require('node:crypto');const net=require('node:net');const {spawn}=require('node:child_process');const {createPool}=require('../src/database');
const root=path.resolve(__dirname,'..');
function command(exe,args,env=process.env){return new Promise((resolve,reject)=>{const child=spawn(exe,args,{cwd:root,env,windowsHide:true,stdio:'inherit'});child.on('error',reject);child.on('exit',code=>code===0?resolve():reject(new Error(path.basename(exe)+' exited '+code)));});}
async function freePort(){const s=net.createServer();await new Promise((resolve,reject)=>{s.once('error',reject);s.listen(0,'127.0.0.1',resolve);});const port=s.address().port;await new Promise(resolve=>s.close(resolve));return port;}
async function main(){
 const bin=path.resolve(process.env.PG_BIN_DIR||path.join(root,'.tools/postgres/pgsql/bin'));const exe=name=>path.join(bin,name+(process.platform==='win32'?'.exe':''));await fs.access(exe('initdb'));
 const dir=path.join(root,'.test-runtime','postgres-'+Date.now()+'-'+crypto.randomBytes(3).toString('hex'));await fs.mkdir(dir,{recursive:true});const data=path.join(dir,'data'),pw=path.join(dir,'password.tmp');const password=crypto.randomBytes(32).toString('hex');await fs.writeFile(pw,password+'\n',{mode:0o600});const port=await freePort();let started=false;
 try{
  await command(exe('initdb'),['-D',data,'-U','japurima_test','--auth=scram-sha-256','--encoding=UTF8','--locale=C','--pwfile='+pw]);await fs.unlink(pw);
  await command(exe('pg_ctl'),['-D',data,'-l',path.join(dir,'postgres.log'),'-o','-h 127.0.0.1 -p '+port,'-w','start']);started=true;
  const database='japurima_'+Date.now()+'_test';const base='postgresql://japurima_test:'+password+'@127.0.0.1:'+port+'/';const pool=createPool(base+'postgres');try{await pool.query('CREATE DATABASE '+database);}finally{await pool.end();}
  console.log('PostgreSQL aislado en 127.0.0.1:'+port+'; base desechable '+database);
  await command(process.execPath,['scripts/test.cjs'],{...process.env,DATABASE_URL:'',TEST_DATABASE_URL:base+database,NODE_ENV:'test',PHASE5A_CHECKS:process.argv.includes('--with-phase5a')?'1':'0',PG_BIN_DIR:bin});
  if(process.argv.includes('--with-browser')||process.argv.includes('--with-documents')||process.argv.includes('--with-phase5a')){const browserDatabase='japurima_'+Date.now()+'_browser_test';const create=createPool(base+'postgres');try{await create.query('CREATE DATABASE '+browserDatabase);}finally{await create.end();}await command(process.execPath,[(process.argv.includes('--with-documents')||process.argv.includes('--with-phase5a'))?'scripts/test-document-browser.cjs':'scripts/test-dispatch-browser.cjs'],{...process.env,DATABASE_URL:'',TEST_DATABASE_URL:base+browserDatabase,NODE_ENV:'test'});}
 }finally{await fs.unlink(pw).catch(()=>{});if(started)await command(exe('pg_ctl'),['-D',data,'-m','fast','-w','stop']);}
}
if(require.main===module)main().catch(e=>{console.error(e.message);process.exitCode=1;});