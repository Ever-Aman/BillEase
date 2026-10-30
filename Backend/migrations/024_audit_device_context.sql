ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS device_id uuid;
ALTER TABLE audit_events ADD COLUMN IF NOT EXISTS session_id uuid;
CREATE OR REPLACE FUNCTION attach_audit_device_context() RETURNS trigger AS $$
BEGIN
  NEW.device_id := COALESCE(NEW.device_id,NULLIF(current_setting('billease.device_id',true),'')::uuid);
  NEW.session_id := COALESCE(NEW.session_id,NULLIF(current_setting('billease.session_id',true),'')::uuid);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS audit_device_context ON audit_events;
CREATE TRIGGER audit_device_context BEFORE INSERT ON audit_events
  FOR EACH ROW EXECUTE FUNCTION attach_audit_device_context();
