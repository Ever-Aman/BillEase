ALTER TABLE devices ADD COLUMN IF NOT EXISTS public_key text;
CREATE TABLE IF NOT EXISTS quarantined_operations (
 device_id uuid NOT NULL REFERENCES devices(id), operation_id uuid NOT NULL,
 business_id uuid NOT NULL REFERENCES businesses(id), payload_type text NOT NULL,
 payload jsonb NOT NULL, payload_hash text NOT NULL,
 received_at timestamptz NOT NULL DEFAULT now(), reviewed_at timestamptz,
 reviewed_by uuid REFERENCES users(id), review_note text,
 PRIMARY KEY(device_id,operation_id)
);
CREATE INDEX IF NOT EXISTS quarantine_business ON quarantined_operations(business_id,received_at);
