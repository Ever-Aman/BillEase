import { readFileSync } from "node:fs";
import { GoogleAuth } from "google-auth-library";

const scopes = ["https://www.googleapis.com/auth/firebase.messaging"];
const authenticatedClient = (credentials, scopes) =>
  new GoogleAuth({ credentials, scopes }).getClient();

export function createFcmSender(
  env = process.env,
  clientFactory = authenticatedClient,
) {
  const raw =
    env.FIREBASE_SERVICE_ACCOUNT_JSON ||
    (env.FIREBASE_SERVICE_ACCOUNT_PATH
      ? readFileSync(env.FIREBASE_SERVICE_ACCOUNT_PATH, "utf8")
      : null);
  if (!raw)
    throw new Error(
      "Firebase Admin credential is required when PUSH_ENABLED=true",
    );
  let credentials;
  try {
    credentials = JSON.parse(raw);
  } catch {
    throw new Error("Firebase Admin credential is invalid JSON");
  }
  if (
    credentials.type !== "service_account" ||
    !credentials.private_key ||
    !credentials.client_email ||
    !credentials.project_id
  )
    throw new Error("Firebase credential must be a service account");
  if (!/^[a-z][a-z0-9-]{4,28}[a-z0-9]$/.test(credentials.project_id))
    throw new Error("Invalid Firebase project ID");
  if (
    env.FIREBASE_PROJECT_ID &&
    env.FIREBASE_PROJECT_ID !== credentials.project_id
  )
    throw new Error("Firebase credential project mismatch");
  let clientPromise;
  return {
    async send(message) {
      try {
        clientPromise ||= Promise.resolve(clientFactory(credentials, scopes));
        const client = await clientPromise;
        await client.request({
          url: `https://fcm.googleapis.com/v1/projects/${credentials.project_id}/messages:send`,
          method: "POST",
          data: { message },
          timeout: 15000,
          retry: false,
        });
      } catch (error) {
        const apiError = error.response?.data?.error;
        const unregistered = apiError?.details?.some(
          (x) => x.errorCode === "UNREGISTERED",
        );
        const status = /^[A-Z_]+$/.test(apiError?.status ?? "")
          ? apiError.status
          : "SEND_FAILED";
        throw Object.assign(new Error("FCM delivery failed"), {
          code: unregistered
            ? "messaging/registration-token-not-registered"
            : `fcm/${status}`,
        });
      }
    },
  };
}
