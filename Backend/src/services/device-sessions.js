import { pool, transaction } from "../config.js";
export async function listOwnDevices(userId, sessionId) {
  return (
    await pool.query(
      "SELECT d.id,d.name,d.active,d.last_seen_at,d.created_at,d.offline_expires_at,EXISTS(SELECT 1 FROM refresh_sessions s WHERE s.id=$2 AND s.device_id=d.id AND s.revoked_at IS NULL) current FROM devices d WHERE d.user_id=$1 ORDER BY d.last_seen_at DESC,d.id",
      [userId, sessionId],
    )
  ).rows;
}
export async function revokeOwnDevice(userId, deviceId) {
  return transaction(async (db) => {
    await db.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]);
    const device = await db.query(
      "UPDATE devices SET active=false WHERE user_id=$1 AND id=$2 RETURNING id",
      [userId, deviceId],
    );
    if (!device.rowCount)
      throw Object.assign(new Error("Device unavailable"), { status: 404 });
    await db.query(
      "UPDATE refresh_sessions SET revoked_at=now() WHERE device_id=$1 AND revoked_at IS NULL",
      [deviceId],
    );
    await db.query("DELETE FROM push_tokens WHERE device_id=$1", [deviceId]);
    await db.query(
      "INSERT INTO audit_events(actor_id,action,entity_id) VALUES ($1,'device.revoked_by_user',$2)",
      [userId, deviceId],
    );
    return { deviceId, revoked: true };
  });
}
export async function logoutAllDevices(userId) {
  return transaction(async (db) => {
    await db.query("SELECT id FROM users WHERE id=$1 FOR UPDATE", [userId]);
    await db.query(
      "UPDATE refresh_sessions SET revoked_at=now() WHERE user_id=$1 AND revoked_at IS NULL",
      [userId],
    );
    await db.query(
      "DELETE FROM push_tokens p USING devices d WHERE p.device_id=d.id AND d.user_id=$1",
      [userId],
    );
    await db.query(
      "INSERT INTO audit_events(actor_id,action,entity_id) VALUES ($1,'sessions.logout_all',$1)",
      [userId],
    );
    return { loggedOut: true };
  });
}
