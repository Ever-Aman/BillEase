CREATE TABLE IF NOT EXISTS push_tokens (
 device_id uuid PRIMARY KEY REFERENCES devices(id),token_ciphertext text NOT NULL,
 updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS push_jobs (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
 business_id uuid NOT NULL REFERENCES businesses(id), user_id uuid NOT NULL REFERENCES users(id),
 category text NOT NULL, reference_id uuid NOT NULL,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','sending','sent','dead')),
 attempts integer NOT NULL DEFAULT 0, run_at timestamptz NOT NULL DEFAULT now(),
 locked_at timestamptz, sent_at timestamptz, last_error text,
 UNIQUE(business_id,user_id,category,reference_id)
);
CREATE INDEX IF NOT EXISTS push_due ON push_jobs(status,run_at,id);
