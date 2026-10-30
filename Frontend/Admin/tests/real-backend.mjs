// Requires Backend/scripts/admin-browser-fixture.mjs running. Reads disposable secrets privately.
import assert from 'node:assert/strict';
import {readFile,mkdir} from 'node:fs/promises';
import {generateKeyPairSync,randomUUID,randomBytes} from 'node:crypto';
import {dirname,resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const fixture=JSON.parse(await readFile('/tmp/billease-admin-browser-fixture.json','utf8'));
const skillRoot=process.env.TASTE_SKILL_ROOT||'/home/neveraman/.codex/plugins/cache/taste-skill/taste-skill/2.1.5/skills/taste-skill';
const {Browser}=await import(`${skillRoot}/scripts/lib/cdp.mjs`);
const artifacts=resolve(root,'tests/real-artifacts');await mkdir(artifacts,{recursive:true});
const resume=process.argv.includes('--resume-after-setup');
const browser=await Browser.launch();
const pause=()=>new Promise(r=>setTimeout(r,250));
try{
 const page=await browser.newPage();const csp=[];const off=browser.on(page.sessionId,'Log.entryAdded',({entry})=>{if(/content.security|refused to|violat.*policy/i.test(entry.text))csp.push(entry.text);});await page.send('Log.enable');
 await page.goto(`${fixture.origin}/admin/`,{settleMs:300});
 assert.equal(await page.eval(()=>document.querySelector('h1').textContent),'Sign in to Admin');
 await page.eval(()=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Recovery code').click());
 await page.eval(({email,password,recoveryCode})=>{document.querySelector('[name=email]').value=email;document.querySelector('[name=password]').value=password;document.querySelector('[name=recoveryCode]').value=recoveryCode;document.querySelector('form').requestSubmit();},{email:fixture.email,password:fixture.password,recoveryCode:fixture.recoveryCodes[resume?1:0]});
 await pause();assert.equal(await page.eval(()=>document.querySelector('h1').textContent),'Access');
 assert.equal(await page.eval(()=>localStorage.length+sessionStorage.length),0);
 assert.equal(await page.eval(()=>document.cookie.includes('billease_admin')),false);
 const cookies=(await page.send('Network.getCookies')).cookies;assert.ok(cookies.some(c=>c.httpOnly&&c.sameSite==='Strict'));
 await page.screenshot({path:resolve(artifacts,'access-desktop.jpg')});
 const readDirectory=()=>page.eval(async()=>{const r=await fetch('/admin/api/directory',{headers:{'X-Requested-With':'BillEaseAdmin'},cache:'no-store'});if(!r.ok)throw Error(`Directory ${r.status}`);return r.json();});
 let directory=await readDirectory();assert.ok(directory.businesses.length>=3);assert.ok(directory.memberships.some(m=>m.user_id===fixture.owner.id));
 const navigate=async view=>{await page.eval(v=>location.hash=v,view);await pause();};
 const click=async(label,selector='button')=>{await page.eval(({label,selector})=>{const button=Array.from(document.querySelectorAll(selector)).find(b=>b.textContent===label);if(!button)throw Error('Missing control '+label);button.click();},{label,selector});await pause();};
 const assign=async(businessId)=>{await click('Assign access');await page.eval(({userId,businessId})=>{document.querySelector('[name=userId]').value=userId;document.querySelector('[name=businessId]').value=businessId;document.querySelector('[name=role]').value='staff';document.querySelector('dialog form').requestSubmit();},{userId:fixture.staff.id,businessId});await pause();assert.equal(await page.eval(()=>Boolean(document.querySelector('dialog .error-text'))),false);};
 let business;
 if(!resume){
 await assign(fixture.businesses[0].id);directory=await readDirectory();assert.ok(directory.memberships.some(m=>m.user_id===fixture.staff.id&&m.active));
 await navigate('businesses');await click('New business');
 const businessName=`Browser acceptance ${randomUUID().slice(0,8)}`;
 await page.eval(name=>{document.querySelector('dialog [name=name]').value=name;document.querySelector('dialog [name=documentMode]').value='regular_gst';document.querySelector('dialog form').requestSubmit();},businessName);await pause();
 assert.equal(await page.eval(()=>document.querySelectorAll('dialog').length),0);directory=await readDirectory();business=directory.businesses.find(b=>b.name===businessName);assert.ok(business);
 await navigate('accounts');await click('New account');const newEmail=`acceptance-${randomUUID().slice(0,8)}@example.test`;const newPassword=randomBytes(24).toString('hex');
 await page.eval(({email,password})=>{document.querySelector('dialog [name=email]').value=email;document.querySelector('dialog [name=password]').value=password;document.querySelector('dialog form').requestSubmit();},{email:newEmail,password:newPassword});await new Promise(r=>setTimeout(r,500));
 assert.equal(await page.eval(()=>document.querySelectorAll('dialog').length),0);directory=await readDirectory();assert.ok(directory.users.find(u=>u.email===newEmail));
 await page.eval(()=>{const search=document.querySelector('[name=search]');search.value='no-such-account-acceptance';search.dispatchEvent(new Event('input'));});assert.ok(await page.eval(()=>document.querySelector('.empty').textContent.includes('No matches')));
 await navigate('access');
 await page.eval(email=>{const row=Array.from(document.querySelectorAll('tr')).find(r=>r.textContent.includes(email));Array.from(row.querySelectorAll('button')).find(b=>b.textContent==='Remove access').click();},fixture.staff.email);await pause();
 assert.ok(await page.eval(email=>document.querySelector('dialog').textContent.includes(email),fixture.staff.email));await click('Remove access','dialog button');
 directory=await readDirectory();assert.ok(directory.memberships.some(m=>m.user_id===fixture.staff.id&&!m.active));
 // Reactivation of the same membership is distinct from creating a duplicate active membership.
 await assign(fixture.businesses[0].id);directory=await readDirectory();assert.equal(directory.memberships.filter(m=>m.user_id===fixture.staff.id&&m.active).length,1);
 await page.eval(email=>{const row=Array.from(document.querySelectorAll('tr')).find(r=>r.textContent.includes(email));row.querySelector('button').click();},fixture.staff.email);await click('Remove access','dialog button');await assign(business.id);
 directory=await readDirectory();assert.ok(directory.memberships.some(m=>m.user_id===fixture.staff.id&&m.business_id===business.id&&m.active));
 }else{business=directory.businesses.find(b=>b.name.startsWith('Browser acceptance '));assert.ok(business);assert.ok(directory.memberships.some(m=>m.user_id===fixture.staff.id&&m.business_id===business.id&&m.active));}
 // Enrol a separate disposable staff device through the real mobile login, retaining tokens in this test only.
 const deviceId=randomUUID();const keys=generateKeyPairSync('ed25519');const publicKey=keys.publicKey.export({type:'spki',format:'der'}).toString('base64');
 const login=await fetch(`${fixture.origin}/v1/auth/login`,{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({email:fixture.staff.email,password:fixture.password,deviceId,deviceName:'Acceptance staff phone',devicePublicKey:publicKey})});assert.equal(login.status,200);const staffSession=await login.json();
 await navigate('devices');await click('Refresh');
 await page.eval(id=>{const row=Array.from(document.querySelectorAll('tr')).find(r=>Array.from(r.querySelectorAll('[title]')).some(n=>n.title===id));if(!row)throw Error('Device not listed');row.querySelector('button').click();},deviceId);await click('Revoke device','dialog button');
 directory=await readDirectory();assert.equal(directory.devices.find(d=>d.id===deviceId).active,false);
 const staffRead=await fetch(`${fixture.origin}/v1/me`,{headers:{Authorization:`Bearer ${staffSession.accessToken}`}});assert.equal(staffRead.status,401);
 await navigate('security');await click('Replace recovery codes');
 await page.eval(({password,recoveryCode})=>{document.querySelector('dialog [name=password]').value=password;document.querySelector('dialog [name=method]').value='recoveryCode';document.querySelector('dialog [name=mfaCode]').value=recoveryCode;document.querySelector('dialog form').requestSubmit();},{password:fixture.password,recoveryCode:fixture.recoveryCodes[resume?2:1]});await pause();
 const recoveryCodes=await page.eval(()=>Array.from(document.querySelectorAll('dialog .codes li')).map(li=>li.textContent));assert.equal(recoveryCodes.length,10);await click('I have saved these codes');assert.equal(await page.eval(()=>document.querySelectorAll('.codes').length),0);
 const financial=await page.eval(async businessId=>{const endpoints=[`/v1/businesses/${businessId}/bills`,`/admin/api/businesses/${businessId}/bills`,'/admin/tests/browser-smoke.mjs'];return Promise.all(endpoints.map(async path=>({path,status:(await fetch(path)).status})));},business.id);assert.equal(financial[0].status,401);assert.equal(financial[1].status,404);assert.equal(financial[2].status,404);
 await navigate('activity');await click('Refresh');assert.ok(await page.eval(()=>document.querySelector('table').textContent.includes('membership.created')));await page.screenshot({path:resolve(artifacts,'activity-desktop.jpg')});
 await navigate('access');await page.setViewport({width:390,height:844});await page.screenshot({path:resolve(artifacts,'access-phone.jpg')});assert.equal(await page.eval(()=>document.documentElement.scrollWidth>innerWidth),false);
 await click('Menu');await click('Sign out');assert.equal(await page.eval(()=>document.querySelector('h1').textContent),'Sign in to Admin');
 // A new code signs in; an old set code fails after rotation.
 const attempt=async(code)=>{await page.eval(()=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Recovery code').click());await page.eval(({email,password,code})=>{document.querySelector('[name=email]').value=email;document.querySelector('[name=password]').value=password;document.querySelector('[name=recoveryCode]').value=code;document.querySelector('form').requestSubmit();},{email:fixture.email,password:fixture.password,code});await new Promise(r=>setTimeout(r,400));};
 await attempt(fixture.recoveryCodes[resume?3:2]);assert.equal(await page.eval(()=>document.querySelector('h1').textContent),'Sign in to Admin');assert.ok(await page.eval(()=>Boolean(document.querySelector('.error-text'))));await attempt(recoveryCodes[0]);assert.equal(await page.eval(()=>document.querySelector('h1').textContent),'Access');
 assert.deepEqual(page.consoleErrors,[]);assert.deepEqual(csp,[]);off();
 console.log((resume?'PASS remaining checks (setup passed in prior run): ':'PASS real backend: ')+ ' recovery-code sign-in, HttpOnly Strict cookie, directory, staff assignment/removal/reactivation/reassignment, business/account creation, search empty state, staff device enrolment/revocation with token rejection, recovery rotation and old-code rejection/new-code login, financial isolation, production static allowlist, audit activity, 390px layout, no JS/CSP errors.');
}finally{await browser.close();}
