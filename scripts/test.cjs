'use strict';
const fs=require('node:fs');const path=require('node:path');const {spawnSync}=require('node:child_process');
const files=fs.readdirSync(path.join(__dirname,'../test')).filter(name=>name.endsWith('.test.js')).map(name=>path.join(__dirname,'../test',name));
const result=spawnSync(process.execPath,['--test','--test-reporter=spec',...files],{stdio:'inherit',cwd:path.join(__dirname,'..')});
if(result.error)throw result.error;process.exitCode=result.status??1;
