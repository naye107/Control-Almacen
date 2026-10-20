(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory(require('./dispatch-rules'));else root.InventoryAccounting=factory(root.DispatchRules);})(typeof globalThis!=='undefined'?globalThis:this,function(Q){
'use strict';
const today=()=>new Intl.DateTimeFormat('en-CA',{timeZone:'America/Lima',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date());
function validDate(s){return typeof s==='string'&&/^\d{4}-\d{2}-\d{2}$/.test(s)&&Number.isFinite(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;}
function expired(expiry,day=today()){return Boolean(expiry&&expiry<day);}
function isLegacyExpired(p){return p.expired===true&&!Object.hasOwn(p,'openingExpiryDate');}
function quantity(o){return Q.read(o.quantity||0);}
// Prices are optional for legacy stock. Null means unpriced, never zero cost.
function price(o,prefix=''){
 if(o.returnOfOutput&&Object.hasOwn(o,'returnCost'))return o.returnCost===null?null:Q.read(o.returnCost);
 const raw=o[prefix+'unitPrice'];if(raw===undefined||raw===null||raw==='')return null;
 const value=Q.read(raw),currency=o[prefix+'currency']||'PEN';
 if(currency==='PEN')return value;
 const rate=o[prefix+'exchangeRate'];return currency==='USD'&&rate?Q.mul(value,Q.read(rate)):null;
}
function openingPrice(p){return price({unitPrice:p.openingUnitPrice,currency:p.openingCurrency,exchangeRate:p.openingExchangeRate});}
function ledger(state,product,day=today()){
 const lots=[],purchases=new Map(),outputs=new Map();let qty=Q.zero,value=Q.zero,known=true,shortage=Q.zero;
 const stockDate=String(product.openingDate||'');
 function receive(id,amount,cost,expiry,date,lot){qty=Q.add(qty,amount);if(amount.n>0n){if(cost===null)known=false;else value=Q.add(value,Q.mul(amount,cost));lots.push({id,remaining:amount,expiry:expiry||'',date,lot:lot||'',unitPrice:cost});}}
 if(!stockDate||stockDate<=day)receive('opening:'+product.id,Q.read(product.openingStock||0),openingPrice(product),product.openingExpiryDate,stockDate,'Stock inicial');
 const order=e=>e.kind==='output'?e.index*2+1:e.x.returnOfOutput?e.x.returnSequence*2:-1;
 const events=[...state.purchases.filter(x=>x.productId===product.id).map((x,index)=>({x,kind:'purchase',index})),...state.outputs.map((x,index)=>({x,kind:'output',index})).filter(e=>e.x.productId===product.id)].filter(e=>e.x.date<=day).sort((a,b)=>a.x.date.localeCompare(b.x.date)||order(a)-order(b)||a.index-b.index);
 for(const {x,kind} of events){const amount=quantity(x);
  if(kind==='purchase'){const cost=price(x);purchases.set(x.id,{unitPrice:cost,total:cost===null?null:Q.mul(amount,cost)});receive(x.id,amount,cost,x.expiryDate,x.date,x.lot);continue;}
  const average=known&&qty.n>0n?Q.div(value,qty):null,total=average===null?null:Q.mul(amount,average);outputs.set(x.id,{unitPrice:average,total});
  let remaining=amount;const consumed=[];
  // Earliest expiry first; undated stock last. Existing historical issues remain
  // represented rather than silently removing quantities from the stock ledger.
  const candidates=lots.filter(l=>l.remaining.n>0n).sort((a,b)=>Number(expired(a.expiry,x.date))-Number(expired(b.expiry,x.date))||(a.expiry||'9999').localeCompare(b.expiry||'9999')||a.date.localeCompare(b.date)||a.id.localeCompare(b.id));
  for(const l of candidates){const used=Q.min(l.remaining,remaining);if(used.n)consumed.push({id:l.id,quantity:used,expiry:l.expiry,lot:l.lot});l.remaining=Q.sub(l.remaining,used);remaining=Q.sub(remaining,used);if(!remaining.n)break;}
  outputs.get(x.id).lots=consumed;
  shortage=Q.add(shortage,remaining);qty=Q.sub(qty,amount);if(total!==null)value=Q.sub(value,total);if(qty.n===0n){value=Q.zero;known=true;}if(qty.n<0n)known=false;
 }
 let usable=Q.zero,expiredQty=Q.zero,undated=Q.zero;const remainingLots=lots.filter(l=>l.remaining.n>0n);
 for(const l of remainingLots){if(expired(l.expiry,day))expiredQty=Q.add(expiredQty,l.remaining);else usable=Q.add(usable,l.remaining);if(!l.expiry)undated=Q.add(undated,l.remaining);}
 const status=expiredQty.n>0n?(usable.n>0n?'Parcialmente vencido':'Vencido'):'';
 return {quantity:qty,value:known?value:null,average:known&&qty.n>0n?Q.div(value,qty):null,priced:known,usable,expired:expiredQty,undated,status,lots:remainingLots,purchases,outputs,shortage};
}
function number(q){return Q.number(q);}
function money(q){if(q===null||q===undefined)return null;const scale=100n,sign=q.n<0n?-1n:1n,n=q.n*sign;const cents=(n*scale*2n/q.d+1n)/2n;return (sign<0n?'-':'')+(cents/scale).toString()+'.'+(cents%scale).toString().padStart(2,'0');}
function canIssue(state,product,amount,date=today()){
 const result=ledger(state,product,date);
 return product.active!==false&&!isLegacyExpired(product)&&Q.cmp(Q.read(amount),result.usable)<=0;
}
return {today,validDate,expired,isLegacyExpired,price,openingPrice,ledger,number,money,canIssue};
});
