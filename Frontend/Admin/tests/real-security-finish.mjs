// Continues a disposable acceptance run after setup and initial recovery rotation.
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const fixture=JSON.parse(await readFile('/tmp/billease-admin-browser-fixture.json','utf8'));
const {generate}=await import(resolve('Backend/node_modules/otplib/dist/index.js'));
const {Browser}=await import('/home/neveraman/.codex/plugins/cache/taste-skill/taste-skill/2.1.5/skills/taste-skill/scripts/lib/cdp.mjs');
const browser=await Browser.launch();const pause=()=>new Promise(r=>setTimeout(r,350));
try{
 const page=await browser.newPage();const csp=[];await page.send('Log.enable');browser.on(page.sessionId,'Log.entryAdded',({entry})=>{if(/content.security|refused to|violat.*policy/i.test(entry.text))csp.push(entry.text);});
 await page.goto(`${fixture.origin}/admin/`,{settleMs:200});
 await new Promise(r=>setTimeout(r,31000-(Date.now()%30000)));
 const code=await generate({secret:fixture.secret});const loginStep=Math.floor(Date.now()/30000);
 await page.eval(({email,password,code})=>{document.querySelector('[name=email]').value=email;document.querySelector('[name=password]').value=password;document.querySelector('[name=mfaCode]').value=code;document.querySelector('form').requestSubmit();},{email:fixture.email,password:fixture.password,code});await pause();assert.equal(await page.eval(()=>document.querySelector('h1').textContent),'Access');
 const click=async(label,selector='button')=>{await page.eval(({label,selector})=>{const node=Array.from(document.querySelectorAll(selector)).find(n=>n.textContent===label);if(!node)throw Error('Control missing');node.click();},{label,selector});await pause();};
 await page.eval(()=>location.hash='activity');await pause();await click('Refresh');assert.ok(await page.eval(()=>document.querySelector('table').textContent.includes('membership.created')));await page.screenshot({path:resolve('Frontend/Admin/tests/real-artifacts/activity-desktop.jpg')});
 await page.eval(()=>location.hash='access');await pause();await page.setViewport({width:390,height:844});await page.screenshot({path:resolve('Frontend/Admin/tests/real-artifacts/access-phone.jpg')});assert.equal(await page.eval(()=>document.documentElement.scrollWidth>innerWidth),false);
 await page.setViewport({width:1440,height:900});await page.eval(()=>location.hash='security');await pause();await click('Replace recovery codes');
 // A fresh time step prevents replay of the TOTP consumed by the preceding login.
 while(Math.floor(Date.now()/30000)===loginStep)await new Promise(r=>setTimeout(r,500));
 const proof=await generate({secret:fixture.secret});await page.eval(({password,code})=>{document.querySelector('dialog [name=password]').value=password;document.querySelector('dialog [name=mfaCode]').value=code;document.querySelector('dialog form').requestSubmit();},{password:fixture.password,code:proof});await pause();
 const codes=await page.eval(()=>Array.from(document.querySelectorAll('dialog .codes li')).map(n=>n.textContent));assert.equal(codes.length,10);await click('I have saved these codes');assert.equal(await page.eval(()=>document.querySelectorAll('.codes').length),0);await click('Sign out');
 const login=async recoveryCode=>{await click('Recovery code');await page.eval(({email,password,recoveryCode})=>{document.querySelector('[name=email]').value=email;document.querySelector('[name=password]').value=password;document.querySelector('[name=recoveryCode]').value=recoveryCode;document.querySelector('form').requestSubmit();},{email:fixture.email,password:fixture.password,recoveryCode});await pause();};
 await login(fixture.recoveryCodes[3]);assert.equal(await page.eval(()=>document.querySelector('h1').textContent),'Sign in to Admin');assert.ok(await page.eval(()=>Boolean(document.querySelector('.error-text'))));await login(codes[0]);assert.equal(await page.eval(()=>document.querySelector('h1').textContent),'Security');
 assert.deepEqual(page.consoleErrors,[]);assert.deepEqual(csp,[]);
 console.log('PASS final real backend checks: refreshed audit activity, desktop/phone screenshots, no overflow, fresh-TOTP recovery rotation,10 codes removed on close, old recovery set rejected and new recovery code accepted, no JS/CSP errors.');
}finally{await browser.close();}
