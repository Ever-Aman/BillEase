import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";

if (
  process.env.APP_ENV !== "development" ||
  !new URL(process.env.DATABASE_URL).pathname.includes("_tdd_")
)
  throw new Error("Isolated development database required");
test("actual server entry point checks database, serves health, and exits cleanly on SIGTERM", async () => {
  const child = spawn(process.execPath, ["src/server.js"], {
    env: { ...process.env, PORT: "0", PUSH_ENABLED: "false" },
    stdio: ["ignore", "pipe", "pipe"],
  });
  try {
    const port = await new Promise((resolve, reject) => {
      const timeout = setTimeout(
        () => reject(new Error("Server startup timed out")),
        5000,
      );
      let output = "";
      child.stdout.on("data", (chunk) => {
        output += chunk;
        const match = output.match(/on port (\d+)/);
        if (match) {
          clearTimeout(timeout);
          resolve(Number(match[1]));
        }
      });
      child.once("error", (error) => {
        clearTimeout(timeout);
        reject(error);
      });
      child.once("exit", () => {
        clearTimeout(timeout);
        reject(new Error("Server exited before ready"));
      });
    });
    const response = await fetch(`http://127.0.0.1:${port}/health`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).environment, "development");
    const exited = once(child, "exit");
    child.kill("SIGTERM");
    assert.equal((await exited)[0], 0);
  } finally {
    if (child.exitCode === null) child.kill("SIGKILL");
  }
});
