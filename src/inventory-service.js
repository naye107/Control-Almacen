'use strict';
const { isDeepStrictEqual } = require('node:util');
const { AppError } = require('./errors');
const rules = require('../shared/inventory-rules');
const Accounting = require('../shared/inventory-accounting');
const fail = code => { throw new AppError(422, code); };
const EPS = 1e-6;
const KEYS = {
 products: ['id','name','activeIngredient','category','requestCategory','presentation','unit','quantityBasis','openingStock','minStock','active','expired','createdAt','openingExpiryDate','openingUnitPrice','openingCurrency','openingExchangeRate','openingDate'],
 purchases: ['id','productId','date','presentation','supplier','quantity','lot','doc','expiryDate','unitPrice','currency','exchangeRate'],
 outputs: ['id','productId','date','presentation','destination','quantity','allocations','usedQuantity','usedUnit','quantityMode','calculationMode','doseQuantity','doseUnit','doseContainerCount','doseContainerType','reason','responsible','dispatchId','dispatchItemId','dispatchCode']
};
function positive(value, zero = false) { if (typeof value !== 'number' || !Number.isFinite(value) || value > 1e12 || (zero ? value < 0 : value <= 0)) fail('INVALID_QUANTITY'); }
function text(value, required = false) { if ((required && (typeof value !== 'string' || !value.trim())) || (value !== undefined && (typeof value !== 'string' || value.length > 500))) fail('INVALID_TEXT'); }
function date(value) { if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value) || !Number.isFinite(Date.parse(value)) || new Date(value).toISOString().slice(0,10) !== value) fail('INVALID_DATE'); }
function same(a,b) { return isDeepStrictEqual(a,b); }
function totalQuantity(value,unit){positive(value,true);if(!/^\d+(?:\.\d{1,6})?$/.test(String(value)))fail('QUANTITY_PRECISION');if(unit==='unidad'&&!Number.isInteger(value))fail('WHOLE_UNITS_REQUIRED');}
function valuationFields(item,opening=false){
 const expiry=item[opening?'openingExpiryDate':'expiryDate'];if(expiry!==undefined&&expiry!==null&&expiry!=='')date(expiry);
 if(opening&&item.openingDate)date(item.openingDate);
 const price=item[opening?'openingUnitPrice':'unitPrice'],currency=item[opening?'openingCurrency':'currency'],rate=item[opening?'openingExchangeRate':'exchangeRate'];
 if(currency!==undefined&&!['PEN','USD'].includes(currency))fail('INVALID_CURRENCY');
 if(price!==undefined&&price!==null&&price!==''){if(typeof price!=='number'||!Number.isFinite(price)||price<0||price>1e9||!/^\d+(?:\.\d{1,6})?$/.test(String(price)))fail('INVALID_UNIT_PRICE');if(!currency)fail('INVALID_CURRENCY');if(currency==='USD'&&(typeof rate!=='number'||!Number.isFinite(rate)||rate<=0||rate>10000||!/^\d+(?:\.\d{1,6})?$/.test(String(rate))))fail('EXCHANGE_RATE_REQUIRED');}
 if(rate!==undefined&&rate!==null&&(typeof rate!=='number'||!Number.isFinite(rate)||rate<=0||rate>10000))fail('INVALID_EXCHANGE_RATE');
}
function validateChange(previous, proposed, linkedOutputs = [], requestProducts = [], generatedOutputs = []) {
 if (!proposed || typeof proposed !== 'object' || Object.keys(proposed).some(k=>!Object.hasOwn(KEYS,k))) fail('INVALID_STATE');
 const next = structuredClone(proposed);
 const diff = [];
 for (const [collection, allowed] of Object.entries(KEYS)) {
  if (!Array.isArray(next[collection]) || next[collection].length > 100000) fail('INVALID_STATE');
  const old = new Map(previous[collection].map(item=>[item.id,item]));
  const seen = new Set();
  for (let index=0; index<next[collection].length; index++) {
   let item = next[collection][index];
   if (!item || typeof item !== 'object' || Array.isArray(item) || typeof item.id !== 'string' || !item.id || item.id.length>128 || seen.has(item.id)) fail('DUPLICATE_OR_INVALID_ID');
   seen.add(item.id);
   const before = old.get(item.id);
   // Accept legacy label normalization from old browsers, but preserve the original stored unit.
   if (collection==='products' && before?.unit==='bidones' && item.unit==='galones') { item.unit='bidones'; }
   if (same(before,item)) continue;
   if (before && linkedOutputs.includes(item.id) && collection==='outputs') fail('DISPATCH_OUTPUT_IMMUTABLE');
   for (const key of Object.keys(item)) if (!allowed.includes(key) && !same(before?.[key],item[key])) fail('UNKNOWN_FIELD');
   // Preserve legacy extension fields omitted by a browser.
   if (before) item = next[collection][index] = { ...before, ...item };
   diff.push({collection,id:item.id,before:before||null,after:item});
   if (collection==='products') {
    valuationFields(item,true);
    if(before&&before.expired!==item.expired)fail('EXPIRY_IS_AUTOMATIC');
    if(!before||rules.isTotalProduct(before)||rules.isTotalProduct(item)){
     if(!rules.isTotalProduct(item)||!Object.hasOwn(rules.TOTAL_UNITS,item.unit))fail('TOTAL_UNIT_REQUIRED');
     if(before&&!rules.isTotalProduct(before))fail('RESET_REQUIRED_FOR_TOTAL_UNITS');
     if(item.presentation!==rules.totalPresentation(item.unit))fail('TOTAL_PRESENTATION_NOT_EDITABLE');
     totalQuantity(item.openingStock,item.unit);totalQuantity(item.minStock,item.unit);
    }
    for (const key of ['name','category','presentation','unit']) text(item[key],true);
    text(item.activeIngredient);
    if(item.requestCategory!==undefined && !['','AGROQUIMICOS','HERRAMIENTAS','OTROS'].includes(item.requestCategory)) fail('INVALID_REQUEST_CATEGORY');
    positive(item.openingStock,true); positive(item.minStock,true);
    for (const key of ['active','expired']) if (item[key]!==undefined && typeof item[key]!=='boolean') fail('INVALID_PRODUCT_FLAG');
    const used = previous.purchases.some(x=>x.productId===item.id) || previous.outputs.some(x=>x.productId===item.id) || requestProducts.includes(item.id);
    if (before && used && (before.presentation!==item.presentation || before.unit!==item.unit)) fail('HISTORICAL_UNIT_OR_PRESENTATION_IMMUTABLE');
   } else {
    const product = next.products.find(p=>p.id===item.productId);
    if (!product) fail('PRODUCT_NOT_FOUND');
    if(rules.isTotalProduct(product)){
     if(item.presentation!==rules.totalPresentation(product.unit))fail('TOTAL_PRESENTATION_NOT_EDITABLE');
     totalQuantity(item.quantity,product.unit);
     if(item.allocations?.some(a=>a.presentation!==product.presentation))fail('TOTAL_PRESENTATION_NOT_EDITABLE');
     if(item.usedUnit!==undefined&&item.usedUnit!==product.unit)fail('INCOMPATIBLE_UNIT');
    }
    date(item.date); positive(item.quantity); text(item.presentation);
    if (collection==='purchases') { valuationFields(item);text(item.supplier,true); text(item.lot); text(item.doc); }
    else {
     if ((item.dispatchId||item.dispatchItemId||item.dispatchCode||item.allocations?.some(a=>a.exactQuantity))&&!generatedOutputs.includes(item.id)) fail('DISPATCH_OUTPUT_SERVER_ONLY');
     if (product.active===false || Accounting.isLegacyExpired(product)) fail('PRODUCT_NOT_AVAILABLE');
     const withoutThis={...next,outputs:next.outputs.filter(o=>o.id!==item.id)};
     if(!Accounting.canIssue(withoutThis,product,item.quantity)||!Accounting.canIssue(withoutThis,product,item.quantity,item.date))fail('INSUFFICIENT_UNEXPIRED_STOCK');
     text(item.destination,true); text(item.reason,true); text(item.responsible);
     if (item.quantityMode!==undefined && !['units','physical'].includes(item.quantityMode)) fail('INVALID_QUANTITY_MODE');
     if (item.calculationMode!==undefined && !['dose','direct'].includes(item.calculationMode)) fail('INVALID_CALCULATION_MODE');
     if (item.usedQuantity!==undefined) positive(item.usedQuantity);
     if (item.usedUnit!==undefined) text(item.usedUnit,true);
     if (item.allocations!==undefined) {
      if (!Array.isArray(item.allocations) || !item.allocations.length || item.allocations.length>1000) fail('INVALID_ALLOCATIONS');
      for(const allocation of item.allocations) { if(!allocation || Object.keys(allocation).some(k=>!['presentation','quantity','exactQuantity'].includes(k))) fail('INVALID_ALLOCATIONS'); positive(allocation.quantity); text(allocation.presentation,true); }
      if (Math.abs(item.allocations.reduce((sum,a)=>sum+a.quantity,0)-item.quantity)>EPS) fail('ALLOCATION_QUANTITY_MISMATCH');
     }
     if (item.calculationMode==='dose') {
      positive(item.usedQuantity); text(item.usedUnit,true);
      positive(item.doseQuantity); positive(item.doseContainerCount);
      if(!['cilindros','tanques'].includes(item.doseContainerType) || Math.abs(item.doseQuantity*item.doseContainerCount-item.usedQuantity)>EPS || item.doseUnit!==item.usedUnit) fail('INVALID_DOSE');
     }
     if (item.quantityMode==='physical') {
      positive(item.usedQuantity); text(item.usedUnit,true);
      const conversion = rules.getOutputQuantityConversion(product,item.presentation,item.usedQuantity,`physical:${item.usedUnit}`);
      if (!conversion || !item.allocations?.length) fail('INVALID_CONVERSION');
      let total = 0;
      for(const a of item.allocations) { const info=rules.getPresentationInfo(a.presentation); if(info.group!==conversion.physicalGroup || (info.group==='units' && info.unit!==conversion.usedUnit) || info.baseValue===null || info.baseValue<=0) fail('INCOMPATIBLE_PRESENTATION'); total+=info.baseValue*a.quantity; }
      if(Math.abs(total-conversion.baseQuantity)>EPS*Math.max(1,conversion.baseQuantity)) fail('PHYSICAL_QUANTITY_MISMATCH');
     } else if (item.usedQuantity!==undefined && (Math.abs(item.usedQuantity-item.quantity)>EPS || item.usedUnit!==product.unit && !(product.unit==='bidones' && item.usedUnit==='galones'))) fail('UNIT_QUANTITY_MISMATCH');
    }
   }
  }
  for(const before of old.values()) if(!seen.has(before.id)) {
   if(collection==='outputs' && linkedOutputs.includes(before.id)) fail('DISPATCH_OUTPUT_IMMUTABLE');
   diff.push({collection,id:before.id,before,after:null});
   if(collection==='products' && requestProducts.includes(before.id)) fail('PRODUCT_HAS_REQUESTS');
   if(collection==='products' && (previous.purchases.some(x=>x.productId===before.id)||previous.outputs.some(x=>x.productId===before.id))) fail('PRODUCT_HAS_HISTORY');
  }
 }
 // For any changed product, reject new/worsened shortages per presentation, while tolerating untouched historical deficits.
 const affected = new Set(diff.flatMap(d=>d.collection==='products'?[d.id]:[d.before?.productId,d.after?.productId]).filter(Boolean));
 for(const id of affected) {
  const product = next.products.find(p=>p.id===id); if(!product) continue;
  const oldProduct = previous.products.find(p=>p.id===id);
  const old = new Map(oldProduct ? rules.getPresentationBreakdown(previous,oldProduct).map(b=>[b.key,b.stock]) : []);
  for(const bucket of rules.getPresentationBreakdown(next,product)) if(!Number.isFinite(bucket.stock) || bucket.stock < Math.min(0,old.get(bucket.key)||0)-EPS) fail('INSUFFICIENT_STOCK');
 }
 // Removing a product must never leave references, even in a bulk payload.
 for(const item of [...next.purchases,...next.outputs]) if(!next.products.some(p=>p.id===item.productId) && !previous.purchases.some(p=>same(p,item)) && !previous.outputs.some(p=>same(p,item))) fail('PRODUCT_NOT_FOUND');
 try { require('./stock-service').assertNoWorse(previous,next,affected); } catch(error) { if(error.name==='DispatchValidationError')fail(error.message);throw error; }
 return { state: { ...structuredClone(previous), ...next }, changes: diff };
}
module.exports = { validateChange, positive, text, date };

