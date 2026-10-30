ALTER TABLE businesses ADD COLUMN IF NOT EXISTS document_mode text NOT NULL DEFAULT 'unconfigured' CHECK(document_mode IN ('unconfigured','non_gst'));
CREATE TABLE IF NOT EXISTS document_series (
 business_id uuid NOT NULL REFERENCES businesses(id), financial_year text NOT NULL,
 last_number integer NOT NULL DEFAULT 0, PRIMARY KEY(business_id,financial_year)
);
CREATE TABLE IF NOT EXISTS bills (
 id uuid NOT NULL, business_id uuid NOT NULL REFERENCES businesses(id), customer_id uuid,
 actor_id uuid NOT NULL REFERENCES users(id), financial_year text NOT NULL, invoice_number integer NOT NULL,
 total_minor bigint NOT NULL CHECK(total_minor >= 0), review_state text NOT NULL CHECK(review_state IN ('not_required','credit_pending','approved','disputed')),
 lifecycle text NOT NULL DEFAULT 'issued' CHECK(lifecycle IN ('issued','cancelled')),
 occurrence_at timestamptz NOT NULL, issued_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(business_id,id), UNIQUE(business_id,financial_year,invoice_number),
 FOREIGN KEY(business_id,customer_id) REFERENCES customers(business_id,id)
);
CREATE TABLE IF NOT EXISTS bill_lines (
 id uuid NOT NULL, business_id uuid NOT NULL, bill_id uuid NOT NULL,
 item_id uuid NOT NULL, unit_id uuid NOT NULL, catalogue_version integer NOT NULL,
 item_name text NOT NULL, unit_label text NOT NULL, canonical_unit text NOT NULL,
 factor numeric(18,6) NOT NULL, quantity_milli integer NOT NULL CHECK(quantity_milli > 0),
 unit_price_minor bigint NOT NULL CHECK(unit_price_minor >= 0), line_total_minor bigint NOT NULL CHECK(line_total_minor >= 0),
 price_override_by uuid REFERENCES users(id), price_difference_minor bigint NOT NULL DEFAULT 0,
 PRIMARY KEY(business_id,id), FOREIGN KEY(business_id,bill_id) REFERENCES bills(business_id,id)
);
CREATE TABLE IF NOT EXISTS payments (
 id uuid NOT NULL, business_id uuid NOT NULL, bill_id uuid NOT NULL,
 method text NOT NULL CHECK(method IN ('cash','upi','bank')),
 amount_minor bigint NOT NULL CHECK(amount_minor > 0), state text NOT NULL CHECK(state IN ('confirmed','pending','rejected')),
 actor_id uuid NOT NULL REFERENCES users(id), verified_by uuid REFERENCES users(id),
 occurrence_at timestamptz NOT NULL, received_at timestamptz NOT NULL DEFAULT now(),
 PRIMARY KEY(business_id,id), FOREIGN KEY(business_id,bill_id) REFERENCES bills(business_id,id)
);
CREATE TABLE IF NOT EXISTS customer_ledger (
 id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, business_id uuid NOT NULL,
 customer_id uuid NOT NULL, bill_id uuid NOT NULL, payment_id uuid,
 debt_delta_minor bigint NOT NULL, actor_id uuid NOT NULL REFERENCES users(id),
 created_at timestamptz NOT NULL DEFAULT now(),
 FOREIGN KEY(business_id,customer_id) REFERENCES customers(business_id,id),
 FOREIGN KEY(business_id,bill_id) REFERENCES bills(business_id,id)
);
CREATE INDEX IF NOT EXISTS ledger_customer ON customer_ledger(business_id,customer_id,id);
