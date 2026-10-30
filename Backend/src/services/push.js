import { pool, transaction } from "../config.js";
import { encryptSecret, decryptSecret } from "../utils/mfa.js";
import { createFcmSender } from "./fcm.js";

let sender;
function messaging() {
  return (sender ??= createFcmSender());
}
export async function savePushToken(deviceId, userId, sessionId, token) {
  const device = await pool.query(
    "SELECT d.id FROM devices d JOIN refresh_sessions s ON s.device_id=d.id AND s.id=$3 AND s.revoked_at IS NULL WHERE d.id=$1 AND d.user_id=$2 AND d.active=true AND EXISTS(SELECT 1 FROM memberships m WHERE m.user_id=$2 AND m.role='owner' AND m.active=true)",
    [deviceId, userId, sessionId],
  );
  if (!device.rowCount)
    throw Object.assign(new Error("Owner device unavailable"), { status: 403 });
  await pool.query(
    "INSERT INTO push_tokens(device_id,token_ciphertext) VALUES ($1,$2) ON CONFLICT(device_id) DO UPDATE SET token_ciphertext=$2,updated_at=now()",
    [deviceId, encryptSecret(token)],
  );
  return { registered: true };
}
export async function removePushToken(deviceId, userId, sessionId) {
  await pool.query(
    "DELETE FROM push_tokens p USING devices d,refresh_sessions s WHERE p.device_id=d.id AND p.device_id=$1 AND d.user_id=$2 AND s.device_id=d.id AND s.id=$3 AND s.revoked_at IS NULL",
    [deviceId, userId, sessionId],
  );
  return { registered: false };
}
async function claimJobs() {
  return transaction(async (db) => {
    const { rows } = await db.query(
      "SELECT id FROM push_jobs WHERE (status='pending' AND run_at<=now()) OR (status='sending' AND locked_at<now()-interval '5 minutes') ORDER BY id FOR UPDATE SKIP LOCKED LIMIT 10",
    );
    if (!rows.length) return [];
    const ids = rows.map((x) => x.id);
    return (
      await db.query(
        "UPDATE push_jobs SET status='sending',locked_at=now(),attempts=attempts+1 WHERE id=ANY($1::bigint[]) RETURNING *",
        [ids],
      )
    ).rows;
  });
}
async function finish(job, success, error) {
  if (success) {
    await pool.query(
      "UPDATE push_jobs SET status='sent',sent_at=now(),locked_at=NULL,last_error=NULL WHERE id=$1",
      [job.id],
    );
    return;
  }
  const dead = job.attempts >= 10;
  const delay = Math.min(3600, 2 ** Math.min(job.attempts, 10) * 15);
  await pool.query(
    "UPDATE push_jobs SET status=$2,run_at=now()+($3::integer*interval '1 second'),locked_at=NULL,last_error=$4 WHERE id=$1",
    [job.id, dead ? "dead" : "pending", delay, error],
  );
}
async function deliver(job) {
  const pending =
    job.category === "staff_request"
      ? await pool.query(
          "SELECT 1 FROM requests WHERE business_id=$1 AND id=$2 AND state='pending'",
          [job.business_id, job.reference_id],
        )
      : await pool.query(
          "SELECT 1 FROM bills b WHERE b.business_id=$1 AND b.id=$2 AND (b.review_state='credit_pending' OR EXISTS(SELECT 1 FROM payments p WHERE p.business_id=b.business_id AND p.bill_id=b.id AND p.state='pending'))",
          [job.business_id, job.reference_id],
        );
  if (!pending.rowCount) {
    await finish(job, true);
    return;
  }
  const owners = await pool.query(
    "SELECT p.device_id,p.token_ciphertext FROM push_tokens p JOIN devices d ON d.id=p.device_id JOIN memberships m ON m.user_id=d.user_id AND m.business_id=$1 JOIN users u ON u.id=d.user_id WHERE d.user_id=$2 AND d.active=true AND u.active=true AND m.active=true AND m.role='owner' AND EXISTS(SELECT 1 FROM refresh_sessions s WHERE s.device_id=d.id AND s.revoked_at IS NULL AND s.expires_at>now())",
    [job.business_id, job.user_id],
  );
  if (!owners.rowCount) {
    await finish(job, false, "No active owner token");
    return;
  }
  let delivered = false,
    lastError = "Delivery failed";
  for (const owner of owners.rows) {
    try {
      await messaging().send({
        token: decryptSecret(owner.token_ciphertext),
        notification: {
          title: "Review needed",
          body: "Staff work needs your review.",
        },
        data: {
          businessId: job.business_id,
          referenceId: job.reference_id,
          category: job.category,
        },
      });
      delivered = true;
    } catch (error) {
      lastError = error.code || "FCM send failed";
      if (
        [
          "messaging/registration-token-not-registered",
          "messaging/invalid-registration-token",
        ].includes(error.code)
      )
        await pool.query("DELETE FROM push_tokens WHERE device_id=$1", [
          owner.device_id,
        ]);
    }
  }
  await finish(job, delivered, lastError);
}
export function startPushWorker() {
  if (process.env.PUSH_ENABLED !== "true") return () => {};
  messaging();
  let busy = false;
  const tick = async () => {
    if (busy) return;
    busy = true;
    try {
      for (const job of await claimJobs()) await deliver(job);
    } catch (error) {
      console.error("Push worker error:", error.code || error.message);
    } finally {
      busy = false;
    }
  };
  void tick();
  const timer = setInterval(tick, 10000);
  timer.unref();
  return () => clearInterval(timer);
}
