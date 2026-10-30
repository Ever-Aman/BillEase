import { pool } from "../config.js";
export async function adminDirectory() {
  const queries = [
    [
      "businesses",
      'SELECT id,name,document_mode,document_mode AS "documentMode" FROM businesses ORDER BY name,id LIMIT 501',
    ],
    [
      "users",
      "SELECT u.id,u.email,u.active,u.is_admin,EXISTS(SELECT 1 FROM mfa_enrolments e WHERE e.user_id=u.id AND e.active) mfa_enabled FROM users u ORDER BY email,id LIMIT 501",
    ],
    [
      "memberships",
      "SELECT business_id,user_id,role,active FROM memberships ORDER BY business_id,user_id LIMIT 1001",
    ],
    [
      "devices",
      "SELECT id,user_id,name,active,last_seen_at,created_at FROM devices ORDER BY last_seen_at DESC,id LIMIT 501",
    ],
    [
      "auditEvents",
      "SELECT id,actor_id,business_id,action,entity_id,created_at FROM audit_events WHERE action IN ('business.created','user.created','membership.created','membership.reactivated','membership.deactivated','device.deactivated','admin.browser.login','mfa.setup_started','mfa.enabled','mfa.recovery_codes_rotated','mfa.disabled') AND (action NOT LIKE 'mfa.%' OR EXISTS (SELECT 1 FROM users u WHERE u.id=audit_events.actor_id AND u.is_admin=true)) ORDER BY id DESC LIMIT 100",
    ],
  ];
  const values = await Promise.all(
    queries.map(async ([key, sql]) => [key, (await pool.query(sql)).rows]),
  );
  const result = Object.fromEntries(values);
  result.truncated =
    result.businesses.length > 500 ||
    result.users.length > 500 ||
    result.memberships.length > 1000 ||
    result.devices.length > 500;
  result.businesses = result.businesses.slice(0, 500);
  result.users = result.users.slice(0, 500);
  result.devices = result.devices.slice(0, 500);
  result.memberships = result.memberships.slice(0, 1000);
  return result;
}
