(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./inventory-rules'));else root.RequestRules=factory(root.InventoryRules);})(typeof globalThis!=='undefined'?globalThis:this,function(inventory){
'use strict';
const CATEGORIES=Object.freeze({AGROQUIMICOS:'Agroquímicos',HERRAMIENTAS:'Herramientas',OTROS:'Otros productos'});
const SCALE=1000000n, MAX=99999999999999999999n;
function fail(code){const error=new Error(code);error.name='RequestValidationError';throw error;}
function scaled(value,allowZero=false){
 if(typeof value!=='string'&&typeof value!=='number')fail('INVALID_DECIMAL');
 const text=String(value).trim().replace(',','.');
 if(!/^\d{1,14}(?:\.\d{1,6})?$/.test(text))fail('INVALID_DECIMAL');
 const [integer,fraction='']=text.split('.');const result=BigInt(integer)*SCALE+BigInt(fraction.padEnd(6,'0'));
 if(result>MAX||(!allowZero&&result<=0n))fail('INVALID_QUANTITY');return result;
}
function decimal(value){const whole=value/SCALE;const fraction=(value%SCALE).toString().padStart(6,'0').replace(/0+$/,'');return whole.toString()+(fraction?'.'+fraction:'');}
function normalize(value){return decimal(scaled(value));}
function multiply(a,b){const result=scaled(a)*scaled(b);if(result%SCALE!==0n)fail('QUANTITY_PRECISION');const value=result/SCALE;if(value>MAX)fail('QUANTITY_TOO_LARGE');return decimal(value);}
function unitOptions(product){
 if(inventory.isTotalProduct(product)){
  inventory.totalPresentation(product.unit);
  const dimension=product.unit==='kg'?'weight':product.unit==='L'?'volume':'packages:unidad';
  return [{unit:product.unit,label:product.unit,dimension,baseUnit:product.unit==='kg'?'g':product.unit==='L'?'ml':'unidad',factor:product.unit==='unidad'?'1':'1000'}];
 }
 if(product.requestCategory==='HERRAMIENTAS')return [{unit:product.unit,label:product.unit,dimension:'packages:'+product.unit,baseUnit:product.unit,factor:'1'}];
 const info=inventory.getPresentationInfo(product.presentation);
 const options=(inventory.getPhysicalUnitOptions(info)||[]).map(u=>({unit:u.unit,label:u.label,dimension:info.group==='units'?u.unit:info.group,baseUnit:info.group==='weight'?'g':info.group==='volume'?'ml':u.unit,factor:String(u.baseFactor)}));
 // A product's unit is a count of its presentation in the legacy inventory. Avoid ambiguous duplicate labels.
 if(!options.some(o=>o.unit===product.unit||o.label===product.unit))options.push({unit:product.unit,label:product.unit,dimension:'packages:'+product.unit,baseUnit:product.unit,factor:'1'});
 return options;
}
function convert(quantity,unit,product){const option=unitOptions(product).find(o=>o.unit===unit);if(!option)fail('INCOMPATIBLE_UNIT');if(inventory.isTotalProduct(product)&&unit==='unidad'&&scaled(quantity)%SCALE!==0n)fail('WHOLE_UNITS_REQUIRED');return {baseQuantity:multiply(quantity,option.factor),baseUnit:option.baseUnit,dimension:option.dimension};}
function calculateLine({category,containerCount,product,doseQuantity,quantity,unit}){
 if(!Object.hasOwn(CATEGORIES,category))fail('INVALID_CATEGORY');
 const total=category==='AGROQUIMICOS'?multiply(doseQuantity,containerCount):normalize(quantity);
 const converted=convert(total,unit,product);return {quantity:total,doseQuantity:category==='AGROQUIMICOS'?normalize(doseQuantity):null,...converted};
}
function eligible(product,category){return product.active===true&&product.expired!==true&&Object.hasOwn(CATEGORIES,product.requestCategory)&&(!category||product.requestCategory===category);}
return {CATEGORIES,normalize,multiply,convert,calculateLine,unitOptions,eligible};
});
