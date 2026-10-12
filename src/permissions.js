'use strict';
const {isDeepStrictEqual}=require('node:util');
const {AppError}=require('./errors');
const ROLES=Object.freeze(['ADMINISTRADOR','ALMACENERO','SUPERVISOR']);
function requireOperator(user){if(!user)throw new AppError(401,'UNAUTHORIZED');if(!['ADMINISTRADOR','ALMACENERO'].includes(user.role))throw new AppError(403,'FORBIDDEN');}
function validateWarehouseChange(previous,proposed){
 const fail=()=>{throw new AppError(403,'WAREHOUSE_APPEND_ONLY');};
 if(!proposed||!Array.isArray(proposed.products)||!Array.isArray(proposed.purchases)||!Array.isArray(proposed.outputs))fail();
 if(!isDeepStrictEqual(proposed.products,previous.products))fail();
 // Warehouse operators can add movements, never rewrite or remove history.
 for(const collection of ['purchases','outputs']){
  if(!isDeepStrictEqual(proposed[collection].slice(0,previous[collection].length),previous[collection]))fail();
 }
}
module.exports={ROLES,requireOperator,validateWarehouseChange};
