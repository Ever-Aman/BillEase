import test from "node:test";
import assert from "node:assert/strict";
import {
  readFile,
  mkdtemp,
  mkdir,
  cp,
  access,
  stat,
  readdir,
  rm,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = fileURLToPath(new URL("../../", import.meta.url));

test("production image stages the backend and every whitelisted admin resource at its runtime path", async () => {
  const dockerfile = await readFile(join(root, "Dockerfile"), "utf8");
  const context = await mkdtemp(join(tmpdir(), "billease-deploy-"));
  try {
    const workdir = dockerfile.match(/^WORKDIR (.+)$/m)?.[1];
    assert.equal(workdir, "/app/Backend");
    assert.match(dockerfile, /^FROM node:24-[\w-]*slim$/m);
    assert.match(dockerfile, /^RUN npm ci --omit=dev /m);
    assert.match(dockerfile, /^USER node$/m);
    assert.match(dockerfile, /^CMD \["npm", "start"\]$/m);
    const sourceRoots = [];
    for (const instruction of dockerfile.matchAll(/^COPY (.+)$/gm)) {
      const parts = instruction[1]
        .trim()
        .split(/\s+/)
        .filter((part) => !part.startsWith("--"));
      const target = parts.pop();
      const destination = join(
        context,
        target.startsWith("/") ? target : join(workdir, target),
      );
      await mkdir(destination, { recursive: true });
      for (const source of parts) {
        assert.ok(
          source.startsWith("Backend/") || source.startsWith("Frontend/Admin/"),
        );
        assert.ok(!/[\*?]/.test(source), "runtime COPY must enumerate sources");
        sourceRoots.push(source);
        const sourcePath = join(root, source);
        const sourceStat = await stat(sourcePath);
        // Docker copies directory contents into the destination, and files by basename.
        await cp(
          sourcePath,
          sourceStat.isDirectory()
            ? destination
            : join(destination, source.split("/").at(-1)),
          { recursive: true },
        );
      }
    }
    assert.deepEqual(sourceRoots, [
      "Backend/package.json",
      "Backend/package-lock.json",
      "Backend/src",
      "Backend/migrations",
      "Backend/assets",
      "Frontend/Admin/index.html",
      "Frontend/Admin/app.js",
      "Frontend/Admin/model.mjs",
      "Frontend/Admin/styles.css",
      "Frontend/Admin/assets",
    ]);
    const route = join(context, workdir, "src/routes/admin-browser.js");
    const routeSource = await readFile(route, "utf8");
    const assetsRelative = routeSource.match(
      /new URL\(\s*"([^"]*Frontend\/Admin\/)"/,
    )?.[1];
    assert.ok(
      assetsRelative,
      "admin route resolves its sibling asset directory",
    );
    const admin = fileURLToPath(new URL(assetsRelative, pathToFileURL(route)));
    for (const file of [
      "index.html",
      "app.js",
      "model.mjs",
      "styles.css",
      "assets/Inter.ttf",
      "assets/mark.svg",
      "assets/OFL.txt",
    ])
      await access(join(admin, file));
    const files = ["index.html", "styles.css", "app.js"];
    for (const file of files) {
      const content = await readFile(join(admin, file), "utf8");
      const references = [
        ...content.matchAll(
          /(?:src=|href=)["'](\.\/[^"']+)["']|url\(["']?(\.\/[^'"\)]+)|from\s+["'](\.\/[^"']+)["']/g,
        ),
      ];
      for (const match of references)
        await access(join(admin, match[1] ?? match[2] ?? match[3]));
    }
    const fonts = new URL(
      "../../assets/fonts/DejaVuSans.ttf",
      pathToFileURL(join(context, workdir, "src/utils/invoice-layout.js")),
    );
    await access(fonts);
    await access(join(context, workdir, "migrations/001_foundation.sql"));
    assert.ok(!(await readdir(admin)).includes("tests"));
    assert.ok(!(await readdir(admin)).includes("design"));
    assert.ok(!(await readdir(join(context, "app/Frontend"))).includes("lib"));
    assert.ok(
      !(await readdir(join(context, workdir))).some((name) =>
        name.startsWith(".env"),
      ),
    );
    assert.equal(relative(context, admin), "app/Frontend/Admin");
  } finally {
    await rm(context, { recursive: true, force: true });
  }
});

test("root Railway Docker configuration retains health checks, migrations and runtime-secret exclusions", async () => {
  const config = JSON.parse(await readFile(join(root, "railway.json"), "utf8"));
  const backend = JSON.parse(
    await readFile(join(root, "Backend/railway.json"), "utf8"),
  );
  assert.deepEqual(config.build, {
    builder: "DOCKERFILE",
    dockerfilePath: "Dockerfile",
  });
  assert.deepEqual(config.deploy, backend.deploy);
  const ignore = await readFile(join(root, ".dockerignore"), "utf8");
  assert.match(ignore, /^\*\*$/m);
  for (const pattern of [
    "**/.env",
    "**/.env.*",
    "**/*secret*",
    "**/*credential*",
    "**/*service-account*",
    "**/*.pem",
    "**/*.key",
    "**/node_modules",
    "**/.git",
    "**/.agents",
    "**/.codex",
    "**/downloads",
    "**/build",
    "**/tmp",
    "**/output",
  ])
    assert.ok(ignore.split("\n").includes(pattern), `excluded ${pattern}`);
});
