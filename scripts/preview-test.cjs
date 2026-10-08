'use strict';
// Disposable preview only; never uses DATABASE_URL or the workspace data directory.
const {setup}=require('../test/helpers');
let cleanup;
setup({after:fn=>{cleanup=fn;}}).then(c=>{console.log('PREVIEW_URL='+c.base);process.on('SIGINT',async()=>{await cleanup();process.exit(0);});process.on('SIGTERM',async()=>{await cleanup();process.exit(0);});}).catch(e=>{console.error(e);process.exitCode=1;});
