ALTER TABLE payment_corrections ADD COLUMN IF NOT EXISTS replacement_payment_id uuid;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname='payment_corrections_replacement_fk') THEN
    ALTER TABLE payment_corrections ADD CONSTRAINT payment_corrections_replacement_fk
      FOREIGN KEY (business_id,replacement_payment_id) REFERENCES payments(business_id,id);
  END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS one_payment_replacement ON payment_corrections(business_id,replacement_payment_id) WHERE replacement_payment_id IS NOT NULL;
