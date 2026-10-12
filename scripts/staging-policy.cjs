'use strict';
// Operational safeguard, not a substitute for database privileges or custodianship.
const STAGING_NAME='japurima-staging';
// Conservative boundary: exact expiration time has not been supplied by Neon.
const EXPIRES_AT=Date.parse('2026-10-16T00:00:00-05:00');
const LOCAL=new Set(['localhost','127.0.0.1','[::1]']);
function parseTarget(value){try{return new URL(value);}catch{throw Error('INVALID_DATABASE_TARGET');}}
function stagingTarget(value,env=process.env,now=Date.now()) {
 const url=parseTarget(value);
 if(now>=EXPIRES_AT)throw Error('STAGING_AUTHORIZATION_EXPIRED');
 if(env.NEON_STAGING_BRANCH_NAME!==STAGING_NAME)throw Error('STAGING_NAME_NOT_AUTHORIZED');
 if(!/^br-[a-z0-9-]+$/.test(env.NEON_STAGING_BRANCH_ID||'')||! /^[a-z0-9-]+$/.test(env.NEON_STAGING_PROJECT_ID||''))throw Error('STAGING_IDENTIFIERS_REQUIRED');
 if(!/^ep-[a-z0-9-]+\.[a-z0-9.-]+\.neon\.tech$/.test(env.NEON_STAGING_HOST||'') || env.NEON_STAGING_HOST.includes('-pooler.'))throw Error('DIRECT_NEON_HOST_REQUIRED');
 if(!['postgres:','postgresql:'].includes(url.protocol)||url.hostname!==env.NEON_STAGING_HOST||url.pathname!=='/neondb'||(url.port&&url.port!=='5432')||url.hash)throw Error('DATABASE_TARGET_NOT_AUTHORIZED');
 // Prevent routing/options overrides and TLS weakening in a pasted URI.
 for(const [key,val] of url.searchParams)if(key!=='sslmode'||val!=='require')throw Error('DATABASE_OPTIONS_NOT_AUTHORIZED');
 return {url,host:url.hostname,branchId:env.NEON_STAGING_BRANCH_ID,projectId:env.NEON_STAGING_PROJECT_ID};
}
async function verifyNeon(target,{env=process.env,fetcher=fetch}={}) {
 return require('./neon-readonly-identity.cjs').verifyNeonIdentity({...target,branchName:STAGING_NAME},{env,fetcher});
}
async function authorizeMigration(pool,{env=process.env,fetcher=fetch,now=Date.now()}={}){
 const url=parseTarget(pool.options?.connectionString);
 if(env.NODE_ENV==='production')throw Error('PRODUCTION_MIGRATION_DISABLED');
 if(LOCAL.has(url.hostname)){if(!['postgres:','postgresql:'].includes(url.protocol)||!/^\/japurima_[a-z0-9_]+_test$/.test(url.pathname))throw Error('LOCAL_MIGRATION_NOT_AUTHORIZED');return {localTest:true};}
 return verifyNeon(stagingTarget(url.toString(),env,now),{env,fetcher});
}
module.exports={stagingTarget,verifyNeon,authorizeMigration,STAGING_NAME,EXPIRES_AT};
