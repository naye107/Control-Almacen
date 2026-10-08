(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.JapurimaCsv=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
'use strict';
function cell(value){let text=String(value??'');if(typeof value!=='number'&&(/^[\s\u0000-\u001f]*[=+@-]/.test(text)||/^[\t\r\n]/.test(text)))text="'"+text;return '"'+text.replaceAll('"','""')+'"';}
function create(rows){return rows.map(row=>row.map(cell).join(',')).join('\r\n');}
return {cell,create};});
