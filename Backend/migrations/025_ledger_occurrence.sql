ALTER TABLE customer_ledger ADD COLUMN IF NOT EXISTS occurrence_at timestamptz;
UPDATE customer_ledger SET occurrence_at=created_at WHERE occurrence_at IS NULL;
ALTER TABLE customer_ledger ALTER COLUMN occurrence_at SET DEFAULT now();
ALTER TABLE customer_ledger ALTER COLUMN occurrence_at SET NOT NULL;
