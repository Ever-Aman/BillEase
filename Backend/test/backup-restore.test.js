import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { Pool } from "pg";
import { pool } from "../src/config.js";
import { saleFixture } from "./helpers/fixtures.js";

if (
  process.env.APP_ENV !== "development" ||
  !new URL(process.env.DATABASE_URL).pathname.includes("_tdd_")
)
  throw new Error("Isolated development database required");
test("encrypted backup restores current schema, ledger and fulfilment into a separate database", async () => {
  const directory = await mkdtemp(join(tmpdir(), "billease-backup-test-"));
  const name = `billease_tdd_restore_${randomBytes(6).toString("hex")}`;
  let restored,
    created = false;
  try {
    await saleFixture();
    const passphrase = randomBytes(32).toString("hex");
    execFileSync("bash", ["scripts/backup.sh"], {
      env: {
        ...process.env,
        BACKUP_DIR: directory,
        BACKUP_PASSPHRASE: passphrase,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    const file = (await readdir(directory)).find((x) =>
      x.endsWith(".dump.gpg"),
    );
    assert.ok(file);
    const dump = execFileSync(
      "gpg",
      [
        "--batch",
        "--quiet",
        "--pinentry-mode",
        "loopback",
        "--passphrase-fd",
        "0",
        "--decrypt",
        join(directory, file),
      ],
      {
        input: `${passphrase}\n`,
        maxBuffer: 10000000,
        stdio: ["pipe", "pipe", "pipe"],
      },
    );
    await pool.query(`CREATE DATABASE "${name}"`);
    created = true;
    const url = new URL(process.env.DATABASE_URL);
    url.pathname = `/${name}`;
    execFileSync(
      "pg_restore",
      [
        "--exit-on-error",
        "--no-owner",
        "--no-privileges",
        "--dbname",
        url.href,
      ],
      { input: dump, stdio: ["pipe", "pipe", "pipe"] },
    );
    restored = new Pool({ connectionString: url.href });
    const row = (
      await restored.query(
        "SELECT (SELECT COUNT(*)::integer FROM bills) bills,(SELECT SUM(debt_delta_minor)::text FROM customer_ledger) debt,(SELECT billed_canonical::text FROM bill_line_quantities LIMIT 1) billed",
      )
    ).rows[0];
    assert.equal(row.bills, 1);
    assert.equal(row.debt, "2000");
    assert.equal(Number(row.billed), 20);
  } finally {
    if (restored) await restored.end();
    if (created) await pool.query(`DROP DATABASE "${name}" WITH (FORCE)`);
    await rm(directory, { recursive: true, force: true });
    await pool.end();
  }
});
