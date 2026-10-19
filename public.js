'use strict';
const $=selector=>document.querySelector(selector);
const form=$('#public-request');
let catalog=[],category='AGROQUIMICOS',categoryDrafts={},reviewPayload=null,attempt=null,receipt=null,sending=false,catalogReady=false;
const storage={get(key){try{return JSON.parse(sessionStorage.getItem(key)||'null');}catch{return null;}},set(key,value){try{if(value===null)sessionStorage.removeItem(key);else sessionStorage.setItem(key,JSON.stringify(value));}catch{const warning=$('#storage-warning');warning.hidden=false;warning.textContent='No se pudo guardar una copia en este navegador. Mantén esta página abierta y guarda la copia pendiente o el comprobante al finalizar.';}}};
const messages={INTERNAL_ERROR:'No se pudo confirmar el registro. Conservamos tu solicitud para reintentar.',INVALID_REQUEST_FIELDS:'Revisa los campos de la solicitud.',FIELDS_NOT_ALLOWED_FOR_CATEGORY:'La categoría seleccionada no admite campos de aplicación.',TOTAL_IS_SERVER_CALCULATED:'El total se calcula automáticamente. Revisa la dosis.',DOSE_NOT_ALLOWED:'Esta categoría utiliza cantidades directas.',INVALID_CATEGORY:'Selecciona una categoría válida.',PRODUCT_NOT_AVAILABLE_IN_CATEGORY:'Uno de los productos ya no está disponible en esta categoría. Revisa el catálogo.',INCOMPATIBLE_UNIT:'La unidad no es compatible con el producto.',INVALID_DECIMAL:'Introduce un número válido, con hasta seis decimales.',INVALID_QUANTITY:'La dosis o cantidad debe ser mayor que cero.',QUANTITY_PRECISION:'El cálculo requiere más de seis decimales. Ajusta la dosis o la cantidad de recipientes.',QUANTITY_TOO_LARGE:'La cantidad calculada supera el límite permitido.',INVALID_APPLICATION_MODE:'Selecciona cilindros o tanques.',CONTAINER_COUNT_LIMIT:'La cantidad de recipientes es demasiado grande.',INVALID_REQUEST_TEXT:'Completa los datos generales y respeta la longitud permitida.',DUPLICATE_OR_INVALID_PRODUCT:'Selecciona cada producto una sola vez.',INVALID_REQUEST_ITEMS:'Añade entre 1 y 50 productos.',RATE_LIMIT:'Hay muchos intentos. Espera un minuto antes de reintentar.',IDEMPOTENCY_CONFLICT:'Este intento ya corresponde a una solicitud diferente. Conserva la copia pendiente y consulta su comprobante.',REQUEST_VERSION_REQUIRED:'Esta copia corresponde al formulario anterior. Conserva sus datos para registrar una solicitud nueva.'};
function friendly(error){return messages[error.message]||error.message||'No se pudo completar la operación.';}
function errorAt(id,message){const el=$(id);el.hidden=!message;el.textContent=message||'';if(message)el.scrollIntoView({block:'nearest',behavior:'smooth'});}
function notice(message){$('#catalog-message').hidden=!message;$('#catalog-message').textContent=message;}
function screen(name){document.querySelectorAll('.public-screen').forEach(el=>el.hidden=el.id!=='screen-'+name);window.scrollTo({top:0,behavior:'instant'});const title=$('#screen-'+name+' h1');if(title){title.tabIndex=-1;title.focus({preventScroll:true});}}
function uuid(){if(crypto.randomUUID)return crypto.randomUUID();const b=crypto.getRandomValues(new Uint8Array(16));b[6]=(b[6]&15)|64;b[8]=(b[8]&63)|128;const h=Array.from(b,x=>x.toString(16).padStart(2,'0')).join('');return h.slice(0,8)+'-'+h.slice(8,12)+'-'+h.slice(12,16)+'-'+h.slice(16,20)+'-'+h.slice(20);}
function privateKey(){return Array.from(crypto.getRandomValues(new Uint8Array(32)),b=>b.toString(16).padStart(2,'0')).join('');}
function localDate(value){return new Intl.DateTimeFormat('es-PE',{dateStyle:'long',timeStyle:'short',timeZone:'America/Lima'}).format(new Date(value));}
function statusLabel(value){return {PENDIENTE:'Pendiente',APROBADA:'Aprobada (registro histórico)',PARCIALMENTE_DESPACHADA:'Parcialmente despachada',DESPACHADA:'Despachada',CANCELADA:'Cancelada',RECHAZADA:'Rechazada'}[value]||value;}
function lines(){return [...document.querySelectorAll('.request-line')];}
function readLines(){return lines().map(row=>({productId:row.querySelector('.line-product').value,unit:row.querySelector('.line-unit').value,value:row.querySelector('.line-value').value}));}
function saveDraft(){storage.set('japurima.public.draft.v2',{category,requester:form.elements.requester.value,destination:form.elements.destination.value,notes:form.elements.notes.value,crop:form.elements.crop.value,applicationMode:form.elements.applicationMode.value,containerCount:form.elements.containerCount.value,items:readLines(),categoryDrafts});}
function productOptions(row,selected=''){
 const select=row.querySelector('.line-product');const search=$('#product-search').value.trim().toLocaleLowerCase('es');const used=new Set(readLines().filter(i=>i.productId&&i.productId!==selected).map(i=>i.productId));
 select.replaceChildren();const empty=document.createElement('option');empty.value='';empty.textContent='Selecciona un producto';select.append(empty);
 for(const p of catalog.filter(p=>p.requestCategory===category&&(p.id===selected||!used.has(p.id)&&(!search||(p.name+' '+p.presentation).toLocaleLowerCase('es').includes(search))))){const option=document.createElement('option');option.value=p.id;option.textContent=p.name+' · '+(p.quantityBasis==='TOTAL'?p.unit:p.presentation);select.append(option);}select.value=selected;
}
function updateUnits(row,preferred){const product=catalog.find(p=>p.id===row.querySelector('.line-product').value);const select=row.querySelector('.line-unit');select.replaceChildren();for(const option of product?.unitOptions||[]){const el=document.createElement('option');el.value=option.unit;el.textContent=option.label;select.append(el);}if(preferred&&[...select.options].some(o=>o.value===preferred))select.value=preferred;row.querySelector('.line-presentation').textContent=product?(product.quantityBasis==='TOTAL'?'Unidad: '+product.unit:'Presentación: '+product.presentation):'';}
function updateTotals(){
 const agro=category==='AGROQUIMICOS';const mode=form.elements.applicationMode.value;const count=form.elements.containerCount.value;const noun=mode==='TANQUES'?'tanque':'cilindro';
 $('#container-label').textContent='Cantidad general de '+(mode==='TANQUES'?'tanques':'cilindros');
 for(const row of lines()){
  row.querySelector('.line-value-label').textContent=agro?'Dosis por '+noun:'Cantidad requerida';row.querySelector('.line-total-label').textContent=agro?'Total solicitado':'Cantidad solicitada';
  const product=catalog.find(p=>p.id===row.querySelector('.line-product').value);
  try{if(!product)throw new Error('No product');const value=row.querySelector('.line-value').value;const unit=row.querySelector('.line-unit').value;const result=RequestRules.calculateLine({category,containerCount:count,product,unit,doseQuantity:value,quantity:value});row.querySelector('.line-total-value').textContent=result.quantity+' '+unit;}catch{row.querySelector('.line-total-value').textContent='—';}
 }
 const countSelected=readLines().filter(i=>i.productId).length;$('#summary-count').textContent=String(countSelected);$('#summary-category').textContent=RequestRules.CATEGORIES[category];$('#summary-mode').textContent=agro?(mode==='TANQUES'?'Por tanques':'Por cilindros')+' · '+count+' recipientes':'Cantidad directa por producto';
}
function addLine(item={}){
 if(lines().length>=50){errorAt('#form-error','Puedes incluir hasta 50 productos.');return;}
 const row=document.createElement('div');row.className='request-line';
 row.innerHTML='<div class="line-heading"><span class="line-index"></span><button type="button" class="remove-line">Quitar</button></div><div class="line-controls"><label class="line-product-field">Producto<select class="line-product" required></select></label><label><span class="line-value-label">Dosis</span><input class="line-value" inputmode="decimal" maxlength="21" required placeholder="0,00"></label><label>Unidad<select class="line-unit" required></select></label><div class="line-total"><span class="line-total-label">Total solicitado</span><strong class="line-total-value">—</strong></div></div><div class="line-presentation"></div>';
 $('#request-lines').append(row);productOptions(row,item.productId||'');updateUnits(row,item.unit);row.querySelector('.line-value').value=item.value||'';
 row.querySelector('.line-product').addEventListener('change',()=>{updateUnits(row);refreshOptions();updateTotals();saveDraft();});
 row.querySelector('.remove-line').addEventListener('click',()=>{if(lines().length===1){row.querySelector('.line-product').value='';row.querySelector('.line-value').value='';updateUnits(row);}else row.remove();refreshOptions();renumber();updateTotals();saveDraft();});renumber();updateTotals();
}
function renumber(){lines().forEach((row,i)=>{row.querySelector('.line-index').textContent='PRODUCTO '+String(i+1).padStart(2,'0');row.querySelector('.line-product').setAttribute('aria-label','Producto '+(i+1));});}
function refreshOptions(){for(const row of lines()){const current=row.querySelector('.line-product').value;productOptions(row,current);}}
function changeCategory(next,restored){
 if(!restored)categoryDrafts[category]=readLines();category=next;const agro=category==='AGROQUIMICOS';
 $('#crop-field').hidden=!agro;form.elements.crop.required=agro;$('#application-section').hidden=!agro;form.elements.containerCount.required=agro;
 $('#destination-field').childNodes[0].textContent=agro?'Lugar de aplicación':'Lugar de destino';$('#products-step').textContent=agro?'04':'03';$('#products-help').textContent=agro?'Ingresa la dosis de cada producto. Calculamos su total según la cantidad general de recipientes.':'Elige los productos y la cantidad que necesitas de cada uno.';
 $('#product-search').value='';$('#request-lines').replaceChildren();const saved=restored||categoryDrafts[next]||[{}];for(const item of saved)addLine(item);if(!saved.length)addLine();updateTotals();
}
function payload(){
 const agro=category==='AGROQUIMICOS';const result={requestVersion:2,category,requester:form.elements.requester.value.trim(),destination:form.elements.destination.value.trim(),notes:form.elements.notes.value.trim(),items:[]};
 if(!result.requester||!result.destination)throw new Error('Completa tu nombre y el lugar de destino o aplicación.');
 if(agro){result.crop=form.elements.crop.value.trim();if(!result.crop)throw new Error('Indica el cultivo.');result.applicationMode=form.elements.applicationMode.value;result.containerCount=RequestRules.normalize(form.elements.containerCount.value);if(Number(result.containerCount)>1000000)throw new Error('CONTAINER_COUNT_LIMIT');}
 const seen=new Set();for(const line of readLines()){
  const product=catalog.find(p=>p.id===line.productId&&p.requestCategory===category);if(!product)throw new Error('Selecciona un producto en cada línea.');if(seen.has(product.id))throw new Error('DUPLICATE_OR_INVALID_PRODUCT');seen.add(product.id);
  const calculation=RequestRules.calculateLine({category,product,containerCount:result.containerCount,unit:line.unit,doseQuantity:line.value,quantity:line.value});
  result.items.push(agro?{productId:product.id,unit:line.unit,doseQuantity:calculation.doseQuantity}:{productId:product.id,unit:line.unit,quantity:calculation.quantity});
 }return result;
}
function detailsElement(data){
 const card=document.createElement('div');card.className='review-card';const dl=document.createElement('dl');
 const pairs=[['Categoría',RequestRules.CATEGORIES[data.category]||'Solicitud anterior'],['Solicitante',data.requester],['Lugar',data.destination]];if(data.crop)pairs.push(['Cultivo',data.crop]);if(data.applicationMode)pairs.push(['Modalidad',(data.applicationMode==='TANQUES'?'Tanques':'Cilindros')+' · '+data.containerCount]);if(data.notes)pairs.push(['Observaciones',data.notes]);
 for(const [key,value] of pairs){if(!value)continue;const field=document.createElement('div');const dt=document.createElement('dt');dt.textContent=key;const dd=document.createElement('dd');dd.textContent=value;field.append(dt,dd);dl.append(field);}card.append(dl);return card;
}
function renderProductLines(container,data,stored=false){
 container.replaceChildren();for(const item of data.items){const product=stored?{name:item.product,presentation:item.presentation,unit:item.unit,quantityBasis:item.quantityBasis}:catalog.find(p=>p.id===item.productId);const result=stored?item:RequestRules.calculateLine({...item,category:data.category,containerCount:data.containerCount,product});const row=document.createElement('div');row.className='review-line';const info=document.createElement('div');const title=document.createElement('h3');title.textContent=product?.name||item.productId;const hint=document.createElement('p');hint.textContent=product?.quantityBasis==='TOTAL'?'Unidad: '+product.unit:product?.presentation||'';if(result.doseQuantity)hint.textContent+=' · Dosis: '+result.doseQuantity+' '+item.unit+' por '+(data.applicationMode==='TANQUES'?'tanque':'cilindro');info.append(title,hint);const total=document.createElement('strong');total.textContent=result.quantity+' '+item.unit;row.append(info,total);if(stored&&result.deliveredQuantity!==undefined){const progress=document.createElement('p');progress.className='public-delivery-progress';progress.textContent='Entregado: '+result.deliveredQuantity+' '+item.unit+' · Pendiente: '+result.pendingQuantity+' '+item.unit;info.append(progress);}container.append(row);}
}
function review(data){reviewPayload=data;$('#review-details').replaceChildren(detailsElement(data));renderProductLines($('#review-lines'),data);$('#pending-notice').hidden=!attempt;$('#download-pending').hidden=!attempt;$('#edit-request').disabled=Boolean(attempt);$('#send-request').textContent=attempt?'Reintentar registro':'Enviar solicitud';screen('review');}
async function api(url,data){
 const controller=new AbortController();const timer=setTimeout(()=>controller.abort(),20000);
 try{const response=await fetch(url,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data),signal:controller.signal});const json=await response.json();if(!response.ok){const error=new Error(json.error);error.status=response.status;throw error;}return json;}finally{clearTimeout(timer);}
}
function download(name,text,type='text/plain;charset=utf-8'){const link=document.createElement('a');link.href=URL.createObjectURL(new Blob([text],{type}));link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(link.href),1000);}
function showReceipt(data,key){receipt={...data,privateKey:key};storage.set('japurima.public.receipt.v2',receipt);$('#receipt-code').value=data.code;$('#receipt-key').value=key;$('#receipt-date').textContent=localDate(data.createdAt);$('.receipt-status .status-pill').textContent=statusLabel(data.status);screen('receipt');}
async function send(){
 if(sending)return;sending=true;$('#send-request').disabled=true;errorAt('#send-error','');
 try{
  if(!attempt){attempt={...reviewPayload,operationId:uuid(),privateKey:privateKey()};storage.set('japurima.public.pending',attempt);}
  $('#edit-request').disabled=true;const saved=await api('/api/public/requests',attempt);const key=attempt.privateKey;
  attempt=null;storage.set('japurima.public.pending',null);storage.set('japurima.public.draft.v2',null);showReceipt(saved,key);
 }catch(error){
  errorAt('#send-error',error.status?friendly(error):'No se confirmó el registro. Reintenta con esta misma solicitud; conservamos todos sus datos.');
  if(error.status===422&&error.message!=='REQUEST_VERSION_REQUIRED'){attempt=null;storage.set('japurima.public.pending',null);$('#edit-request').disabled=false;$('#pending-notice').hidden=true;$('#download-pending').hidden=true;}
  else{$('#pending-notice').hidden=false;$('#download-pending').hidden=false;$('#send-request').textContent='Reintentar registro';}
 }finally{sending=false;$('#send-request').disabled=false;}
}
async function lookup(event){
 event.preventDefault();const button=event.target.querySelector('button');button.disabled=true;errorAt('#lookup-error','');$('#lookup-result').hidden=true;
 try{const data=await api('/api/public/requests/status',{code:event.target.elements.code.value.trim(),privateKey:event.target.elements.privateKey.value.trim()});const result=$('#lookup-result');result.replaceChildren();const heading=document.createElement('h2');heading.textContent=data.code;const badge=document.createElement('span');badge.className='status-pill';badge.textContent=statusLabel(data.status);const date=document.createElement('p');date.className='section-help';date.textContent='Registrada el '+localDate(data.createdAt);result.append(heading,badge,date);if(data.requestVersion===2)result.append(detailsElement(data));const products=document.createElement('div');products.className='review-lines';renderProductLines(products,data,true);result.append(products);const pdf=document.createElement('button');pdf.type='button';pdf.className='outline-button';pdf.textContent='Descargar pedido PDF';pdf.addEventListener('click',()=>window.JapurimaDocuments.publicRequest(pdf,{code:data.code,privateKey:event.target.elements.privateKey.value.trim()}));result.append(pdf);result.hidden=false;}
 catch(error){errorAt('#lookup-error',error.status===404?'No encontramos una solicitud con ese código y clave. Revisa ambos datos.':error.status?friendly(error):'No se pudo conectar. Conservamos el código y la clave para reintentar.');}finally{button.disabled=false;}
}
function openRegister(){if(attempt){try{review(attempt);}catch{screen('review');notice('Conserva tu copia anterior y reintenta el registro.');}return;}screen('register');}
for(const button of document.querySelectorAll('[data-open]'))button.addEventListener('click',()=>button.dataset.open==='register'?openRegister():screen(button.dataset.open));
form.addEventListener('submit',event=>{event.preventDefault();errorAt('#form-error','');if(!catalogReady){errorAt('#form-error','Espera a que termine de cargar el catálogo.');return;}try{review(payload());}catch(error){errorAt('#form-error',friendly(error));}});
form.addEventListener('input',()=>{updateTotals();saveDraft();});
form.addEventListener('change',event=>{if(event.target.name==='category')changeCategory(event.target.value);updateTotals();saveDraft();});
$('#product-search').addEventListener('input',refreshOptions);$('#add-request-line').addEventListener('click',()=>{addLine();saveDraft();});
$('#edit-request').addEventListener('click',()=>{if(!attempt&&!sending)screen('register');});$('#send-request').addEventListener('click',send);
$('#download-pending').addEventListener('click',()=>{if(attempt)download('JAPURIMA-solicitud-pendiente-privada.json',JSON.stringify(attempt,null,2),'application/json');});
$('#public-request-pdf').addEventListener('click',()=>{if(receipt)window.JapurimaDocuments.publicRequest($('#public-request-pdf'),{code:receipt.code,privateKey:receipt.privateKey});});
$('#download-receipt').addEventListener('click',()=>{
 if(!receipt)return;const lines=['AGRÍCOLA JAPURIMA S.A.','COMPROBANTE DE SOLICITUD','', 'Código: '+receipt.code,'Clave privada: '+receipt.privateKey,'Fecha: '+localDate(receipt.createdAt),'Estado: '+statusLabel(receipt.status),'Categoría: '+(RequestRules.CATEGORIES[receipt.category]||''),'Solicitante: '+receipt.requester,'Lugar: '+receipt.destination];if(receipt.crop)lines.push('Cultivo: '+receipt.crop);if(receipt.applicationMode)lines.push('Modalidad: '+receipt.applicationMode+' | Recipientes: '+receipt.containerCount);lines.push('','PRODUCTOS');for(const item of receipt.items)lines.push(item.product+' | '+item.quantity+' '+item.unit+(item.doseQuantity?' | Dosis: '+item.doseQuantity+' '+item.unit:''));if(receipt.notes)lines.push('','Observaciones: '+receipt.notes);lines.push('','Conserve este comprobante y su clave de forma privada.');download(receipt.code+'-comprobante-privado.txt',lines.join('\n'));
});
$('#receipt-lookup').addEventListener('click',()=>{if(!receipt)return;$('#public-lookup').elements.code.value=receipt.code;$('#public-lookup').elements.privateKey.value=receipt.privateKey;screen('lookup');});
$('#new-request').addEventListener('click',()=>{form.reset();categoryDrafts={};category='AGROQUIMICOS';changeCategory(category,[{}]);saveDraft();screen('register');});
$('#public-lookup').addEventListener('submit',lookup);
async function init(){
 const draft=storage.get('japurima.public.draft.v2');attempt=storage.get('japurima.public.pending');receipt=storage.get('japurima.public.receipt.v2');
 try{const response=await fetch('/api/public/catalog',{cache:'no-store'});if(!response.ok)throw new Error('No se pudo cargar el catálogo. Actualiza la página para reintentar.');catalog=await response.json();catalogReady=true;if(!catalog.length)notice('Aún no hay productos habilitados para solicitudes. Consulta con el almacén.');}
 catch(error){notice(error.message);}
 if(draft&&Object.hasOwn(RequestRules.CATEGORIES,draft.category)){for(const name of ['requester','destination','notes','crop','containerCount'])form.elements[name].value=draft[name]||'';form.elements.applicationMode.value=draft.applicationMode||'CILINDROS';form.elements.category.value=draft.category;categoryDrafts=draft.categoryDrafts||{};changeCategory(draft.category,draft.items||[{}]);}else changeCategory(category,[{}]);
 if(attempt){if(attempt.requestVersion===2&&catalogReady){try{review(attempt);}catch{screen('review');$('#pending-notice').hidden=false;$('#download-pending').hidden=false;}}else{screen('review');$('#pending-notice').hidden=false;$('#download-pending').hidden=false;$('#edit-request').disabled=true;$('#send-request').textContent='Reintentar solicitud anterior';}}
}
init();
