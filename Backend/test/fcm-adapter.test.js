import test from "node:test";
import assert from "node:assert/strict";
import { createFcmSender } from "../src/services/fcm.js";

test("FCM adapter scopes requests to the configured project and classifies expired registration", async () => {
  const credential = {
    type: "service_account",
    project_id: "billease-development",
    client_email: "test@billease-development.iam.gserviceaccount.com",
    private_key: "test-only-injected-client",
  };
  const env = {
    FIREBASE_SERVICE_ACCOUNT_JSON: JSON.stringify(credential),
    FIREBASE_PROJECT_ID: "billease-development",
  };
  assert.throws(
    () => createFcmSender({ ...env, FIREBASE_PROJECT_ID: "wrong-project" }),
    /project mismatch/,
  );
  assert.throws(
    () => createFcmSender({ FIREBASE_SERVICE_ACCOUNT_JSON: "{}" }),
    /service account/,
  );
  let request,
    expire = false,
    clients = 0;
  const sender = createFcmSender(env, async (credentials, scopes) => {
    clients++;
    assert.equal(credentials.project_id, "billease-development");
    assert.deepEqual(scopes, [
      "https://www.googleapis.com/auth/firebase.messaging",
    ]);
    return {
      request: async (input) => {
        request = input;
        if (expire)
          throw {
            response: {
              data: {
                error: {
                  status: "NOT_FOUND",
                  details: [{ errorCode: "UNREGISTERED" }],
                },
              },
            },
          };
        return { data: { name: "accepted" } };
      },
    };
  });
  const message = {
    token: "test-registration",
    notification: {
      title: "Review needed",
      body: "Staff work needs your review.",
    },
    data: { category: "staff_request", referenceId: "test-reference" },
  };
  await sender.send(message);
  assert.equal(
    request.url,
    "https://fcm.googleapis.com/v1/projects/billease-development/messages:send",
  );
  assert.deepEqual(request.data, { message });
  expire = true;
  await assert.rejects(
    sender.send(message),
    (error) => error.code === "messaging/registration-token-not-registered",
  );
  assert.equal(clients, 1);
});
