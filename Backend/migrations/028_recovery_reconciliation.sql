ALTER TABLE quarantined_operations DROP CONSTRAINT IF EXISTS quarantined_operations_decision_check;
ALTER TABLE quarantined_operations ADD CONSTRAINT quarantined_operations_decision_check
  CHECK (decision IN ('pending','accepted','rejected','reconciled'));
