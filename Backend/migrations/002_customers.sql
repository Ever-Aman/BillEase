CREATE TABLE IF NOT EXISTS customers (
  id uuid NOT NULL,
  business_id uuid NOT NULL REFERENCES businesses(id),
  name text NOT NULL,
  phone text NOT NULL,
  locality text NOT NULL,
  version integer NOT NULL DEFAULT 1,
  active boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(business_id,id)
);
CREATE INDEX IF NOT EXISTS customers_lookup ON customers(business_id,phone);
CREATE TABLE IF NOT EXISTS customer_revisions (
  business_id uuid NOT NULL,
  customer_id uuid NOT NULL,
  version integer NOT NULL,
  snapshot jsonb NOT NULL,
  actor_id uuid NOT NULL REFERENCES users(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(business_id,customer_id,version)
);
