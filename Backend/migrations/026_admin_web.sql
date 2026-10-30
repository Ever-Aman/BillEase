CREATE TABLE IF NOT EXISTS admin_web_sessions (
 token_hash text PRIMARY KEY,
 user_id uuid NOT NULL REFERENCES users(id),
 device_id uuid NOT NULL REFERENCES devices(id),
 token_state text NOT NULL,
 csrf_token text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 last_seen_at timestamptz NOT NULL DEFAULT now(),
 expires_at timestamptz NOT NULL DEFAULT now()+interval '8 hours'
);
CREATE INDEX IF NOT EXISTS admin_web_session_expiry ON admin_web_sessions(expires_at);
DROP INDEX IF EXISTS one_staff_business;
CREATE UNIQUE INDEX one_staff_business ON memberships(user_id) WHERE role='staff' AND active;
