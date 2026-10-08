'use strict';
const {AppError}=require('./errors');
function number(value,fallback,min,max){if(value===undefined||value==='')return fallback;const n=Number(value);if(!Number.isInteger(n)||n<min||n>max)throw new Error('INVALID_OPERATIONAL_LIMIT');return n;}
class WorkGate {
 constructor({limit=2,queue=8,waitMs=2000,rssBytes=768*1024*1024,memory=()=>process.memoryUsage().rss}={}){this.limit=limit;this.maxQueue=queue;this.waitMs=waitMs;this.rssBytes=rssBytes;this.memory=memory;this.active=0;this.waiting=[];this.peak=0;}
 check(){if(this.memory()>this.rssBytes)throw new AppError(503,'RESOURCE_PRESSURE');}
 acquire(){this.check();if(this.active<this.limit){this.active++;this.peak=Math.max(this.peak,this.active);return Promise.resolve();}if(this.waiting.length>=this.maxQueue)throw new AppError(503,'RESOURCE_BUSY');return new Promise((resolve,reject)=>{const item={resolve,reject};item.timer=setTimeout(()=>{this.waiting=this.waiting.filter(x=>x!==item);reject(new AppError(503,'RESOURCE_BUSY'));},this.waitMs);this.waiting.push(item);});}
 release(){this.active--;while(this.waiting.length){const item=this.waiting.shift();clearTimeout(item.timer);try{this.check();this.active++;this.peak=Math.max(this.peak,this.active);item.resolve();break;}catch(e){item.reject(e);}}}
 async run(work){await this.acquire();try{return await work();}finally{this.release();}}
}
function limits(env=process.env){return {bodyBytes:number(env.HTTP_BODY_KIB,128,16,1024)*1024,inventoryBytes:number(env.INVENTORY_BODY_MIB,16,1,32)*1024*1024,statementMs:number(env.DB_STATEMENT_TIMEOUT_MS,15000,100,60000),lockMs:number(env.DB_LOCK_TIMEOUT_MS,3000,50,10000),idleMs:number(env.DB_IDLE_TRANSACTION_TIMEOUT_MS,10000,100,60000),rssBytes:number(env.RESOURCE_RSS_LIMIT_MIB,768,64,4096)*1024*1024};}
function heavyGate(env=process.env){return new WorkGate({limit:number(env.DOCUMENT_CONCURRENCY,2,1,4),queue:8,waitMs:5000,rssBytes:limits(env).rssBytes});}
function databaseError(error){if(error.status)return error;const codes={'57014':[503,'DATABASE_TIMEOUT'],'55P03':[409,'OPERATION_BUSY'],'40P01':[409,'TRANSACTION_CONFLICT'],'40001':[409,'TRANSACTION_CONFLICT'],'57P01':[503,'DATABASE_UNAVAILABLE'],'57P02':[503,'DATABASE_UNAVAILABLE'],'57P03':[503,'DATABASE_UNAVAILABLE'],'08006':[503,'DATABASE_UNAVAILABLE'],ECONNREFUSED:[503,'DATABASE_UNAVAILABLE'],ECONNRESET:[503,'DATABASE_UNAVAILABLE'],ETIMEDOUT:[503,'DATABASE_UNAVAILABLE']};if(/^08/.test(error.code||'')||/connection terminated|connection timeout|timeout exceeded when trying to connect/i.test(error.message||''))return new AppError(503,'DATABASE_UNAVAILABLE');const mapped=codes[error.code];return mapped?new AppError(...mapped):error;}
module.exports={WorkGate,limits,heavyGate,databaseError};
