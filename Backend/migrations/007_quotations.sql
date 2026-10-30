CREATE TABLE IF NOT EXISTS quotations (
 id uuid NOT NULL, business_id uuid NOT NULL REFERENCES businesses(id), actor_id uuid NOT NULL REFERENCES users(id),
 customer_id uuid, reference text NOT NULL, total_minor bigint NOT NULL CHECK(total_minor>=0),
 created_at timestamptz NOT NULL DEFAULT now(), PRIMARY KEY(business_id,id), UNIQUE(business_id,reference),
 FOREIGN KEY(business_id,customer_id) REFERENCES customers(business_id,id)
);
CREATE TABLE IF NOT EXISTS quotation_lines (
 id uuid NOT NULL, business_id uuid NOT NULL, quotation_id uuid NOT NULL,
 item_id uuid NOT NULL, unit_id uuid NOT NULL, catalogue_version integer NOT NULL,
 item_name text NOT NULL, unit_label text NOT NULL, quantity_milli integer NOT NULL CHECK(quantity_milli>0),
 price_minor bigint NOT NULL CHECK(price_minor>=0), line_total_minor bigint NOT NULL CHECK(line_total_minor>=0),
 PRIMARY KEY(business_id,id), FOREIGN KEY(business_id,quotation_id) REFERENCES quotations(business_id,id)
);
ALTER TABLE bills ADD COLUMN IF NOT EXISTS quotation_id uuid;
CREATE UNIQUE INDEX IF NOT EXISTS one_bill_per_quote ON bills(business_id,quotation_id) WHERE quotation_id IS NOT NULL;
