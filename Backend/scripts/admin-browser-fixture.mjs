// Short-lived development fixture for real-browser acceptance, never production.
import { Pool } from 'pg';
import { randomUUID,randomBytes,createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { writeFile,unlink } from 'node:fs/promises';
if(!process.env.TEST_DATABASE_URL)throw Error('TEST_DATABASE_URL required');
const admin=new Pool({connectionString:process.env.TEST_DATABASE_URL});
const name=`billease_tdd_admin_ui_${randomBytes(6).toString('hex')}`,url=new URL(process.env.TEST_DATABASE_URL);url.pathname=`/${name}`;
await admin.query(`CREATE DATABASE "${name}"`);
Object.assign(process.env,{APP_ENV:'development',DATABASE_ENV:'development',DATABASE_URL:url.href,JWT_SECRET:randomBytes(32).toString('hex'),MFA_ENCRYPTION_KEY:randomBytes(32).toString('hex'),PUSH_ENABLED:'false'});
delete process.env.DATABASE_URL_POOLED;
let server,pool,cleaned=false;
const stateFile='/tmp/billease-admin-browser-fixture.json';
async function cleanup(){if(cleaned)return;cleaned=true;if(server){server.closeAllConnections();await new Promise(r=>server.close(r));}if(pool)await pool.end();await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);await admin.end();await unlink(stateFile).catch(()=>{});}
process.on('SIGTERM',()=>cleanup().then(()=>process.exit()));process.on('SIGINT',()=>cleanup().then(()=>process.exit()));
try{
 const migrated=spawnSync(process.execPath,['src/migrate.js'],{env:process.env,stdio:'inherit'});if(migrated.status!==0)throw Error('Fixture migration failed');
 ({pool}=await import('../src/config.js'));
 const {hashPassword}=await import('../src/auth.js');
 const {generateSecret}=await import('otplib');const {encryptSecret}=await import('../src/utils/mfa.js');
 const {createBusiness,createUser,createMembership}=await import('../src/services/accounts.js');
 const userId=randomUUID(),password=randomBytes(20).toString('hex'),email='admin@billease.example.test',secret=generateSecret();
 await pool.query('INSERT INTO users(id,email,password_hash,is_admin) VALUES ($1,$2,$3,true)',[userId,email,await hashPassword(password)]);
 await pool.query('INSERT INTO mfa_enrolments(user_id,secret,active) VALUES ($1,$2,true)',[userId,encryptSecret(secret)]);
 const recoveryCodes=[];for(let n=0;n<10;n++){const code=randomBytes(16).toString('hex');recoveryCodes.push(code);await pool.query('INSERT INTO recovery_codes(user_id,code_hash) VALUES ($1,$2)',[userId,createHash('sha256').update(code).digest('hex')]);}
 const businesses=[];for(const businessName of ['Narmada Textiles','Central Hardware','Station Road Supplies']){const business=await createBusiness({id:randomUUID(),name:businessName},userId);businesses.push(business);}
 const owner=await createUser({id:randomUUID(),email:'owner@example.test',password},userId),staff=await createUser({id:randomUUID(),email:'staff@example.test',password},userId);
 await createMembership({userId:owner.id,businessId:businesses[0].id,role:'owner'},userId);
 const {default:app}=await import('../src/app.js');server=app.listen(0,'127.0.0.1');await new Promise(r=>server.once('listening',r));
 await writeFile(stateFile,JSON.stringify({origin:`http://127.0.0.1:${server.address().port}`,email,password,secret,recoveryCodes,businesses,owner,staff,maintenanceDatabase:name}),{mode:0o600});
 console.log(`Disposable admin website ready; fixture state at ${stateFile}`);
}catch(error){await cleanup();throw error;}
