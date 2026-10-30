ALTER TABLE businesses ADD COLUMN IF NOT EXISTS document_profile jsonb;
ALTER TABLE businesses ADD COLUMN IF NOT EXISTS profile_version integer NOT NULL DEFAULT 0;
ALTER TABLE bills ADD COLUMN IF NOT EXISTS document_snapshot jsonb;
ALTER TABLE bills ADD COLUMN IF NOT EXISTS customer_snapshot jsonb;
CREATE TABLE IF NOT EXISTS refunds (
 id uuid NOT NULL, business_id uuid NOT NULL, bill_id uuid NOT NULL,
 amount_minor bigint NOT NULL CHECK(amount_minor > 0), method text NOT NULL CHECK(method IN ('cash','upi','bank')),
 actor_id uuid NOT NULL REFERENCES users(id), reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(business_id,id), FOREIGN KEY(business_id,bill_id) REFERENCES bills(business_id,id)
);
ALTER TABLE returns ADD COLUMN IF NOT EXISTS resolution text CHECK(resolution IN ('debt','advance','refund'));
ALTER TABLE returns ADD COLUMN IF NOT EXISTS refund_id uuid;
