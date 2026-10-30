CREATE TABLE IF NOT EXISTS pending_mfa_enrolments (
 user_id uuid PRIMARY KEY REFERENCES users(id), secret text NOT NULL,
 expires_at timestamptz NOT NULL, created_at timestamptz NOT NULL DEFAULT now()
);
