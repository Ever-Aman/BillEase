ALTER TABLE returns
  ADD COLUMN IF NOT EXISTS canonical_quantity numeric(24,9),
  ADD COLUMN IF NOT EXISTS unit_id uuid,
  ADD COLUMN IF NOT EXISTS unit_label text,
  ADD COLUMN IF NOT EXISTS factor numeric(18,6);
UPDATE returns r SET canonical_quantity=l.factor*r.quantity_milli/1000,
  unit_id=l.unit_id,unit_label=l.unit_label,factor=l.factor
  FROM bill_lines l WHERE l.business_id=r.business_id AND l.id=r.line_id
  AND r.canonical_quantity IS NULL;
ALTER TABLE returns ALTER COLUMN canonical_quantity SET NOT NULL;

CREATE TABLE IF NOT EXISTS line_cancellations (
  id uuid NOT NULL, business_id uuid NOT NULL, bill_id uuid NOT NULL, line_id uuid NOT NULL,
  operation_id uuid NOT NULL, quantity_milli numeric(24,9) NOT NULL,
  unit_id uuid NOT NULL, unit_label text NOT NULL, factor numeric(18,6) NOT NULL,
  canonical_quantity numeric(24,9) NOT NULL CHECK(canonical_quantity>0),
  value_minor bigint NOT NULL CHECK(value_minor>=0), actor_id uuid NOT NULL REFERENCES users(id),
  reason text NOT NULL, created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY(business_id,id),
  FOREIGN KEY(business_id,bill_id) REFERENCES bills(business_id,id),
  FOREIGN KEY(business_id,line_id) REFERENCES bill_lines(business_id,id)
);
CREATE INDEX IF NOT EXISTS cancellations_bill ON line_cancellations(business_id,bill_id);

CREATE OR REPLACE VIEW bill_line_quantities AS
SELECT l.business_id,l.bill_id,l.id line_id,
 (l.factor*l.quantity_milli/1000)::numeric(24,9) billed_canonical,
 (COALESCE((SELECT SUM(e.canonical_quantity) FROM delivery_events e WHERE e.business_id=l.business_id AND e.line_id=l.id),0)
 -COALESCE((SELECT SUM(c.canonical_reversal) FROM delivery_corrections c JOIN delivery_events e ON e.business_id=c.business_id AND e.id=c.delivery_id WHERE e.business_id=l.business_id AND e.line_id=l.id),0))::numeric(24,9) delivered_canonical,
 COALESCE((SELECT SUM(r.canonical_quantity) FROM returns r WHERE r.business_id=l.business_id AND r.line_id=l.id),0)::numeric(24,9) returned_canonical,
 COALESCE((SELECT SUM(c.canonical_quantity) FROM line_cancellations c WHERE c.business_id=l.business_id AND c.line_id=l.id),0)::numeric(24,9) cancelled_canonical,
 (COALESCE((SELECT SUM(r.value_minor) FROM returns r WHERE r.business_id=l.business_id AND r.line_id=l.id),0)
 +COALESCE((SELECT SUM(c.value_minor) FROM line_cancellations c WHERE c.business_id=l.business_id AND c.line_id=l.id),0))::bigint adjusted_value_minor
FROM bill_lines l;
