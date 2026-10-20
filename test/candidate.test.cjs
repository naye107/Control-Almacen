'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const root=path.resolve(__dirname,'..');
test('production package starts the PostgreSQL server, without demo bootstrap',()=>{
 const pkg=JSON.parse(fs.readFileSync(path.join(root,'package.json')));
 assert.equal(pkg.scripts.start,'node server.js');
 assert.equal(fs.existsSync(path.join(root,'scripts/demo-server.cjs')),false);
 assert.equal(fs.existsSync(path.join(root,'data')),false);
 const server=fs.readFileSync(path.join(root,'server.js'),'utf8');
 assert.match(server,/if\(production\).*DATABASE_URL.*origin\.protocol!==\x27https:\x27/);
 const store=fs.readFileSync(path.join(root,'src/store.js'),'utf8');
 assert.match(store,/010_fertilization_requests\.sql/);assert.match(store,/result\.rowCount!==10/);
 for(const file of ['index.html','public.html'])assert.equal(fs.readFileSync(path.join(root,file),'utf8').includes('<aside class="demo-notice"'),false);
});
test('001–006 are byte-identical to the main migration files',()=>{
 const source=path.resolve(root,'../../migrations');
 for(const file of fs.readdirSync(source).filter(f=>/^00[1-6]_.*\.sql$/.test(f))){
  const hash=p=>crypto.createHash('sha256').update(fs.readFileSync(p)).digest('hex');
  assert.equal(hash(path.join(root,'migrations',file)),hash(path.join(source,file)),file);
 }
});
test('007 changes role constraints transactionally without updating historical data',()=>{
 const sql=fs.readFileSync(path.join(root,'migrations/007_user_roles.sql'),'utf8');
 assert.match(sql,/^BEGIN;/);assert.match(sql,/COMMIT;\s*$/);
 assert.match(sql,/SUPERVISOR/);assert.match(sql,/VALIDATE CONSTRAINT users_roles_three_check/);
 assert.ok(sql.indexOf('VALIDATE CONSTRAINT')<sql.indexOf('DROP CONSTRAINT'));
 assert.equal(/\b(?:UPDATE|DELETE|INSERT|TRUNCATE|DROP TABLE)\b/i.test(sql),false);
});
