'use strict';
const fs=require('node:fs/promises');const path=require('node:path');const crypto=require('node:crypto');const {execFileSync}=require('node:child_process');
const root=path.resolve(__dirname,'..');
async function walk(dir,prefix='') {const result=[];for(const item of await fs.readdir(dir,{withFileTypes:true})){if(['node_modules','.git','backups','.tools','.test-runtime'].includes(item.name))continue;const rel=path.join(prefix,item.name);if(item.isDirectory())result.push(...await walk(path.join(dir,item.name),rel));else if(item.isFile())result.push(rel);}return result;}
const hash=buffer=>crypto.createHash('sha256').update(buffer).digest('hex').toUpperCase();
async function verify(dir) {const manifest=JSON.parse((await fs.readFile(path.join(dir,'manifest.json'),'utf8')).replace(/^\uFEFF/,''));for(const entry of manifest){const rel=entry.path.replace(/\\/g,'/');if(path.isAbsolute(rel)||rel.split('/').includes('..'))throw new Error('INVALID_MANIFEST_PATH');const data=await fs.readFile(path.join(dir,rel));if(hash(data)!==entry.sha256.toUpperCase()||data.length!==entry.bytes)throw new Error('BACKUP_MISMATCH '+rel);}const inventoryFile=manifest.find(e=>e.path.replace(/\\/g,'/')==='data/inventory.json');const localFile=manifest.find(e=>e.path.replace(/\\/g,'/')==='data/phase1.json');if(inventoryFile||localFile){const data=JSON.parse(await fs.readFile(path.join(dir,(inventoryFile||localFile).path),'utf8'));const inv=inventoryFile?data:data.inventory?.state;if(!inv||!['products','purchases','outputs'].every(k=>Array.isArray(inv[k])))throw new Error('INVALID_INVENTORY_BACKUP');}execFileSync('git',['bundle','verify',path.join(dir,'repository.bundle')],{cwd:root,stdio:'pipe'});return manifest;}
async function main(){const [mode,arg,destination]=process.argv.slice(2);
 if(mode==='--verify'){const manifest=await verify(path.resolve(arg));console.log('Respaldo verificado: '+manifest.length+' archivos + Git bundle');return;}
 if(mode==='--restore'){
  const dir=path.resolve(arg);const manifest=await verify(dir);if(!destination)throw new Error('DESTINATION_REQUIRED');const target=path.resolve(destination);
  try{await fs.access(target);throw new Error('RESTORE_DESTINATION_MUST_NOT_EXIST');}catch(e){if(e.code!=='ENOENT')throw e;}
  execFileSync('git',['clone',path.join(dir,'repository.bundle'),target],{stdio:'inherit'});
  for(const entry of manifest){const rel=entry.path.replace(/\\/g,'/');await fs.mkdir(path.dirname(path.join(target,rel)),{recursive:true});await fs.copyFile(path.join(dir,rel),path.join(target,rel));}
  console.log('Restaurado en carpeta nueva: '+target+'. Revise configuracion antes de iniciar.');return;
 }
 if(mode)throw new Error('Use: npm run backup | -- --verify CARPETA | -- --restore CARPETA DESTINO_NUEVO');
 try { await fs.access(path.join(root,'data/.phase1.lock')); throw new Error('STOP_LOCAL_SERVER_BEFORE_BACKUP'); } catch(e) { if(e.code!=='ENOENT')throw e; }
 const dir=path.join(root,'backups','fase1-'+new Date().toISOString().replace(/[:.]/g,'-'));await fs.mkdir(dir,{recursive:true});const manifest=[];
 for(const rel of await walk(root)){const data=await fs.readFile(path.join(root,rel));const to=path.join(dir,rel);await fs.mkdir(path.dirname(to),{recursive:true});await fs.writeFile(to,data);manifest.push({path:rel,bytes:data.length,sha256:hash(data)});}
 await fs.writeFile(path.join(dir,'manifest.json'),JSON.stringify(manifest,null,2));execFileSync('git',['bundle','create',path.join(dir,'repository.bundle'),'--all'],{cwd:root});await verify(dir);console.log(dir);console.log('Respaldo de archivos y datos locales; NO contiene un dump de PostgreSQL.');
}
main().catch(e=>{console.error(e.message);process.exitCode=1;});
