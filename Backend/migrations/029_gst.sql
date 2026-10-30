ALTER TABLE businesses DROP CONSTRAINT IF EXISTS businesses_document_mode_check;
ALTER TABLE businesses ADD CONSTRAINT businesses_document_mode_check CHECK(document_mode IN ('unconfigured','non_gst','composition','regular_gst'));
ALTER TABLE items ADD COLUMN IF NOT EXISTS hsn text CHECK(hsn ~ '^[0-9]{4,8}$'), ADD COLUMN IF NOT EXISTS gst_rate_bps integer CHECK(gst_rate_bps BETWEEN 0 AND 10000), ADD COLUMN IF NOT EXISTS tax_category text CHECK(tax_category IN ('taxable','nil_rated','exempt'));
ALTER TABLE customers ADD COLUMN IF NOT EXISTS gstin text, ADD COLUMN IF NOT EXISTS address text, ADD COLUMN IF NOT EXISTS state_code text;
