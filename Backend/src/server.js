import app from "./app.js";
import { assertDatabaseEnvironment, environment, pool } from "./config.js";
import { startPushWorker } from "./services/push.js";
import { startRateLimitCleanup } from "./utils/rate-limit.js";
import { configureServerLifecycle } from "./utils/server-lifecycle.js";

await assertDatabaseEnvironment();
const stopRateLimitCleanup = startRateLimitCleanup();
const stopPushWorker = startPushWorker();
const server = app.listen(Number(process.env.PORT || 3000), "0.0.0.0", () =>
  console.log(
    `BillEase API listening in ${environment} on port ${server.address().port}`,
  ),
);
configureServerLifecycle(server, pool, [stopRateLimitCleanup, stopPushWorker]);
