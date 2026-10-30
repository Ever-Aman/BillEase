ALTER TABLE payments ADD COLUMN IF NOT EXISTS corrected_at timestamptz;
CREATE TABLE IF NOT EXISTS payment_corrections (
 id uuid NOT NULL, business_id uuid NOT NULL, payment_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES users(id), reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(business_id,id), UNIQUE(business_id,payment_id),
 FOREIGN KEY(business_id,payment_id) REFERENCES payments(business_id,id)
);
CREATE TABLE IF NOT EXISTS delivery_corrections (
 id uuid NOT NULL, business_id uuid NOT NULL, delivery_id uuid NOT NULL,
 actor_id uuid NOT NULL REFERENCES users(id), reason text NOT NULL,
 canonical_reversal numeric(24,9) NOT NULL CHECK(canonical_reversal>0), created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(business_id,id), UNIQUE(business_id,delivery_id),
 FOREIGN KEY(business_id,delivery_id) REFERENCES delivery_events(business_id,id)
);
