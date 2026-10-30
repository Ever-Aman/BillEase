ALTER TABLE customer_ledger ADD COLUMN IF NOT EXISTS source_type text;
ALTER TABLE customer_ledger ADD COLUMN IF NOT EXISTS source_operation_id uuid;
CREATE TABLE IF NOT EXISTS ledger_corrections (
 business_id uuid NOT NULL REFERENCES businesses(id), original_entry_id bigint NOT NULL REFERENCES customer_ledger(id),
 reversal_entry_id bigint NOT NULL REFERENCES customer_ledger(id), replacement_entry_id bigint REFERENCES customer_ledger(id),
 operation_id uuid NOT NULL, actor_id uuid NOT NULL REFERENCES users(id), reason text NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(business_id,original_entry_id), UNIQUE(business_id,operation_id)
);
