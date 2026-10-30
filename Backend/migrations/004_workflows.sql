ALTER TABLE customer_ledger ALTER COLUMN bill_id DROP NOT NULL;
ALTER TABLE customer_ledger ADD COLUMN IF NOT EXISTS advance_delta_minor bigint NOT NULL DEFAULT 0;
ALTER TABLE customer_ledger ADD COLUMN IF NOT EXISTS note text;
CREATE TABLE IF NOT EXISTS delivery_events (
 id uuid NOT NULL, business_id uuid NOT NULL, bill_id uuid NOT NULL, line_id uuid NOT NULL,
 quantity_milli integer NOT NULL CHECK(quantity_milli > 0), unit_label text NOT NULL,
 factor numeric(18,6) NOT NULL CHECK(factor > 0), canonical_quantity numeric(24,9) NOT NULL,
 actor_id uuid NOT NULL REFERENCES users(id), state text NOT NULL CHECK(state IN ('review_pending','accepted','disputed')),
 occurrence_at timestamptz NOT NULL, received_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(business_id,id), FOREIGN KEY(business_id,bill_id) REFERENCES bills(business_id,id),
 FOREIGN KEY(business_id,line_id) REFERENCES bill_lines(business_id,id)
);
CREATE INDEX IF NOT EXISTS delivery_line ON delivery_events(business_id,line_id);
CREATE TABLE IF NOT EXISTS returns (
 id uuid NOT NULL, business_id uuid NOT NULL, bill_id uuid NOT NULL, line_id uuid NOT NULL,
 quantity_milli integer NOT NULL CHECK(quantity_milli > 0), value_minor bigint NOT NULL CHECK(value_minor >= 0),
 disposition text NOT NULL CHECK(disposition IN ('restockable','damaged','discarded')),
 reason text NOT NULL, actor_id uuid NOT NULL REFERENCES users(id), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(business_id,id), FOREIGN KEY(business_id,bill_id) REFERENCES bills(business_id,id),
 FOREIGN KEY(business_id,line_id) REFERENCES bill_lines(business_id,id)
);
CREATE TABLE IF NOT EXISTS devices (
 id uuid PRIMARY KEY, user_id uuid NOT NULL REFERENCES users(id), name text NOT NULL,
 active boolean NOT NULL DEFAULT true, last_seen_at timestamptz NOT NULL DEFAULT now(),
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS refresh_sessions (
 id uuid PRIMARY KEY, device_id uuid NOT NULL REFERENCES devices(id), user_id uuid NOT NULL REFERENCES users(id),
 token_hash text NOT NULL UNIQUE, expires_at timestamptz NOT NULL, revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE IF NOT EXISTS mfa_enrolments (
 user_id uuid PRIMARY KEY REFERENCES users(id), secret text NOT NULL,
 active boolean NOT NULL DEFAULT false, last_step bigint, created_at timestamptz NOT NULL DEFAULT now()
);
