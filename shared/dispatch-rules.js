(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.DispatchRules=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
function fail(code){const e=new Error(code);e.name='DispatchValidationError';throw e;}
function gcd(a,b){a=a<0n?-a:a;while(b){const r=a%b;a=b;b=r;}return a||1n;}
function q(n,d=1n){n=BigInt(n);d=BigInt(d);if(!d)fail('INVALID_DECIMAL');if(d<0n){n=-n;d=-d;}const g=gcd(n,d);return {n:n/g,d:d/g};}
function read(value){if(value&&typeof value==='object'&&Object.hasOwn(value,'n'))return q(value.n,value.d);const s=String(value).trim().replace(',','.');if(s.length>120||!/^[-+]?\d+(?:\.\d+)?(?:e[-+]?\d+)?$/i.test(s))fail('INVALID_DECIMAL');const [mantissa,exponent='0']=s.toLowerCase().split('e');const e=Number(exponent);if(Math.abs(e)>40)fail('INVALID_DECIMAL');const negative=mantissa.startsWith('-');const parts=mantissa.replace(/^[-+]/,'').split('.');const fraction=parts[1]||'';let n=BigInt(parts[0]+fraction)*(negative?-1n:1n),d=10n**BigInt(fraction.length);if(e>=0)n*=10n**BigInt(e);else d*=10n**BigInt(-e);return q(n,d);}
const add=(a,b)=>q(a.n*b.d+b.n*a.d,a.d*b.d),sub=(a,b)=>q(a.n*b.d-b.n*a.d,a.d*b.d),mul=(a,b)=>q(a.n*b.n,a.d*b.d),div=(a,b)=>q(a.n*b.d,a.d*b.n),cmp=(a,b)=>a.n*b.d<b.n*a.d?-1:a.n*b.d>b.n*a.d?1:0;
const zero=q(0),min=(a,b)=>cmp(a,b)<=0?a:b,max=(a,b)=>cmp(a,b)>=0?a:b;
function decimal(a,places=6,exact=false){const scale=10n**BigInt(places);if(exact&&a.n*scale%a.d)fail('QUANTITY_PRECISION');const v=a.n*scale/a.d,negative=v<0n,x=negative?-v:v;const tail=(x%scale).toString().padStart(places,'0').replace(/0+$/,'');return (negative?'-':'')+(x/scale).toString()+(tail?'.'+tail:'');}
function quantity(value,allowZero=false){if(typeof value!=='string'&&typeof value!=='number')fail('INVALID_QUANTITY');const s=String(value).trim().replace(',','.');if(!/^\d{1,14}(?:\.\d{1,6})?$/.test(s))fail('INVALID_QUANTITY');const a=read(s);if(cmp(a,zero)<0||(!allowZero&&!a.n))fail('INVALID_QUANTITY');return a;}
const json=a=>({n:a.n.toString(),d:a.d.toString()}),number=a=>Number(a.n)/Number(a.d);
return {q,read,add,sub,mul,div,cmp,min,max,zero,decimal,quantity,json,number,fail};
});