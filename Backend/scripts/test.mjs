import { Pool } from "pg";
import { randomBytes } from "node:crypto";
import { readdir } from "node:fs/promises";
import { spawnSync } from "node:child_process";

if (!process.env.TEST_DATABASE_URL)
  throw new Error(
    "Set TEST_DATABASE_URL to a development PostgreSQL maintenance database",
  );
const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const files = process.argv.slice(2).length
  ? process.argv.slice(2)
  : (await readdir("test"))
      .filter((x) => x.endsWith(".test.js"))
      .map((x) => `test/${x}`);
let failed = false;
try {
  for (const file of files) {
    const name = `billease_tdd_${randomBytes(6).toString("hex")}`;
    const url = new URL(process.env.TEST_DATABASE_URL);
    url.pathname = `/${name}`;
    await admin.query(`CREATE DATABASE "${name}"`);
    try {
      const env = {
        ...process.env,
        APP_ENV: "development",
        DATABASE_ENV: "development",
        DATABASE_URL: url.href,
        JWT_SECRET: randomBytes(32).toString("hex"),
        MFA_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
        PUSH_ENABLED: "false",
      };
      delete env.DATABASE_URL_POOLED;
      for (const args of [["src/migrate.js"], ["--test", file]]) {
        const result = spawnSync(process.execPath, args, {
          env,
          stdio: "inherit",
        });
        if (result.error) throw result.error;
        if (result.status !== 0) {
          failed = true;
          break;
        }
      }
    } finally {
      try {
        await admin.query(`DROP DATABASE "${name}" WITH (FORCE)`);
      } catch (error) {
        // FORCE can try to signal a PostgreSQL background worker owned by a
        // different role. Ordinary DROP handles idle owned test databases
        // without granting the test role process-signalling privileges.
        if (error.code !== "42501") throw error;
        await admin.query(`DROP DATABASE "${name}"`);
      }
    }
  }
} finally {
  await admin.end();
}
if (failed) process.exitCode = 1;
