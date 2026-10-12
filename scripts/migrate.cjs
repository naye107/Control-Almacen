'use strict';
const fs=require('node:fs/promises');const path=require('node:path');const {digest}=require('../src/security');const {createPool}=require('../src/database');
const {authorizeMigration}=require('./staging-policy.cjs');
async function migrate(pool,{through}={}) {
 await authorizeMigration(pool);
 const client=await pool.connect();
 try {await client.query('BEGIN');await client.query("SET LOCAL statement_timeout='60s';SET LOCAL lock_timeout='5s';SET LOCAL idle_in_transaction_session_timeout='60s'");await client.query('SELECT pg_advisory_xact_lock(74182026)');await client.query('CREATE TABLE IF NOT EXISTS schema_migrations(version text PRIMARY KEY,checksum text NOT NULL,applied_at timestamptz NOT NULL DEFAULT now())');
  let files=(await fs.readdir(path.join(__dirname,'../migrations'))).filter(f=>f.endsWith('.sql')).sort();
  if(through){const last=files.indexOf(through);if(last<0)throw new Error('UNKNOWN_MIGRATION');files=files.slice(0,last+1);}
  for(const file of files){const raw=(await fs.readFile(path.join(__dirname,'../migrations',file),'utf8')).replace(/^\uFEFF/,'');const checksum=digest(raw.replace(/\r\n/g,'\n'));const applied=(await client.query('SELECT checksum FROM schema_migrations WHERE version=$1',[file])).rows[0];if(applied){if(![checksum,digest(raw),digest(raw.replace(/\r?\n/g,'\r\n'))].includes(applied.checksum))throw new Error('MIGRATION_CHECKSUM_MISMATCH');continue;}
   await client.query(raw.replace(/^BEGIN;\s*/,'').replace(/COMMIT;\s*$/,''));await client.query('INSERT INTO schema_migrations(version,checksum) VALUES($1,$2)',[file,checksum]);}
  await client.query('COMMIT');
 }catch(e){await client.query('ROLLBACK');throw e;}finally{client.release();}
}
async function main(){if(!process.env.DATABASE_URL)throw new Error('DATABASE_URL_REQUIRED');const args=process.argv.slice(2);if(args.includes('--allow-production'))throw Error('PRODUCTION_MIGRATION_DISABLED');let url;try{url=new URL(process.env.DATABASE_URL);}catch{throw Error('INVALID_DATABASE_TARGET');}const target=url.hostname+url.pathname;if(args[0]!=='--confirm-target'||args[1]!==target)throw new Error('CONFIRM_TARGET_REQUIRED');const pool=createPool(process.env.DATABASE_URL);try{await migrate(pool);console.log('Migraciones completadas sobre destino autorizado.');}finally{await pool.end();}}
if(require.main===module)main().catch(()=>{console.error('Migración rechazada o fallida. Compruebe el destino autorizado, identidad Neon, vencimiento y permisos. No se muestran detalles sensibles.');process.exitCode=1;});
module.exports={migrate};
