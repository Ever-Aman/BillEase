CREATE TABLE IF NOT EXISTS recovery_codes (
 user_id uuid NOT NULL REFERENCES users(id), code_hash text NOT NULL,
 used_at timestamptz, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(user_id,code_hash)
);
