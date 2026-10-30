import { pool } from '../config.js';
// Owners receive access-change notices at sync; this does not add a push category.
export async function listAccessNotices(businessId){
 return (await pool.query("SELECT a.id,a.action,a.created_at,actor.email actor_email,target.email target_email FROM audit_events a JOIN users actor ON actor.id=a.actor_id LEFT JOIN users target ON target.id=a.entity_id WHERE a.business_id=$1 AND a.action IN ('membership.created','membership.reactivated','membership.deactivated') ORDER BY a.id DESC LIMIT 100",[businessId])).rows;
}
