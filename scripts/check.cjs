'use strict';
const fs=require('node:fs');const path=require('node:path');const {execFileSync}=require('node:child_process');
function walk(dir){return fs.readdirSync(dir,{withFileTypes:true}).flatMap(e=>e.isDirectory()?walk(path.join(dir,e.name)):/\.(js|cjs)$/.test(e.name)?[path.join(dir,e.name)]:[]);}
for(const file of ['server.js','app.js','users.js','public.js','dispatches.js','documents.js','reports.js',...['src','shared','scripts','test'].flatMap(walk)])execFileSync(process.execPath,['--check',file],{stdio:'inherit'});
console.log('Sintaxis verificada.');
