// Isolated mock API for browser verification only. Never imported by the production client.
// Run: node Frontend/Admin/tests/browser-smoke.mjs
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {readFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
import {dirname,resolve,extname} from 'node:path';
const skillRoot=process.env.TASTE_SKILL_ROOT||'/home/neveraman/.codex/plugins/cache/taste-skill/taste-skill/2.1.5/skills/taste-skill';
const {Browser}=await import(`${skillRoot}/scripts/lib/cdp.mjs`);
const base=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const artifacts=resolve(base,'tests/artifacts');await mkdir(artifacts,{recursive:true});
const ids={owner:'11111111-1111-4111-8111-111111111111',staff:'22222222-2222-4222-8222-222222222222',business:'33333333-3333-4333-8333-333333333333'};
const directory={businesses:[{id:ids.business,name:'Narmada Textiles',document_mode:'regular_gst'}],users:[{id:ids.owner,email:'owner@example.test',active:true,is_admin:false,mfa_enabled:true},{id:ids.staff,email:'staff@example.test',active:true,is_admin:false,mfa_enabled:false}],memberships:[{business_id:ids.business,user_id:ids.owner,role:'owner',active:true}],devices:[{id:'test-device',user_id:ids.staff,name:'<img src=x onerror=alert(1)>',active:true,created_at:'2026-10-28T08:00:00Z',last_seen_at:'2026-10-29T08:00:00Z'}],auditEvents:[{id:'test-audit',actor_id:ids.owner,business_id:ids.business,action:'membership.created',entity_id:ids.owner,received_at:'2026-10-29T08:00:00Z'}]};
let signedIn=process.argv.includes('--serve');let creations=0;let revoked=0;let requestBodies=[];
const session={user:{id:'test-admin',email:'admin@example.test',isAdmin:true},csrfToken:'test-csrf',environment:'Isolated browser test'};
const server=createServer(async(req,res)=>{
  const url=new URL(req.url,'http://local');
  if(url.pathname.startsWith('/admin/api/')){
    assert.equal(req.headers['x-requested-with'],'BillEaseAdmin');
    let chunks=[];for await(const chunk of req)chunks.push(chunk);const raw=Buffer.concat(chunks).toString();const body=raw?JSON.parse(raw):{};
    if(req.method!=='GET' && url.pathname!=='/admin/api/login')assert.equal(req.headers['x-csrf-token'],'test-csrf');
    const send=(data,status=200)=>{res.writeHead(status,{'Content-Type':'application/json','Cache-Control':'no-store'});res.end(JSON.stringify(data));};
    if(url.pathname==='/admin/api/session')return send(signedIn?session:{error:'Sign in required'},signedIn?200:401);
    if(url.pathname==='/admin/api/login'){assert.equal(body.mfaCode,'123456');signedIn=true;return send(session);}
    if(url.pathname==='/admin/api/logout'){signedIn=false;return send({ok:true});}
    if(!signedIn)return send({error:'Sign in required'},401);
    if(url.pathname==='/admin/api/directory')return send(directory);
    if(url.pathname==='/admin/api/mfa')return send({active:true,pending:false});
    if(url.pathname==='/admin/api/mfa/recovery-codes')return send({recoveryCodes:['test-code-alpha','test-code-beta']});
    if(url.pathname==='/admin/api/businesses' && req.method==='POST'){requestBodies.push(body);if(!directory.businesses.some(b=>b.id===body.id)){creations++;assert.ok(['composition','regular_gst'].includes(body.documentMode));directory.businesses.push({id:body.id,name:body.name,document_mode:body.documentMode});}req.socket.destroy();return;}
    if(url.pathname==='/admin/api/memberships'){directory.memberships.push({user_id:body.userId,business_id:body.businessId,role:body.role,active:true});return send({ok:true});}
    if(url.pathname==='/admin/api/devices/test-device' && req.method==='DELETE'){revoked++;directory.devices[0].active=false;return send({ok:true});}
    return send({error:'Unexpected test endpoint'},404);
  }
  try{const path=resolve(base,'.'+decodeURIComponent(url.pathname.replace(/^\/admin/ ,''))+(url.pathname.endsWith('/')?'index.html':''));if(!path.startsWith(base+'/'))throw Error();const data=await readFile(path);res.writeHead(200,{'Content-Type':{'.html':'text/html','.js':'text/javascript','.mjs':'text/javascript','.css':'text/css','.svg':'image/svg+xml','.ttf':'font/ttf'}[extname(path)]||'application/octet-stream'});res.end(data);}catch{res.writeHead(404);res.end();}
});
await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));const url=`http://127.0.0.1:${server.address().port}/admin/`;
if(process.argv.includes('--serve')){console.log(`Isolated test fixture: ${url}`);await new Promise(()=>{});}
const browser=await Browser.launch();
try{
  const page=await browser.newPage();await page.goto(url,{settleMs:400});
  assert.equal(await page.eval(()=>document.querySelector('h1').textContent),'Sign in to Admin');
  await page.screenshot({path:resolve(artifacts,'login-desktop.jpg')});
  await page.eval(()=>{document.querySelector('[name=email]').value='admin@example.test';document.querySelector('[name=password]').value='test-password-long';document.querySelector('[name=mfaCode]').value='123456';document.querySelector('form').requestSubmit();});
  await new Promise(r=>setTimeout(r,350));assert.equal(await page.eval(()=>document.querySelector('h1').textContent),'Access');
  assert.equal(await page.eval(()=>localStorage.length+sessionStorage.length),0);
  await page.screenshot({path:resolve(artifacts,'access-desktop.jpg')});
  await page.eval(()=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Assign access').click());
  await page.eval(({staff,business})=>{document.querySelector('[name=userId]').value=staff;document.querySelector('[name=businessId]').value=business;document.querySelector('[name=role]').value='staff';document.querySelector('dialog form').requestSubmit();},ids);
  await new Promise(r=>setTimeout(r,200));assert.equal(directory.memberships.length,2);
  await page.eval(()=>location.hash='businesses');await new Promise(r=>setTimeout(r,100));
  await page.eval(()=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='New business').click());
  await page.eval(()=>{document.querySelector('dialog [name=name]').value='Lost-response business';document.querySelector('dialog [name=documentMode]').value='composition';document.querySelector('dialog form').requestSubmit();});
  await new Promise(r=>setTimeout(r,200));assert.equal(creations,1);assert.ok(requestBodies.every(body=>JSON.stringify(body)===JSON.stringify(requestBodies[0])));assert.ok(await page.eval(()=>document.querySelector('dialog .error-text').textContent.includes('original request')));
  await page.eval(()=>document.querySelector('dialog form').requestSubmit());await new Promise(r=>setTimeout(r,200));assert.equal(creations,1);assert.equal(await page.eval(()=>document.querySelectorAll('dialog').length),0);
  await page.eval(()=>location.hash='devices');await new Promise(r=>setTimeout(r,100));
  assert.equal(await page.eval(()=>document.querySelectorAll('table img').length),0);assert.ok(await page.eval(()=>document.querySelector('table').textContent.includes('<img src=x')));
  await page.eval(()=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Revoke device').click());assert.equal(revoked,0);
  assert.ok(await page.eval(()=>document.querySelector('dialog').textContent.includes('staff@example.test')));
  await page.eval(()=>Array.from(document.querySelectorAll('dialog button')).find(b=>b.textContent==='Revoke device').click());await new Promise(r=>setTimeout(r,150));assert.equal(revoked,1);
  for(const view of ['access','businesses','accounts','devices','activity','security']){await page.eval(v=>location.hash=v,view);await new Promise(r=>setTimeout(r,100));assert.equal(await page.eval(()=>document.querySelector('h1').textContent),view[0].toUpperCase()+view.slice(1));}
  await page.eval(()=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='Replace recovery codes').click());
  await page.eval(()=>{document.querySelector('dialog [name=password]').value='test-password-long';document.querySelector('dialog [name=mfaCode]').value='123456';document.querySelector('dialog form').requestSubmit();});await new Promise(r=>setTimeout(r,100));assert.ok(await page.eval(()=>document.querySelector('dialog').textContent.includes('test-code-alpha')));
  await page.eval(()=>Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='I have saved these codes').click());assert.equal(await page.eval(()=>document.body.textContent.includes('test-code-alpha')),false);
  await page.eval(()=>location.hash='access');await new Promise(r=>setTimeout(r,100));
  for(const width of [768,390]){await page.setViewport({width,height:width===390?844:1024});await page.screenshot({path:resolve(artifacts,`access-${width}.jpg`)});assert.equal(await page.eval(()=>document.documentElement.scrollWidth>innerWidth),false);assert.equal(await page.eval(()=>getComputedStyle(document.querySelector('.sidebar')).display),'none');}
  await page.eval(()=>document.querySelector('.mobile-header button').click());assert.equal(await page.eval(()=>document.querySelector('.mobile-header button').getAttribute('aria-expanded')),'true');
  assert.deepEqual(page.consoleErrors,[]);
  console.log('PASS: sign-in, CSRF headers, all views, role assignment, lost-response reconciliation, escaped fields, named revocation, one-time codes, responsive widths, and no browser credential storage.');
}finally{await browser.close();server.closeAllConnections();server.close();}
