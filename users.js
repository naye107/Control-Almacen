'use strict';
async function userApi(url, method='GET', data) {
 const response=await fetch(url,{method,credentials:'same-origin',headers:{'Content-Type':'application/json','X-CSRF-Token':csrfToken},body:data?JSON.stringify(data):undefined});
 const result=await response.json();if(!response.ok)throw new Error(result.error);return result;
}
async function renderUsers() {
 if(currentRole!=='ADMINISTRADOR')return;
 const message=document.querySelector('#users-message');
 try {
  const users=await userApi('/api/users');
  const table=document.querySelector('#users-table');table.replaceChildren();
  for(const user of users) {
   const row=document.createElement('tr');
   for(const value of [user.username,user.role,user.active?'Activo':'Inactivo']) {const cell=document.createElement('td');cell.textContent=value;row.append(cell);}
   const actions=document.createElement('td');
   function action(label,data) {const button=document.createElement('button');button.type='button';button.className='text-button';button.textContent=label;button.addEventListener('click',async()=>{try{await userApi('/api/users/'+user.id,'PATCH',data);message.textContent='Usuario actualizado. Sus sesiones fueron revocadas.';await renderUsers();}catch(e){message.textContent=e.message;}});actions.append(button);}
   action(user.active?'Desactivar':'Activar',{active:!user.active});
   action('Cambiar rol',{role:user.role==='ADMINISTRADOR'?'ALMACENERO':'ADMINISTRADOR'});
   const password=document.createElement('input');password.type='password';password.minLength=12;password.maxLength=256;password.placeholder='Nueva contrasena';password.autocomplete='new-password';password.setAttribute('aria-label','Nueva contrasena para '+user.username);
   const reset=document.createElement('button');reset.type='button';reset.className='text-button';reset.textContent='Cambiar contrasena';reset.addEventListener('click',async()=>{try{await userApi('/api/users/'+user.id,'PATCH',{password:password.value});password.value='';message.textContent='Contrasena cambiada. Sesiones revocadas.';}catch(e){password.value='';message.textContent=e.message;}});
   actions.append(password,reset);row.append(actions);table.append(row);
  }
 }catch(e){message.textContent=e.message;}
}
document.querySelector('#refresh-users').addEventListener('click',renderUsers);
document.querySelector('[data-view="users"]').addEventListener('click',renderUsers);
document.querySelector('#user-create-form').addEventListener('submit',async event=>{
 event.preventDefault();const form=event.target;const data=Object.fromEntries(new FormData(form));
 try {await userApi('/api/users','POST',data);form.reset();document.querySelector('#users-message').textContent='Usuario creado.';await renderUsers();}catch(e){document.querySelector('#users-message').textContent=e.message;}
});
