import test from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { Pool } from "pg";
import { spawnSync } from "node:child_process";

function loadConfig({ appEnv = "development", directUrl, pooledUrl } = {}) {
  const env = {
    PATH: process.env.PATH,
    APP_ENV: appEnv,
    DATABASE_ENV: appEnv,
    DATABASE_URL: directUrl ?? "postgres://direct.example.test/billease",
    JWT_SECRET: "x".repeat(32),
    MFA_ENCRYPTION_KEY: "a".repeat(64),
  };
  if (pooledUrl) env.DATABASE_URL_POOLED = pooledUrl;
  const result = spawnSync(
    process.execPath,
    [
      "--input-type=module",
      "-e",
      "try { const { directPool, pool } = await import('./src/config.js'); process.stdout.write(JSON.stringify({direct: directPool.options.connectionString, runtime: pool.options.connectionString})); await pool.end(); if (pool !== directPool) await directPool.end(); } catch (error) { process.stderr.write(error.message); process.exitCode = 1; }",
    ],
    { env, encoding: "utf8" },
  );
  return result;
}

test("runtime uses optional pooled URL and otherwise uses direct URL", () => {
  const pooled = loadConfig({
    pooledUrl: "postgres://pooled.example.test/billease",
  });
  assert.equal(pooled.status, 0, pooled.stderr);
  assert.deepEqual(JSON.parse(pooled.stdout), {
    direct: "postgres://direct.example.test/billease",
    runtime: "postgres://pooled.example.test/billease",
  });
  const direct = loadConfig();
  assert.equal(direct.status, 0, direct.stderr);
  assert.deepEqual(JSON.parse(direct.stdout), {
    direct: "postgres://direct.example.test/billease",
    runtime: "postgres://direct.example.test/billease",
  });
});

test("production requires TLS on both configured database URLs", () => {
  for (const urls of [
    {
      directUrl: "postgres://direct.example.test/billease",
      pooledUrl: "postgres://pooled.example.test/billease?sslmode=require",
    },
    {
      directUrl: "postgres://direct.example.test/billease?sslmode=require",
      pooledUrl: "postgres://pooled.example.test/billease",
    },
  ]) {
    const result = loadConfig({ appEnv: "production", ...urls });
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, /sslmode=require or verify-full/);
  }
});

test(
  "migrations connect to the direct URL even when the pooled URL is unreachable",
  { skip: !process.env.TEST_DATABASE_URL },
  async () => {
    const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
    const name = `billease_direct_migration_${randomBytes(6).toString("hex")}`;
    const directUrl = new URL(process.env.TEST_DATABASE_URL);
    directUrl.pathname = `/${name}`;
    await admin.query(`CREATE DATABASE "${name}"`);
    try {
      const env = {
        PATH: process.env.PATH,
        APP_ENV: "development",
        DATABASE_ENV: "development",
        DATABASE_URL: directUrl.href,
        DATABASE_URL_POOLED: "postgres://nobody@127.0.0.1:1/should_not_be_used",
        JWT_SECRET: "x".repeat(32),
        MFA_ENCRYPTION_KEY: "a".repeat(64),
      };
      const result = spawnSync(process.execPath, ["src/migrate.js"], {
        env,
        encoding: "utf8",
      });
      assert.equal(result.status, 0, "migration subprocess failed");
      assert.match(result.stdout, /Migration complete for development/);
    } finally {
      await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
      await admin.end();
    }
  },
);
