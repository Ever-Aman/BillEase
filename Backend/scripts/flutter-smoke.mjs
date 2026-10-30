// Disposable HTTP integration check for the Dart client. Never uses a live database.
import { Pool } from "pg";
import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { once } from "node:events";
if (!process.env.TEST_DATABASE_URL || !process.env.FLUTTER_BIN)
  throw new Error("Set TEST_DATABASE_URL and FLUTTER_BIN");
const admin = new Pool({ connectionString: process.env.TEST_DATABASE_URL });
const name = `billease_tdd_flutter_${randomBytes(6).toString("hex")}`;
const url = new URL(process.env.TEST_DATABASE_URL);
url.pathname = `/${name}`;
let server, pool;
try {
  await admin.query(`CREATE DATABASE "${name}"`);
  Object.assign(process.env, {
    APP_ENV: "development",
    DATABASE_ENV: "development",
    DATABASE_URL: url.href,
    JWT_SECRET: randomBytes(32).toString("hex"),
    MFA_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
    PUSH_ENABLED: "false",
  });
  delete process.env.DATABASE_URL_POOLED;
  const migrated = spawnSync(process.execPath, ["src/migrate.js"], {
    env: process.env,
    stdio: "inherit",
  });
  if (migrated.status !== 0) throw new Error("Test migration failed");
  ({ pool } = await import("../src/config.js"));
  const { saleFixture } = await import("../test/helpers/fixtures.js");
  const { hashPassword } = await import("../src/auth.js");
  const f = await saleFixture();
  const password = randomBytes(24).toString("hex");
  await pool.query(
    "UPDATE users SET password_hash=$1 WHERE id=ANY($2::uuid[])",
    [await hashPassword(password), [f.owner, f.staff]],
  );
  const customer = {
    id: f.customer,
    name: "Customer",
    phone: "1234567890",
    locality: "Test",
    active: true,
    version: 1,
  };
  await pool.query(
    "INSERT INTO customer_revisions(business_id,customer_id,version,snapshot,actor_id) VALUES ($1,$2,1,$3,$4)",
    [f.business, f.customer, customer, f.owner],
  );
  await pool.query(
    "INSERT INTO change_log(business_id,kind,entity_id,version) VALUES ($1,'customer',$2,1),($1,'catalogue.item',$3,1)",
    [f.business, f.customer, f.item],
  );
  const { default: app } = await import("../src/app.js");
  server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const child = spawn(
    process.env.FLUTTER_BIN,
    ["test", "test/http_integration_test.dart"],
    {
      cwd: "../Frontend",
      stdio: "inherit",
      env: {
        ...process.env,
        FLUTTER_SMOKE_URL: `http://127.0.0.1:${server.address().port}`,
        FLUTTER_SMOKE_PASSWORD: password,
        FLUTTER_SMOKE_OWNER: `${f.owner}@example.com`,
        FLUTTER_SMOKE_STAFF: `${f.staff}@example.com`,
      },
    },
  );
  const [code] = await once(child, "exit");
  if (code !== 0) process.exitCode = 1;
} finally {
  if (server) {
    server.closeAllConnections();
    await new Promise((resolve) => server.close(resolve));
  }
  if (pool) await pool.end();
  await admin.query(`DROP DATABASE IF EXISTS "${name}" WITH (FORCE)`);
  await admin.end();
}
