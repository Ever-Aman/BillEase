import { createHash, createHmac, createCipheriv, createDecipheriv, randomBytes, randomUUID, generateKeyPairSync, timingSafeEqual } from 'node:crypto';
import { jwtVerify } from 'jose';
import { environment, jwtKey, pool, transaction } from '../config.js';
import { login, refreshSession, logoutSession } from './accounts.js';
const encryptionKey=createHmac('sha256',jwtKey).update('billease/admin-browser-session/v1').digest();
export const browserCookie = environment==='production'?'__Secure-billease_admin':'billease_admin_development';
const digest=(value)=>createHash('sha256').update(value).digest('hex');
function encrypt(value){const iv=randomBytes(12),cipher=createCipheriv('aes-256-gcm',encryptionKey,iv);const ciphertext=Buffer.concat([cipher.update(JSON.stringify(value),'utf8'),cipher.final()]);return Buffer.concat([iv,cipher.getAuthTag(),ciphertext]).toString('base64url');}
function decrypt(value){const bytes=Buffer.from(value,'base64url'),cipher=createDecipheriv('aes-256-gcm',encryptionKey,bytes.subarray(0,12));cipher.setAuthTag(bytes.subarray(12,28));return JSON.parse(Buffer.concat([cipher.update(bytes.subarray(28)),cipher.final()]).toString('utf8'));}
export function cookieToken(req){const pairs=(req.headers.cookie??'').split(';');const value=pairs.map((p)=>p.trim()).find((p)=>p.startsWith(`${browserCookie}=`))?.slice(browserCookie.length+1);return /^[a-f0-9]{64}$/.test(value??'')?value:null;}
export function writeBrowserCookie(res,token){res.cookie(browserCookie,token,{httpOnly:true,secure:environment==='production',sameSite:'strict',path:'/admin',maxAge:8*60*60*1000});}
export function clearBrowserCookie(res){res.clearCookie(browserCookie,{httpOnly:true,secure:environment==='production',sameSite:'strict',path:'/admin'});}
export function csrfMatches(actual,expected){if(typeof actual!=='string'||typeof expected!=='string')return false;const a=Buffer.from(actual),b=Buffer.from(expected);return a.length===b.length&&timingSafeEqual(a,b);}
export async function startBrowserSession(input){
 const deviceId=randomUUID(),{publicKey}=generateKeyPairSync('ed25519');
 const tokens=await login(input.email,input.password,deviceId,'BillEase Admin browser',input.mfaCode,input.recoveryCode,publicKey.export({format:'der',type:'spki'}).toString('base64'));
 try{
  const {payload}=await jwtVerify(tokens.accessToken,jwtKey,{issuer:'billease',audience:'billease-api',algorithms:['HS256']});
  const user=(await pool.query('SELECT id,email,is_admin FROM users WHERE id=$1 AND active=true',[payload.sub])).rows[0];
  if(!user?.is_admin)throw Object.assign(Error('Admin access required'),{status:403});
  const token=randomBytes(32).toString('hex'),csrfToken=randomBytes(32).toString('hex');
  await pool.query('INSERT INTO admin_web_sessions(token_hash,user_id,device_id,token_state,csrf_token) VALUES ($1,$2,$3,$4,$5)',[digest(token),user.id,deviceId,encrypt(tokens),csrfToken]);
  await pool.query("INSERT INTO audit_events(actor_id,action,entity_id,device_id) VALUES ($1,'admin.browser.login',$1,$2)",[user.id,deviceId]);
  return {token,csrfToken,user:{id:user.id,email:user.email,isAdmin:true},environment};
 }catch(error){await logoutSession(tokens.refreshToken);throw error;}
}
// Serialize refresh in PostgreSQL, so concurrent browser tabs never replay a rotated token.
export async function readBrowserSession(token){
 if(!token)return null;
 return transaction(async(db)=>{
  const row=(await db.query('SELECT * FROM admin_web_sessions WHERE token_hash=$1 FOR UPDATE',[digest(token)])).rows[0];
  if(!row)return null;
  if(new Date(row.expires_at)<=new Date()||Date.now()-new Date(row.last_seen_at).getTime()>30*60*1000){
   await db.query('DELETE FROM admin_web_sessions WHERE token_hash=$1',[digest(token)]);
   await db.query('UPDATE refresh_sessions SET revoked_at=now() WHERE device_id=$1 AND revoked_at IS NULL',[row.device_id]);
   return null;
  }
  let tokens;
  try { tokens=decrypt(row.token_state); } catch {
   await db.query('DELETE FROM admin_web_sessions WHERE token_hash=$1',[digest(token)]);
   await db.query('UPDATE refresh_sessions SET revoked_at=now() WHERE device_id=$1 AND revoked_at IS NULL',[row.device_id]);
   return null;
  }
  try{await jwtVerify(tokens.accessToken,jwtKey,{issuer:'billease',audience:'billease-api',algorithms:['HS256'],clockTolerance:0});}
  catch{
   try{tokens=await refreshSession(tokens.refreshToken,db);}
   catch(error){if(error.status!==401&&error.status!==403)throw error;await db.query('DELETE FROM admin_web_sessions WHERE token_hash=$1',[digest(token)]);return null;}
  }
  await db.query('UPDATE admin_web_sessions SET token_state=$2,last_seen_at=now() WHERE token_hash=$1',[digest(token),encrypt(tokens)]);
  return {...row,accessToken:tokens.accessToken,refreshToken:tokens.refreshToken};
 });
}
export async function endBrowserSession(token){
 if(!token)return;
 const row=(await pool.query('DELETE FROM admin_web_sessions WHERE token_hash=$1 RETURNING token_state,device_id',[digest(token)])).rows[0];
 if(row){
  try{const tokens=decrypt(row.token_state);await logoutSession(tokens.refreshToken);}
  catch(error){await pool.query('UPDATE refresh_sessions SET revoked_at=now() WHERE device_id=$1 AND revoked_at IS NULL',[row.device_id]);}
  await pool.query('UPDATE devices SET active=false WHERE id=$1',[row.device_id]);
 }
}
