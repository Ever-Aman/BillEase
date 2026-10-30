import { views, titles, matches, roleIssue, dateLabel, businessCreation } from './model.mjs';

const root = document.querySelector('#app');
let session = null;
let directory = null;
let updatedAt = null;
let currentView = views.includes(location.hash.slice(1)) ? location.hash.slice(1) : 'access';
let search = '';
let notice = null;
let loading = false;
let directoryError = '';
let sessionGeneration = 0;
let pendingCreation = null; // Memory only: one immutable request until its outcome is reconciled.
const icons = {access:'M4 7h16M7 4v6M17 14v6M4 17h16',businesses:'M4 21V5h16v16M8 9h2M14 9h2M8 13h2M14 13h2M10 21v-4h4v4',accounts:'M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2M13 3a4 4 0 0 1 0 8M22 21v-2a4 4 0 0 0-3-3.87M13 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0',devices:'M8 2h8a2 2 0 0 1 2 2v16a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2M11 18h2',activity:'M3 12h4l3-8 4 16 3-8h4',security:'M12 3 3 7v6c0 5 9 9 9 9s9-4 9-9V7l-9-4M8 12l3 3 5-6'};

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key,value] of Object.entries(attrs)) {
    if (key === 'class') node.className = value;
    else if (key.startsWith('on')) node.addEventListener(key.slice(2),value);
    else if (value !== false && value != null) node.setAttribute(key,value === true ? '' : String(value));
  }
  for (const child of children.flat(Infinity)) if (child != null) node.append(child instanceof Node ? child : document.createTextNode(String(child)));
  return node;
}
function button(label, action, kind = '') { return el('button',{type:'button',class:kind,onclick:action},label); }
function brand() { return el('div',{class:'brand'},el('img',{src:'./assets/mark.svg',alt:''}),el('span',{},'BillEase',el('small',{},'Admin workspace'))); }
function icon(name) {
  const svg = document.createElementNS('http://www.w3.org/2000/svg','svg');
  for (const [key,value] of Object.entries({viewBox:'0 0 24 24',fill:'none',stroke:'currentColor','stroke-width':'1.5','stroke-linecap':'round','stroke-linejoin':'round','aria-hidden':'true'})) svg.setAttribute(key,value);
  const path = document.createElementNS(svg.namespaceURI,'path');path.setAttribute('d',icons[name]);svg.append(path);return svg;
}
function badge(label) { return el('span',{class:'badge'},label); }
function identity(main, sub) { const isId=typeof sub==='string' && /^[a-f0-9]{8}-[a-f0-9-]{27}$/i.test(sub);return el('span',{}, main ?? '—',sub ? el('span',{class:'subline',title:isId?sub:null},isId?`${sub.slice(0,8)}…`:sub) : null); }
function field(label, input, hint) {
  const id = input.id || `field-${crypto.randomUUID()}`;input.id = id;
  if (hint) input.setAttribute('aria-describedby',`${id}-help`);
  return el('label',{class:'field',for:id},el('span',{},label),input,hint ? el('small',{id:`${id}-help`},hint) : null);
}
function input(name, type='text', attrs={}) { return el('input',{name,type,required:true,...attrs}); }
function errorText(form,message) { let node = form.querySelector('.error-text');if (!node) { node=el('p',{class:'error-text',role:'alert'});form.append(node); }node.textContent=message; }
function clearSecrets() { pendingCreation = null;document.querySelectorAll('input[type=password]').forEach(node=>node.value='');document.querySelectorAll('dialog').forEach(node=>node.remove()); }
class ApiError extends Error { constructor(message,status) { super(message);this.status=status; } }
async function api(path,{method='GET',body,keepLogin=false}={}) {
  const headers = {'X-Requested-With':'BillEaseAdmin','Accept':'application/json'};
  if (body !== undefined) headers['Content-Type']='application/json';
  if (method !== 'GET' && session?.csrfToken) headers['X-CSRF-Token']=session.csrfToken;
  let response;
  try { response = await fetch(`/admin/api${path}`,{method,headers,credentials:'same-origin',cache:'no-store',body:body === undefined ? undefined : JSON.stringify(body)}); }
  catch { throw new ApiError('The server could not be reached. Check your connection and try again.',0); }
  let data;try { data=await response.json(); }catch { data={}; }
  if (!response.ok) {
    if ((response.status === 401 || response.status === 403) && session && !keepLogin) {
      session=null;directory=null;sessionGeneration++;clearSecrets();renderLogin('Your session has ended or admin access has changed. Sign in again.');
    }
    throw new ApiError(typeof data.error === 'string' ? data.error : `Request failed (${response.status}).`,response.status);
  }
  return data;
}
function renderLogin(message='') {
  root.replaceChildren();
  const email = input('email','email',{autocomplete:'username'});
  const password = input('password','password',{autocomplete:'current-password'});
  const code = input('mfaCode','text',{autocomplete:'one-time-code',inputmode:'numeric',pattern:'[0-9]{6}',maxlength:'6'});
  let recovery=false;
  const authButton=button('Authenticator code',()=>setMode(false));
  const recoveryButton=button('Recovery code',()=>setMode(true));
  const codeLabel=field('Authenticator code',code,'Enter the six-digit code from your authenticator app.');
  function setMode(value) { recovery=value;authButton.setAttribute('aria-pressed',String(!value));recoveryButton.setAttribute('aria-pressed',String(value));code.name=value?'recoveryCode':'mfaCode';code.value='';codeLabel.querySelector('span').textContent=value?'One-time recovery code':'Authenticator code';codeLabel.querySelector('small').textContent=value?'Each recovery code can be used once.':'Enter the six-digit code from your authenticator app.';code.setAttribute('inputmode',value?'text':'numeric');if(value){code.removeAttribute('pattern');code.removeAttribute('maxlength');}else{code.pattern='[0-9]{6}';code.maxLength=6;} }
  const submit=el('button',{class:'primary',type:'submit'},'Sign in');
  const form=el('form',{class:'login-form',onsubmit:async event=>{
    event.preventDefault();if(!form.reportValidity())return;submit.disabled=true;submit.textContent='Signing in…';
    try { const result=await api('/login',{method:'POST',body:{email:email.value.trim(),password:password.value,[recovery?'recoveryCode':'mfaCode']:code.value.trim()},keepLogin:true});
      if (!result.user?.isAdmin || !result.csrfToken) throw new Error('This account does not have admin access.');
      session=result;password.value='';code.value='';notice=null;await loadDirectory();
    }catch(error){password.value='';code.value='';errorText(form,error.message);}finally{submit.disabled=false;submit.textContent='Sign in';}
  }},el('h1',{},'Sign in to Admin'),el('p',{},'Manage businesses, accounts and access.'),field('Email address',email),field('Password',password),el('div',{class:'choice','aria-label':'Verification method'},authButton,recoveryButton),codeLabel,submit);
  if(message)errorText(form,message);setMode(false);
  root.append(el('div',{class:'login-wrap'},el('aside',{class:'login-intro'},brand(),el('div',{class:'intro-copy'},el('h2',{},'The right access.\nFor every business.'),el('p',{},'Set up your businesses and the people who run them, in one place.')),el('p',{class:'login-footer'},'Business setup & access management')),el('main',{id:'main',class:'login-area'},form)));
}
function accountName(id) { return directory?.users.find(user=>user.id===id)?.email || id || '—'; }
function businessName(id) { return directory?.businesses.find(business=>business.id===id)?.name || id || '—'; }
function toast(message,error=false) { notice={message,error};renderShell(); }
async function loadDirectory() {
  if(!session)return;
  const generation=sessionGeneration;loading=true;directoryError='';renderShell();
  try { const data=await api('/directory');if(!session || generation!==sessionGeneration)return;directory={businesses:data.businesses||[],users:data.users||[],memberships:data.memberships||[],devices:data.devices||[],auditEvents:data.auditEvents||[]};updatedAt=new Date(); }
  catch(error){if(session)directoryError=error.message;}
  finally{loading=false;if(session)renderShell();}
}
function renderShell() {
  if(!session)return;
  const nav = el('nav',{class:'nav','aria-label':'Admin navigation'},views.map(view=>el('a',{href:`#${view}`,'aria-current':view===currentView?'page':null},icon(view),titles[view])));
  const signout=button('Sign out',async()=>{
    signout.disabled=true;
    try {await api('/logout',{method:'POST',body:{}});session=null;directory=null;sessionGeneration++;clearSecrets();renderLogin();}
    catch(error){if(session){signout.disabled=false;toast(error.message,true);}}
  },'text');
  const main=el('main',{id:'main',class:'canvas'});
  const sidebar=el('aside',{class:'sidebar'},brand(),el('div',{class:'scope'},el('p',{},'Business administration'),el('small',{},session.environment || 'Environment unavailable')),nav,el('div',{class:'sidebar-bottom'},el('p',{class:'identity'},session.user.email),signout));
  const shell=el('div',{class:'shell'});
  const menu=button('Menu',()=>{const open=shell.classList.toggle('menu-open');menu.setAttribute('aria-expanded',String(open));},'text');menu.setAttribute('aria-expanded','false');menu.setAttribute('aria-label','Toggle navigation');
  shell.append(el('header',{class:'mobile-header'},brand(),menu),sidebar,main);root.replaceChildren(shell);
  const descriptions={access:'Who can work in each business.',businesses:'Separate businesses. Separate books.',accounts:'Individual accounts for owners, staff and administrators.',devices:'Enrolled devices and their current access.',activity:'A record of administrative and access changes.',security:'Protect your admin account and recovery access.'};
  const refresh=button(loading?'Refreshing…':'Refresh',loadDirectory,'text');refresh.disabled=loading;
  const primary={access:['Assign access',showAccessForm],businesses:['New business',()=>showCreation('business')],accounts:['New account',()=>showCreation('user')]};
  main.append(el('header',{class:'page-head'},el('div',{},el('h1',{},titles[currentView]),el('p',{},descriptions[currentView])),el('div',{class:'head-actions'},currentView==='security'?null:el('div',{},el('p',{class:'freshness'},updatedAt?`Updated ${dateLabel(updatedAt)}`:'Not yet loaded'),refresh),primary[currentView]?button(...primary[currentView],'primary'):null)));
  if(notice)main.append(el('div',{class:`notice${notice.error?' error':''}`,role:notice.error?'alert':'status'},el('p',{},notice.message),button('Dismiss',()=>{notice=null;renderShell();},'text')));
  if(pendingCreation)main.append(el('div',{class:'notice',role:'status'},el('p',{},'A creation request needs its outcome checked. Keep this page open; the original request is retained.'),button('Review request',()=>showCreation(pendingCreation.kind))));
  if(currentView==='security'){renderSecurity(main);return;}
  if(directoryError)main.append(el('div',{class:'notice error',role:'alert'},el('p',{},`Could not refresh the directory. ${directoryError}${updatedAt?` Last updated ${dateLabel(updatedAt)}.`:''}`),button('Retry',loadDirectory)));
  if(!directory){main.append(el('section',{class:'table-panel','aria-busy':loading},el('div',{class:'empty'},loading?'Loading the directory…':'The directory is unavailable. Use Retry to load it.'),loading?el('div',{class:'loading-rows','aria-hidden':'true'},[1,2,3].map(()=>el('span'))):null));return;}
  const searchInput=input('search','search',{required:false,placeholder:`Search ${titles[currentView].toLocaleLowerCase()}`,'aria-label':`Search ${titles[currentView].toLocaleLowerCase()}`});searchInput.value=search;
  const listing=el('div');const count=el('span',{class:'count','aria-live':'polite'});
  searchInput.addEventListener('input',()=>{search=searchInput.value;renderListing(listing,count);});
  main.append(el('div',{class:'toolbar'},el('div',{class:'search'},searchInput),count));
  const layout=el('div',{class:'data-layout'},listing,renderRail());main.append(layout);renderListing(listing,count);
}
function table(headers,rows,emptyTitle,emptyMessage) {
  if(!rows.length)return el('div',{class:'table-panel'},el('div',{class:'empty'},el('strong',{},search?'No matches found':emptyTitle),search?'Try a different name, email or business.':emptyMessage));
  return el('div',{class:'table-panel'},el('div',{class:'table-wrap'},el('table',{class:`responsive ${currentView==='activity'?'activity-table':''}`},el('thead',{},el('tr',{},headers.map(header=>el('th',{scope:'col'},header)))),el('tbody',{},rows.map(cells=>el('tr',{},cells.map((cell,index)=>el('td',{'data-label':headers[index],class:cell?.action?'action':''},cell?.action?cell.action:cell))))))));
}
function renderListing(container,count) {
  let headers,rows,emptyTitle,emptyMessage,noun;
  if(currentView==='businesses'){
    headers=['Business','Document mode','Access'];noun='businesses';
    rows=directory.businesses.filter(b=>matches(search,b.name,b.id,b.document_mode)).map(b=>[identity(b.name,b.id),b.document_mode || '—',`${directory.memberships.filter(m=>m.business_id===b.id&&m.active!==false).length} active members`]);emptyTitle='No businesses yet';emptyMessage='Create a business, then assign its owners and staff.';
  } else if(currentView==='accounts'){
    headers=['Account','Access','Verification'];noun='accounts';
    rows=directory.users.filter(u=>matches(search,u.email,u.id,u.is_admin?'administrator':'',u.active===false?'inactive':'active')).map(u=>[identity(u.email,u.id),identity(u.is_admin?'Administrator':membershipSummary(u.id),u.active===false?'Inactive account':'Active account'),u.mfa_enabled?'Authenticator enabled':'Authenticator not enabled']);emptyTitle='No accounts found';emptyMessage='Create an individual account for each person who needs access.';
  } else if(currentView==='access'){
    headers=['Account','Business','Role','Access'];noun='memberships';
    rows=directory.memberships.filter(m=>matches(search,accountName(m.user_id),businessName(m.business_id),m.role,m.active===false?'removed':'active')).map(m=>[identity(accountName(m.user_id),m.user_id),businessName(m.business_id),badge(m.role),m.active===false?'Removed':{action:button('Remove access',()=>confirmRemoval(m),'text danger')}]);emptyTitle='No business access assigned';emptyMessage='Assign an owner or a staff account to a business to get started.';
  } else if(currentView==='devices'){
    headers=['Device','Account','Last seen','Access'];noun='devices';
    rows=directory.devices.filter(d=>matches(search,d.name,d.id,accountName(d.user_id),d.active===false?'revoked':'active')).map(d=>[identity(d.name||'Unnamed device',d.id),accountName(d.user_id),identity(dateLabel(d.last_seen_at),`Enrolled ${dateLabel(d.created_at)}`),d.active===false?'Revoked':{action:button('Revoke device',()=>confirmDevice(d),'text danger')}]);emptyTitle='No enrolled devices';emptyMessage='Devices appear here when an account enrols a device.';
  } else {
    headers=['Action','Actor','Business / reference','Received'];noun='events';
    rows=[...directory.auditEvents].sort((a,b)=>new Date(b.received_at||b.created_at)-new Date(a.received_at||a.created_at)).filter(a=>matches(search,a.action,accountName(a.actor_id),businessName(a.business_id),a.entity_id,a.id)).map(a=>[identity(a.action,a.id),accountName(a.actor_id),identity(a.business_id?businessName(a.business_id):'—',a.entity_id),dateLabel(a.received_at||a.created_at)]);emptyTitle='No activity recorded';emptyMessage='Administrative changes will appear here after they are recorded by the server.';
  }
  const singular={businesses:'business',accounts:'account',memberships:'membership',devices:'device',events:'event'};count.textContent=`${rows.length.toLocaleString()} ${rows.length===1?singular[noun]:noun}${search?' matching':''}`;
  container.replaceChildren(table(headers,rows,emptyTitle,emptyMessage));
}
function membershipSummary(userId) { const memberships=directory.memberships.filter(m=>m.user_id===userId&&m.active!==false);return memberships.length?memberships.map(m=>`${m.role} · ${businessName(m.business_id)}`).join(', '):'No business access'; }
function renderRail() {
  const texts={access:['Access rules','Owners can run multiple businesses. Staff belong to exactly one business.','Every business must retain an active owner. The server checks these rules before saving.'],businesses:['Business setup','Create a separate business for each set of books.','After setup, assign at least one owner from Access. Admin status alone does not grant access to financial operations.'],accounts:['Individual accounts','Each person signs in with their own account.','Creating an account does not assign it to a business. Use Access to give it an owner or staff role.'],devices:['Device access','Revoke a lost or unused device.','Revocation ends its server access. Previously exported or viewed information cannot be recalled.'],activity:['Audit trail','Setup and access changes are recorded by the server.','Search by action, account, business or reference. Times use your browser’s local timezone.']};
  const [title,copy,detail]=texts[currentView];
  return el('aside',{class:'rail'},el('h2',{},title),el('p',{},copy),el('div',{class:'mini'},el('p',{},detail)));
}
function modal(title) {
  const dialog=el('dialog',{'aria-label':title});const body=el('div',{class:'dialog-body'});
  const close=()=>{dialog.close();dialog.remove();};dialog.append(el('div',{class:'dialog-head'},el('h2',{},title),button('×',close,'text')),body);dialog.querySelector('button').setAttribute('aria-label','Close dialog');
  dialog.addEventListener('close',()=>dialog.remove());document.body.append(dialog);dialog.showModal();return {dialog,body,close};
}
function showAccessForm() {
  if(!directory){toast('Load the directory before assigning access.',true);return;}
  const {body,close}=modal('Assign business access');
  const user=el('select',{name:'userId',required:true},el('option',{value:''},'Select an account'),directory.users.filter(u=>u.active!==false).map(u=>el('option',{value:u.id},u.email)));
  const business=el('select',{name:'businessId',required:true},el('option',{value:''},'Select a business'),directory.businesses.map(b=>el('option',{value:b.id},b.name)));
  const role=el('select',{name:'role'},el('option',{value:'owner'},'Owner'),el('option',{value:'staff'},'Staff'));
  const submit=el('button',{type:'submit',class:'primary'},'Assign access');
  const form=el('form',{onsubmit:async event=>{event.preventDefault();if(!form.reportValidity())return;
    const issue=roleIssue(directory.memberships,user.value,business.value,role.value);if(issue){errorText(form,issue);return;}
    submit.disabled=true;
    try{await api('/memberships',{method:'POST',body:{userId:user.value,businessId:business.value,role:role.value}});close();notice={message:`${accountName(user.value)} now has ${role.value} access to ${businessName(business.value)}.`};await loadDirectory();}catch(error){errorText(form,error.message);}finally{submit.disabled=false;}
  }},el('p',{class:'form-note'},'Owners have equal authority within a business. Staff can belong to one business only.'),field('Account',user),field('Business',business),field('Role',role),el('div',{class:'form-actions'},button('Cancel',close),submit));body.append(form);
}
function showCreation(kind) {
  if(pendingCreation && pendingCreation.kind!==kind){toast('Resolve the pending creation request before creating another business or account.',true);return;}
  const isUser=kind==='user';const title=isUser?'Create account':'Create business';
  const {body,close}=modal(title);
  const name=input(isUser?'email':'name',isUser?'email':'text',isUser?{autocomplete:'off'}:{maxlength:'160'});
  const password=isUser?input('password','password',{autocomplete:'new-password',minlength:'12',maxlength:'256'}):null;
  const documentMode=isUser?null:el('select',{name:'documentMode',required:true},el('option',{value:''},'Select GST classification'),el('option',{value:'composition'},'Composition GST'),el('option',{value:'regular_gst'},'Regular GST'));
  const id= pendingCreation?.body.id || crypto.randomUUID();
  const submit=el('button',{type:'submit',class:'primary'},pendingCreation?'Check outcome':'Create');
  const info=el('p',{class:'form-note'},'');
  const form=el('form',{},field(isUser?'Email address':'Business name',name),documentMode?field('GST classification',documentMode,'The owner supplies legal GSTIN and address details in the mobile app.'):null,password?field('Initial password',password,'Use at least 12 characters. Share it with the account holder through a secure channel.'):null,info,el('div',{class:'form-actions'},button('Close',close),submit));
  function lock(){name.disabled=true;if(documentMode)documentMode.disabled=true;if(password){password.value='';password.disabled=true;password.required=false;}submit.textContent='Check outcome';info.textContent='The request may have reached the server. Check its outcome before trying again. This page retains the original request in memory.';}
  if(pendingCreation){name.value=pendingCreation.body[isUser?'email':'name'];if(documentMode)documentMode.value=pendingCreation.body.documentMode;lock();}else{info.textContent=isUser?'The account will have no business access until you assign it.':'Assign owners and staff after creating this business.';}
  form.addEventListener('submit',async event=>{
    event.preventDefault();if(!pendingCreation && !form.reportValidity())return;submit.disabled=true;
    if(!pendingCreation){try{pendingCreation={kind,body:Object.freeze(isUser?{id,email:name.value.trim(),password:password.value}:businessCreation(id,name.value,documentMode.value))};lock();}catch(error){errorText(form,error.message);submit.disabled=false;return;}}
    try{
      // A fresh read reconciles a lost response before replaying the same ID and body.
      const fresh=await api('/directory');
      const collection=isUser?fresh.users:fresh.businesses;
      const found=(collection||[]).find(item=>item.id===pendingCreation.body.id);
      if(!found && pendingCreation.rejected){
        pendingCreation=null;name.disabled=false;if(documentMode)documentMode.disabled=false;if(password){password.disabled=false;password.required=true;}
        submit.textContent='Create';info.textContent='The server confirmed this request did not create an account or business. Correct the details, then submit again.';return;
      }
      if(!found)await api(isUser?'/users':'/businesses',{method:'POST',body:pendingCreation.body});
      pendingCreation=null;close();notice={message:isUser?'Account created. Assign business access when ready.':'Business created. Assign its owners and staff next.'};await loadDirectory();
    }catch(error){if(session){if(pendingCreation && error.status>=400 && error.status<500 && ![408,429].includes(error.status))pendingCreation.rejected=true;errorText(form,`${error.message} The original request is retained. Check the outcome again before starting a new creation.`);submit.textContent='Check outcome';}}
    finally{submit.disabled=false;}
  });body.append(form);
}
function confirmation(title,description,label,action) {
  const {body,close,dialog}=modal(title);const submit=button(label,async()=>{submit.disabled=true;try{await action();close();await loadDirectory();}catch(error){if(session)errorText(body,error.message);}finally{submit.disabled=false;}},'primary');
  body.append(el('p',{},description),el('div',{class:'form-actions'},button('Cancel',close),submit));dialog.querySelector('.form-actions button').focus();
}
function confirmRemoval(membership) { confirmation('Remove business access?',`Remove ${accountName(membership.user_id)} from ${businessName(membership.business_id)}? Their ${membership.role} access to this business will end. A business’s last owner cannot be removed.`,'Remove access',async()=>{await api(`/businesses/${encodeURIComponent(membership.business_id)}/memberships/${encodeURIComponent(membership.user_id)}`,{method:'DELETE'});notice={message:'Business access removed.'};}); }
function confirmDevice(device) { confirmation('Revoke device?',`Revoke “${device.name||'Unnamed device'}” (${device.id}) for ${accountName(device.user_id)}? This device will lose server access.`,'Revoke device',async()=>{await api(`/devices/${encodeURIComponent(device.id)}`,{method:'DELETE'});notice={message:'Device access revoked.'};}); }
async function renderSecurity(main) {
  const generation=sessionGeneration;
  const status=el('span',{role:'status'},'Checking…');const statusPanel=el('div',{class:'security-state'},el('span',{},'Authenticator MFA'),status);
  const rotate=button('Replace recovery codes',showRecoveryForm);rotate.disabled=true;
  const panel=el('section',{class:'panel'},statusPanel,el('p',{},'Recovery codes let you sign in if your authenticator is unavailable. Replacing the set immediately invalidates all old codes.'),rotate);
  main.append(el('div',{class:'settings'},el('section',{class:'settings-copy'},el('h2',{},'Sign-in protection'),el('p',{},'Your admin sign-in requires a password and an authenticator code or a one-time recovery code.'),el('p',{},'Keep recovery codes somewhere safe, separate from this device. Codes are displayed once.')),panel));
  try{const data=await api('/mfa');if(!session||generation!==sessionGeneration||currentView!=='security')return;status.textContent=data.active?'Enabled':data.pending?'Enrolment pending':'Not enabled';rotate.disabled=!data.active;if(!data.active)panel.append(el('p',{class:'form-note'},'Authenticator enrolment must be completed through the account setup process before recovery codes can be replaced.'));}
  catch(error){status.textContent='Unavailable';if(session){errorText(panel,error.message);panel.append(button('Retry',()=>renderShell()));}}
}
function showRecoveryForm() {
  const {body,close,dialog}=modal('Replace recovery codes');
  const password=input('password','password',{autocomplete:'current-password'});
  const code=input('mfaCode','text',{autocomplete:'one-time-code'});
  const method=el('select',{name:'method'},el('option',{value:'mfaCode'},'Authenticator code'),el('option',{value:'recoveryCode'},'Recovery code'));
  const submit=el('button',{type:'submit',class:'primary'},'Replace codes');
  const form=el('form',{onsubmit:async event=>{event.preventDefault();if(!form.reportValidity())return;submit.disabled=true;
    try{const result=await api('/mfa/recovery-codes',{method:'POST',body:{password:password.value,[method.value]:code.value.trim()}});password.value='';code.value='';const codes=result.recoveryCodes;if(!Array.isArray(codes)||!codes.length)throw new Error('No recovery codes were returned. Check your account’s recovery status before trying again.');
      body.replaceChildren(el('p',{},'Your old recovery codes are now invalid. Save these codes in a secure place. After closing this window, they cannot be displayed again.'),el('ul',{class:'codes'},codes.map(value=>el('li',{},value))),button('I have saved these codes',close,'primary'));
      dialog.addEventListener('close',()=>body.replaceChildren(),{once:true});
    }catch(error){password.value='';code.value='';if(session)errorText(form,`${error.message}${error.status===0?' The outcome may be uncertain; old codes may already be invalid.':''}`);}finally{submit.disabled=false;}
  }},el('p',{class:'form-note'},'Confirm your password and a fresh verification code. All previous recovery codes will stop working.'),field('Password',password),field('Verification method',method),field('Verification code',code),el('div',{class:'form-actions'},button('Cancel',close),submit));body.append(form);
}
window.addEventListener('hashchange',()=>{const next=location.hash.slice(1);if(!views.includes(next))return;currentView=next;search='';if(session)renderShell();});
window.addEventListener('pagehide',()=>{clearSecrets();session=null;directory=null;});
window.addEventListener('pageshow',event=>{if(event.persisted)start();});
async function start(){try{const result=await api('/session',{keepLogin:true});if(result.user?.isAdmin&&result.csrfToken){session=result;await loadDirectory();}else renderLogin();}catch(error){renderLogin(error.status===401?'':error.message);}}
start();
