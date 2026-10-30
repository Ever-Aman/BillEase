import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { generate } from "otplib";
import { pool } from "../src/config.js";
import { hashPassword } from "../src/auth.js";
import { saleFixture } from "./helpers/fixtures.js";
import {
  beginMfa,
  confirmMfa,
  mfaStatus,
  rotateRecoveryCodes,
  disableMfa,
} from "../src/services/mfa-management.js";

if (
  process.env.APP_ENV !== "development" ||
  !new URL(process.env.DATABASE_URL).pathname.includes("_tdd_")
)
  throw new Error("Isolated development database required");
test("owner enrols MFA with proof, recovery rotation invalidates old codes, staff cannot enrol", async () => {
  try {
    const f = await saleFixture(),
      password = "a-strong-test-password";
    await pool.query("UPDATE users SET password_hash=$2 WHERE id IN ($1,$3)", [
      f.owner,
      await hashPassword(password),
      f.staff,
    ]);
    await assert.rejects(beginMfa(f.staff, { password }), /owner|admin/i);
    await assert.rejects(
      beginMfa(f.owner, { password: "wrong" }),
      /credentials/i,
    );
    const setup = await beginMfa(f.owner, { password });
    assert.match(setup.otpauthUri, /^otpauth:\/\/totp\//);
    const token = await generate({ secret: setup.secret });
    const confirmed = await confirmMfa(f.owner, { code: token });
    assert.equal(confirmed.recoveryCodes.length, 10);
    assert.equal((await mfaStatus(f.owner)).active, true);
    assert.equal(
      JSON.stringify(await mfaStatus(f.owner)).includes(setup.secret),
      false,
    );
    await assert.rejects(
      rotateRecoveryCodes(f.owner, { password, mfaCode: token }),
      /proof|MFA/i,
    );
    const rotated = await rotateRecoveryCodes(f.owner, {
      password,
      recoveryCode: confirmed.recoveryCodes[0],
    });
    assert.equal(rotated.recoveryCodes.length, 10);
    await pool.query("UPDATE users SET is_admin=true WHERE id=$1", [f.owner]);
    await assert.rejects(
      disableMfa(f.owner, randomUUID(), {
        password,
        recoveryCode: rotated.recoveryCodes[0],
      }),
      /admin/i,
    );
    await pool.query("UPDATE users SET is_admin=false WHERE id=$1", [f.owner]);
    await assert.rejects(
      disableMfa(f.owner, randomUUID(), {
        password,
        recoveryCode: confirmed.recoveryCodes[1],
      }),
      /proof|MFA/i,
    );
    await disableMfa(f.owner, randomUUID(), {
      password,
      recoveryCode: rotated.recoveryCodes[0],
    });
    assert.equal((await mfaStatus(f.owner)).active, false);
  } finally {
    await pool.end();
  }
});
