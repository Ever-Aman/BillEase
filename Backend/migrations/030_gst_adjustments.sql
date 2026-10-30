-- Operational reversals reference the issued document's saved tax calculation.
-- They do not issue legally numbered GST credit notes.
ALTER TABLE returns ADD COLUMN IF NOT EXISTS tax_snapshot jsonb;
ALTER TABLE line_cancellations ADD COLUMN IF NOT EXISTS tax_snapshot jsonb;

CREATE OR REPLACE FUNCTION protect_adjustment_tax_snapshot() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    IF OLD.tax_snapshot IS NOT NULL THEN
      RAISE EXCEPTION 'Adjustment tax snapshot is immutable';
    END IF;
    RETURN OLD;
  END IF;
  IF OLD.tax_snapshot IS DISTINCT FROM NEW.tax_snapshot
     OR (OLD.tax_snapshot IS NOT NULL AND OLD IS DISTINCT FROM NEW) THEN
    RAISE EXCEPTION 'Adjustment tax snapshot is immutable';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS returns_tax_snapshot_immutable ON returns;
CREATE TRIGGER returns_tax_snapshot_immutable BEFORE UPDATE OR DELETE ON returns
FOR EACH ROW EXECUTE FUNCTION protect_adjustment_tax_snapshot();
DROP TRIGGER IF EXISTS cancellations_tax_snapshot_immutable ON line_cancellations;
CREATE TRIGGER cancellations_tax_snapshot_immutable BEFORE UPDATE OR DELETE ON line_cancellations
FOR EACH ROW EXECUTE FUNCTION protect_adjustment_tax_snapshot();
