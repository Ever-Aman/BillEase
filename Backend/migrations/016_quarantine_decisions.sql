ALTER TABLE quarantined_operations
  ADD COLUMN IF NOT EXISTS original_role text CHECK (original_role IN ('owner','staff')),
  ADD COLUMN IF NOT EXISTS decision text NOT NULL DEFAULT 'pending'
    CHECK (decision IN ('pending','accepted','rejected')),
  ADD COLUMN IF NOT EXISTS decision_operation_id uuid,
  ADD COLUMN IF NOT EXISTS decision_input_hash text,
  ADD COLUMN IF NOT EXISTS decision_result jsonb;
CREATE UNIQUE INDEX IF NOT EXISTS quarantine_decision_operation
  ON quarantined_operations(business_id,decision_operation_id)
  WHERE decision_operation_id IS NOT NULL;
