# Neon development setup

Configured on 30 October 2026 (Asia/Kolkata).

## Existing resources

- Organization: Aman (`org-withered-cake-84272061`).
- Project: [Billease Development](https://console.neon.tech/app/projects/little-snow-45880279/) (`little-snow-45880279`), AWS Singapore.
- Existing branch: `production` (`br-ancient-cake-a13hcy7j`). This is Neon's initial branch name inside the development project. It was preserved; `APP_ENV`, `DATABASE_ENV`, and the database deployment marker are `development`. A separate production database is still required before live use.

## Changes made

1. Installed Neon CLI 8.13.2 under `/home/neveraman/.local` and authenticated its DEFAULT profile through the user-approved browser flow. Credentials remain in Neon's user configuration, outside this project.
2. Linked the existing project/branch in root `.neon`; created root `.gitignore` containing `.neon`. Used `--no-env-pull --no-config` to preserve the supplied environment values and avoid adding a `neon.ts` or changing infrastructure.
3. Installed the official `neon`, `neon-postgres`, and `neon-postgres-branches` skills, including their bundled references, under `.agents/skills/`. The Neon CLI's skills installer failed with the local Node/npm runtime; the Codex skill-installer downloaded those directories from `neondatabase/agent-skills` instead. No existing skills were replaced.
4. Added `mcp_servers.Neon` to `/home/neveraman/.codex/config.toml`, using OAuth and `https://mcp.neon.tech/mcp?projectId=little-snow-45880279`. Codex CLI recognizes it as enabled. No API key was embedded in the configuration. Existing user settings and other MCP entries were verified unchanged. The project `.codex/config.toml` was restored byte-for-byte to its prior content after testing project-local registration.
5. Added optional `DATABASE_URL_POOLED` support in `Backend/src/config.js`. Normal application traffic uses it when provided; otherwise it falls back to `DATABASE_URL`. Migrations use the direct `DATABASE_URL`. Both configured URLs require TLS in production. Each distinct connection pool handles idle errors.
6. Updated `Backend/src/migrate.js`, the isolated test runner and both browser/Flutter fixture runners. Test child environments explicitly remove inherited pooled URLs, preventing accidental connection to a real database. Updated both environment examples and `Backend/README.md`; added `Backend/test/database-connection-selection.test.js`.
7. Verified matching direct/pooled development endpoints and an empty public schema before applying the existing migrations 001–028. No user or business seed data was inserted. The real backend then started successfully and returned a development health response through the pooled connection, and was stopped cleanly.
8. Updated `USER_INPUTS_NEEDED.md` and refreshed `.codex/project-map.json` (188 source/test/migration files).

The supplied `Backend/.env.development` was preserved byte-for-byte throughout setup. Its credentials are intentionally omitted from these notes.

## Verification

- Full backend test runner: 26 isolated test files passed, including pooled URL selection, production TLS validation, and direct migration while the pooled endpoint is deliberately unreachable.
- The full runner was invoked with an inherited unusable pooled URL to verify that tests isolate their own connections.
- Direct and pooled Neon connections succeeded; migrations and actual server startup/health passed against the development database.
- Existing environment file and project Codex configuration preservation verified using file hashes; previous user configuration verified using parsed TOML comparison.
- `codex mcp get Neon --json` recognizes the enabled, project-pinned OAuth server. MCP tool calls have not yet been authenticated or tested in a refreshed agent session.

## Using the setup

Restart Codex to load the new skills and MCP entry. If prompted on first MCP use, authorize Neon through its normal OAuth flow. CLI authorization and MCP authorization are separate. Existing Codex model/agent settings remain as they were.

From `Backend/`, with Node.js 24 active:

```sh
npm run dev
```

Future development migrations:

```sh
node --env-file=.env.development src/migrate.js
```

This project uses `DATABASE_URL` for the direct URL and `DATABASE_URL_POOLED` for the pooled URL. Future `neon link` or `neon checkout` commands should use `--no-env-pull` to preserve those explicit values; Neon's automatic env naming can differ.

Firebase Admin credentials, physical-device checks, Railway deployment, accountant-approved GST details, and the separate production environment remain tracked in `USER_INPUTS_NEEDED.md`.

Sources: [Neon setup prompt](https://neon.com/get-started/prompt.md), [Neon skill](https://neon.com/.well-known/agent-skills/neon/SKILL.md), [official skill repository](https://github.com/neondatabase/agent-skills), and [Codex MCP configuration](https://developers.openai.com/codex/mcp).
