# Render development deployment

Prepared 30 October 2026. This is deployment configuration, not evidence of a hosted deployment. No Render resources, accounts, or paid plans were created by this setup.

## Deployment shape

`render.yaml` builds the root Dockerfile with the repository root as its context. The container runs Node.js 24, the API, and the separate admin website at `/admin/`. The mobile app remains in `Frontend/lib`. Neon remains the database; the Blueprint does not create a Render database.

The service uses Singapore to match the existing Neon development project. `NODE_ENV=production` keeps the production Node runtime/dependency installation, while `APP_ENV=development` and `DATABASE_ENV=development` select BillEase's development data environment. Never substitute the live production database into this service.

The selected compute plan is Free and automatic deploys are disabled. Free services sleep after inactivity and can cold-start; they are suitable for this development preview. The in-process push worker also stops while the service sleeps, so queued push delivery can be delayed until it wakes. A paid compute plan requires a separate user choice before purchase. Review [current plans and limits](https://render.com/docs/free) before enabling hosting.

## Repository prerequisite

The approved repository is private `Ever-Aman/BillEase` on GitHub. Grant Render access to this repository for the Blueprint workflow. Before the first push, verify `.gitignore` excludes local environment files, `.neon`, credentials, and generated artifacts; review the files being committed. Commit the Dockerfile, `.dockerignore`, `render.yaml`, backend runtime sources/migrations/assets, and admin website assets. Do not commit `Backend/.env.development` or service-account credentials.

Connect the chosen repository in Render and create a Blueprint from its root `render.yaml`. Keep the repository root as the Docker context; setting the root directory to `Backend` would hide the sibling admin assets. Review the Free plan and Singapore region before applying the Blueprint. Render assigns the actual public hostname; do not assume the service name guarantees a particular hostname.

## Environment values

Supply these through Render's Environment settings or its initial Blueprint secret prompts. Copy existing development credentials privately from the approved local environment; this document contains variable names only.

| Variable | Required value or purpose |
| --- | --- |
| `DATABASE_URL` | Direct TLS URL for the existing Neon **development** database; migrations use this connection. |
| `DATABASE_URL_POOLED` | Corresponding pooled TLS URL for runtime traffic to the same development database. Optional in code, included as a prompt for the existing Neon setup. |
| `JWT_SECRET` | Development signing secret, at least 32 characters. Preserve it across redeploys. |
| `MFA_ENCRYPTION_KEY` | Development MFA key, exactly 64 hexadecimal characters. Preserve it to retain access to encrypted MFA data. |
| `ADMIN_WEB_ORIGIN` | Exact public HTTPS origin, for example `https://<actual-service-host>.onrender.com`, without `/admin`, a trailing slash, or any other path. |

The Blueprint sets `APP_ENV`, `DATABASE_ENV`, `NODE_ENV`, `TRUST_PROXY_HOPS`, and `PUSH_ENABLED`. Leave `PORT` to Render; the server listens on Render's port on `0.0.0.0`. Do not import the local `PORT` or `TRUST_PROXY_HOPS=0` over the Blueprint settings.

Render prompts for `sync: false` values during initial Blueprint creation only; later additions and changes must be made explicitly in the service's Environment settings. If the final hostname is unavailable at the prompt, update `ADMIN_WEB_ORIGIN` to the assigned HTTPS origin and redeploy before attempting admin writes. See [Blueprint environment placeholders](https://render.com/docs/blueprint-spec#environment-variables) and [environment configuration](https://render.com/docs/configure-environment-variables).

Push starts disabled. To enable it later, privately add `FIREBASE_SERVICE_ACCOUNT_JSON` for the development Firebase project and the matching `FIREBASE_PROJECT_ID`, then set `PUSH_ENABLED=true`. The local `FIREBASE_SERVICE_ACCOUNT_PATH` points to a file excluded from the image and should not be copied into the hosted configuration. The existing [Firebase setup](FIREBASE_SETUP.md) and [external requirements](USER_INPUTS_NEEDED.md) still apply.

## Migrations and initial account

Free web services do not support Render's pre-deploy command. Before the first deployment, and before any later deployment with new migrations, run the migration command from the reviewed matching checkout using the existing development environment and Node.js 24:

```sh
cd Backend
node --env-file=.env.development src/migrate.js
```

Confirm `Migration complete for development`. This command applies all checked-in migrations through the direct URL. It does not seed accounts. Do not run it with production credentials or while independent migration work is running. After migration succeeds, manually deploy the matching commit in Render. No migration command is embedded in Docker startup or the image build.

If a first admin account is needed, use the existing `src/bootstrap.js` and `src/mfa-setup.js` workflows from a trusted local terminal with development credentials. `BOOTSTRAP_ADMIN_EMAIL`, `BOOTSTRAP_ADMIN_PASSWORD`, and `MFA_USER_EMAIL` are one-time operator inputs, not permanent Blueprint variables. Keep passwords, MFA seeds, QR provisioning data, and recovery codes private.

If the user later selects a paid web service, Render supports `preDeployCommand: npm run db:migrate` in the Docker working directory. Add it only after that plan decision. See [Render pre-deploy behavior](https://render.com/docs/deploys#pre-deploy-command).

## Hosted verification still required

1. Request `https://<actual-service-host>.onrender.com/health`; require HTTP 200 and `{"status":"ok","environment":"development"}`. This checks database connectivity; startup also verifies the database environment marker.
2. Open `/`; require a redirect to `/admin/`, loaded CSS/JS/assets, and a development environment label after signing in. Use only development accounts and data.
3. Set `ADMIN_WEB_ORIGIN` to the address bar's exact HTTPS origin. Confirm admin login succeeds from that origin and a deliberately mismatched Origin is rejected with HTTP 403. There is no separate cross-origin admin host to configure.
4. `TRUST_PROXY_HOPS=1` assumes the normal direct Render ingress path. Confirm the actual proxy chain before relying on client IP rate limits: compare `X-Forwarded-For` and Express's resolved client address using temporary private diagnostics, and confirm a client-supplied spoofed forwarded address cannot change the effective rate-limit identity. Remove diagnostics afterward. Do not add a CDN or increase hops without repeating verification; the code accepts only 0–3.
5. Verify sign-in, logout, session expiry, and a permitted admin change. Current development browser cookies are HttpOnly and SameSite=Strict but omit the Secure attribute because that flag follows `APP_ENV=production`. Render HTTPS does not change this code behavior. This development deployment is not production cookie/security acceptance.
6. Test mobile access using the assigned HTTPS API origin and development build settings. Physical-device push and hosted acceptance remain outstanding until separately exercised.

Configuration fields follow the official [Blueprint reference](https://render.com/docs/blueprint-spec); Render's [web service guide](https://render.com/docs/web-services) describes public URLs and port binding. Local tests do not establish proxy-chain behavior, hosted authentication, physical-device readiness, or production acceptance.
