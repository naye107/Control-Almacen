'use strict';
const crypto=require('node:crypto');
const {AppError}=require('./errors');
const Q=require('../shared/dispatch-rules');
function expectedVersion(value){
 if(typeof value!=='string'||!/^\d{1,20}$/.test(value))throw new AppError(428,'REVISION_REQUIRED');
 const n=BigInt(value);if(n<1n||n>9223372036854775806n)throw new AppError(428,'REVISION_REQUIRED');
 // Existing API accepts leading zeros. Canonicalize exactly with BigInt, never Number.
 return n.toString();
}
function finiteTree(value){
 if(typeof value==='number'&&!Number.isFinite(value))throw new AppError(422,'INVALID_QUANTITY');
 if(Array.isArray(value))for(const v of value)finiteTree(v);
 else if(value&&typeof value==='object')for(const v of Object.values(value))finiteTree(v);
}
function verifyDocument(doc){
 if(!doc||!Buffer.isBuffer(doc.pdf)||!doc.pdf.length||doc.pdf.length>5242880||
    crypto.createHash('sha256').update(doc.pdf).digest('hex')!==doc.sha256)
  throw new AppError(503,'DOCUMENT_INTEGRITY_ERROR');
 return doc;
}
function validateMovement(state,product,item,detail,output){
 const Stock=require('./stock-service'),R=require('../shared/inventory-rules');
 const context=Stock.context(product,item),quantity=Q.quantity(detail.quantity),base=Q.quantity(detail.baseQuantity);
 if(detail.unit!==item.unit||detail.baseUnit!==context.option.baseUnit||
    Q.cmp(base,Q.mul(quantity,Q.read(context.option.factor)))!==0||
    output.productId!==product.id||output.id!==detail.outputId||output.dispatchItemId!==detail.id||
    output.usedUnit!==item.unit||Q.cmp(Q.read(output.usedQuantity),quantity)!==0||
    JSON.stringify(output.allocations)!==JSON.stringify(detail.allocations)||
    output.quantityMode!==(context.option.dimension.startsWith('packages:')?'units':'physical')||
    !Number.isFinite(output.quantity)||output.quantity!==detail.allocations.reduce((sum,a)=>sum+a.quantity,0))throw new AppError(422,'DISPATCH_QUANTITY_MISMATCH');
 let total=Q.zero;const facts=[];
 for(const a of detail.allocations){
  const exact=a.exactQuantity;
  if(!exact||typeof exact.n!=='string'||typeof exact.d!=='string'||!/^\d{1,40}$/.test(exact.n)||! /^[1-9]\d{0,39}$/.test(exact.d))throw new AppError(422,'INVALID_ALLOCATION');
  const packages=Q.read(exact),info=R.getPresentationInfo(a.presentation);
  const capacity=context.option.dimension.startsWith('packages:')?Q.read('1'):Q.read(info.baseValue);
  if(!packages.n||!capacity.n||!Number.isFinite(a.quantity)||a.quantity<=0||a.quantity!==Q.number(packages)||
     (context.option.dimension.startsWith('packages:')&&info.key!==R.getPresentationInfo(item.presentation).key)||
     (!context.option.dimension.startsWith('packages:')&&info.group!==context.option.dimension&&!(info.group==='units'&&info.unit===context.option.dimension)))throw new AppError(422,'INCOMPATIBLE_UNIT');
  total=Q.add(total,Q.mul(packages,capacity));
  facts.push({numerator:packages.n.toString(),denominator:packages.d.toString(),capacity:Q.decimal(capacity,6,true)});
 }
 if(Q.cmp(total,base)!==0)throw new AppError(422,'DISPATCH_QUANTITY_MISMATCH');
 const matches=state.outputs.filter(o=>o.id===output.id||o.dispatchItemId===detail.id);
 if(matches.length!==1)throw new AppError(422,'DISPATCH_MOVEMENT_DUPLICATE');
 return facts;
}
module.exports={expectedVersion,finiteTree,verifyDocument,validateMovement};
