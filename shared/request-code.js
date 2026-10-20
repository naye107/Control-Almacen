(function(root,factory){if(typeof module==='object'&&module.exports)module.exports=factory();else root.RequestCode=factory();})(typeof globalThis!=='undefined'?globalThis:this,function(){
 'use strict';
 function number(code){const match=/^(?:SOL-)?0*([1-9]\d{0,17})$/i.exec(String(code||'').trim());return match?BigInt(match[1]).toString():null;}
 function format(value){return value==null?null:'SOL-'+BigInt(value).toString().padStart(6,'0');}
 return {number,format};
});
