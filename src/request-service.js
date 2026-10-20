'use strict';
const crypto=require('node:crypto');
const {AppError}=require('./errors');
const {digest,equal}=require('./security');
const rules=require('../shared/request-rules');
const Accounting=require('../shared/inventory-accounting');
const availableProduct=(state,p)=>Accounting.ledger(state,p).status!=='Vencido';
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const status=value=>({REGISTRADA:'PENDIENTE',PARCIAL:'PARCIALMENTE_DESPACHADA'}[value]||value);
function publicRequest(r){
 const result={code:r.code,status:status(r.status),createdAt:r.createdAt,items:r.items.map(i=>({product:i.productSnapshot.name,presentation:i.presentation,quantity:i.quantity,unit:i.unit,quantityBasis:i.productSnapshot.quantityBasis,...(r.requestVersion===2?{lineNumber:i.lineNumber,doseQuantity:i.doseQuantity}: {})}))};
 if(r.requestVersion===2)Object.assign(result,{requestVersion:2,category:r.category,requester:r.requester,destination:r.destination,notes:r.notes,crop:r.crop,applicationMode:r.applicationMode,containerCount:r.containerCount});return result;
}
function cleanText(value,required,max){if(value===undefined&&!required)return '';if(typeof value!=='string'||value.trim().length>max||(required&&!value.trim()))throw new AppError(422,'INVALID_REQUEST_TEXT');return value.trim();}
function object(value,keys){if(!value||typeof value!=='object'||Array.isArray(value)||Object.keys(value).some(k=>!keys.includes(k)))throw new AppError(422,'INVALID_REQUEST_FIELDS');}
function normalizeInput(input){
 object(input,['requestVersion','operationId','privateKey','category','requester','destination','notes','crop','applicationMode','containerCount','items']);
 if(input.requestVersion!==2)throw new AppError(422,'REQUEST_VERSION_REQUIRED');
 if(typeof input.operationId!=='string'||!UUID.test(input.operationId)||!/^[A-Za-z0-9_-]{32,128}$/.test(input.privateKey||''))throw new AppError(422,'PRIVATE_KEY_AND_OPERATION_REQUIRED');
 if(!Object.hasOwn(rules.CATEGORIES,input.category))throw new AppError(422,'INVALID_CATEGORY');
 const agro=input.category==='AGROQUIMICOS';const result={requestVersion:2,category:input.category,requester:cleanText(input.requester,true,150),destination:cleanText(input.destination,true,150),notes:cleanText(input.notes,false,500),crop:null,applicationMode:null,containerCount:null};
 if(agro){result.crop=cleanText(input.crop,true,150);if(!['CILINDROS','TANQUES'].includes(input.applicationMode))throw new AppError(422,'INVALID_APPLICATION_MODE');result.applicationMode=input.applicationMode;result.containerCount=rules.normalize(input.containerCount);if(Number(result.containerCount)>1000000)throw new AppError(422,'CONTAINER_COUNT_LIMIT');}
 else if([input.crop,input.applicationMode,input.containerCount].some(v=>v!==undefined&&v!==null&&v!==''))throw new AppError(422,'FIELDS_NOT_ALLOWED_FOR_CATEGORY');
 if(!Array.isArray(input.items)||input.items.length<1||input.items.length>50)throw new AppError(422,'INVALID_REQUEST_ITEMS');
 const seen=new Set();result.items=input.items.map(item=>{
  object(item,['productId','unit','doseQuantity','quantity']);
  if(typeof item.productId!=='string'||!item.productId||item.productId.length>128||seen.has(item.productId))throw new AppError(422,'DUPLICATE_OR_INVALID_PRODUCT');seen.add(item.productId);
  const unit=cleanText(item.unit,true,50);
  if(agro){if(item.quantity!==undefined)throw new AppError(422,'TOTAL_IS_SERVER_CALCULATED');return {productId:item.productId,unit,doseQuantity:rules.normalize(item.doseQuantity)};}
  if(item.doseQuantity!==undefined&&item.doseQuantity!==null)throw new AppError(422,'DOSE_NOT_ALLOWED');return {productId:item.productId,unit,quantity:rules.normalize(item.quantity)};
 });return result;
}
function legacyMatches(existing,input){
 if(input.requestVersion!==undefined)return false;
 const canonical=items=>JSON.stringify(items.map(i=>({productId:i.productId,presentation:i.presentation,quantity:i.quantity,unit:i.unit})).sort((a,b)=>JSON.stringify(a).localeCompare(JSON.stringify(b))));
 return existing.requester===input.requester&&existing.destination===input.destination&&existing.notes===(input.notes||'')&&Array.isArray(input.items)&&canonical(existing.items)===canonical(input.items);
}
class RequestService{
 constructor(store){this.store=store;}
 async catalog(category){if(category&&!Object.hasOwn(rules.CATEGORIES,category))throw new AppError(422,'INVALID_CATEGORY');const {state}=await this.store.transact(tx=>tx.getInventory());return state.products.filter(p=>rules.eligible(p,category)&&availableProduct(state,p)).map(p=>({id:p.id,name:p.name,presentation:p.presentation,unit:p.unit,requestCategory:p.requestCategory,quantityBasis:p.quantityBasis,unitOptions:rules.unitOptions(p)}));}
 async register(input){
  if(!input||typeof input!=='object'||(typeof input.operationId!=='string'||!UUID.test(input.operationId))||typeof input.privateKey!=='string'||!/^[A-Za-z0-9_-]{32,128}$/.test(input.privateKey))throw new AppError(422,'PRIVATE_KEY_AND_OPERATION_REQUIRED');
  const operationId=input.operationId.toLowerCase();const code='JAP-'+digest(operationId).slice(0,20).toUpperCase();
  try{return await this.store.transact(async tx=>{
   // Serialize references with inventory administration; never write state or advance its version.
   const inventory=await tx.getInventory(true);const existing=await tx.findRequest(code)||(input.operationId!==operationId?await tx.findRequest('JAP-'+digest(input.operationId).slice(0,20).toUpperCase()):null);
   if(existing){
    if(!equal(existing.privateKeyHash,digest(input.privateKey)))throw new AppError(409,'IDEMPOTENCY_CONFLICT');
    if(existing.requestVersion!==2){if(!legacyMatches(existing,input))throw new AppError(409,'IDEMPOTENCY_CONFLICT');return publicRequest(existing);}
    const normalized=normalizeInput(input);if(existing.operationId.toLowerCase()!==operationId||!equal(existing.payloadHash,digest(JSON.stringify(normalized))))throw new AppError(409,'IDEMPOTENCY_CONFLICT');return publicRequest(existing);
   }
   const normalized=normalizeInput(input);
   const items=normalized.items.map((item,index)=>{
    const product=inventory.state.products.find(p=>p.id===item.productId);if(!product||(!rules.eligible(product,normalized.category)||!availableProduct(inventory.state,product)))throw new AppError(422,'PRODUCT_NOT_AVAILABLE_IN_CATEGORY');
    const calculation=rules.calculateLine({...item,category:normalized.category,containerCount:normalized.containerCount,product});
    return {id:crypto.randomUUID(),lineNumber:index+1,productId:product.id,productSnapshot:{name:product.name,unit:product.unit,presentation:product.presentation,requestCategory:product.requestCategory,quantityBasis:product.quantityBasis},presentation:product.presentation,unit:item.unit,...calculation};
   });
   const request={id:crypto.randomUUID(),code,privateKeyHash:digest(input.privateKey),...normalized,items,operationId,payloadHash:digest(JSON.stringify(normalized)),status:'PENDIENTE',createdAt:new Date().toISOString()};
   await tx.putRequest(request);await tx.audit({action:'REQUEST_PUBLIC_CREATE',entityId:request.id,details:{requestVersion:2,category:request.category,itemCount:items.length}});return publicRequest(request);
  });}catch(error){if(error.name==='RequestValidationError')throw new AppError(422,error.message);throw error;}
 }
 async lookup(code,key){if(typeof code!=='string'||code.length>40||typeof key!=='string'||key.length>128)throw new AppError(404,'REQUEST_NOT_FOUND');return this.store.transact(async tx=>{const request=await tx.findRequest(code.trim().toUpperCase(),'share');if(!request||!equal(request.privateKeyHash,digest(key)))throw new AppError(404,'REQUEST_NOT_FOUND');const summary=require('./dispatch-service').progress(request,await tx.delivered(request.id));const result=publicRequest(request);if(summary.items.some(i=>i.deliveredQuantity!=='0'))result.status=summary.status;result.items=result.items.map((i,index)=>({...i,deliveredQuantity:summary.items[index].deliveredQuantity,pendingQuantity:summary.items[index].pendingQuantity}));return result;});}

}
module.exports={RequestService,publicRequest,normalizeInput};
