ALTER TABLE quotations ADD COLUMN IF NOT EXISTS document_snapshot jsonb;
ALTER TABLE quotations ADD COLUMN IF NOT EXISTS customer_snapshot jsonb;
