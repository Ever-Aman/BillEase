CREATE TABLE IF NOT EXISTS delivery_authorizations (
 business_id uuid NOT NULL, bill_id uuid NOT NULL, revision text NOT NULL,
 permissions jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(business_id,bill_id,revision),
 FOREIGN KEY(business_id,bill_id) REFERENCES bills(business_id,id)
);
ALTER TABLE delivery_events ADD COLUMN IF NOT EXISTS authorization_revision text;
ALTER TABLE delivery_events ADD COLUMN IF NOT EXISTS coverage_conflict boolean NOT NULL DEFAULT false;
