'use strict';
const {atStage,failure}=require('./backup-diagnostics.cjs');
// Shared control-plane verification. No URI retrieval, writes or redirects.
async function verifyNeonIdentity(target,{env=process.env,fetcher=fetch}={}) {
 if(!env.NEON_API_KEY)throw Error('NEON_IDENTITY_VERIFICATION_REQUIRED');
 const base='https://console.neon.tech/api/v2/projects/'+encodeURIComponent(target.projectId)+'/branches/'+encodeURIComponent(target.branchId);
 async function get(url,stage){return atStage(stage,async()=>{const response=await fetcher(url,{method:'GET',headers:{Authorization:'Bearer '+env.NEON_API_KEY},signal:AbortSignal.timeout(10000),redirect:'error'});if(!response.ok){const codes={401:'NEON_API_AUTHENTICATION_FAILED',403:'NEON_API_PERMISSION_DENIED',404:'NEON_API_TARGET_NOT_FOUND',429:'NEON_API_RATE_LIMITED'};throw failure(codes[response.status]||(response.status>=500?'NEON_API_SERVER_UNAVAILABLE':'NEON_IDENTITY_CHECK_REJECTED'),stage);}try{return await response.json();}catch{throw failure('NEON_IDENTITY_RESPONSE_INVALID',stage);}});}
 const detail=await get(base,'neon-api-branch');if(!detail||typeof detail!=='object')throw failure('NEON_IDENTITY_RESPONSE_INVALID','neon-api-branch');const branch=detail.branch;
 if(!branch||branch.id!==target.branchId||branch.name!==target.branchName||(branch.project_id&&branch.project_id!==target.projectId))throw failure('NEON_BRANCH_NOT_AUTHORIZED','neon-api-branch');
 const result=await get(base+'/endpoints','neon-api-endpoints');
 if(!result||!Array.isArray(result.endpoints)||!result.endpoints.some(e=>e&&e.branch_id===target.branchId&&e.host===target.host&&!e.disabled&&(!e.project_id||e.project_id===target.projectId)))throw failure('NEON_ENDPOINT_NOT_AUTHORIZED','neon-api-endpoints');
 return {branchName:branch.name,branchId:branch.id,verifiedBy:'Neon API GET'};
}
module.exports={verifyNeonIdentity};
