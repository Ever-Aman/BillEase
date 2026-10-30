ALTER TABLE quarantined_operations
  ADD COLUMN IF NOT EXISTS original_actor_id uuid REFERENCES users(id),
  ADD COLUMN IF NOT EXISTS claimed_role text CHECK (claimed_role IN ('owner','staff')),
  ADD COLUMN IF NOT EXISTS device_signature text,
  ADD COLUMN IF NOT EXISTS dependencies jsonb NOT NULL DEFAULT '[]'::jsonb;
UPDATE quarantined_operations q SET original_actor_id=d.user_id
FROM devices d WHERE d.id=q.device_id AND q.original_actor_id IS NULL;

-- Authorization history is server evidence of a role having been granted to an
-- enrolled device, not proof that a particular offline operation predates revoke.
CREATE TABLE IF NOT EXISTS device_business_authorizations (
  device_id uuid NOT NULL REFERENCES devices(id),
  business_id uuid NOT NULL REFERENCES businesses(id),
  actor_id uuid NOT NULL REFERENCES users(id),
  role text NOT NULL CHECK (role IN ('owner','staff')),
  last_authorized_at timestamptz NOT NULL,
  PRIMARY KEY(device_id,business_id,role)
);
CREATE OR REPLACE FUNCTION record_device_business_authorizations() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.active AND NEW.last_authorized_at IS NOT NULL THEN
    INSERT INTO device_business_authorizations(device_id,business_id,actor_id,role,last_authorized_at)
    SELECT NEW.id,m.business_id,NEW.user_id,m.role,NEW.last_authorized_at
    FROM memberships m WHERE m.user_id=NEW.user_id AND m.active
    ON CONFLICT(device_id,business_id,role) DO UPDATE SET last_authorized_at=EXCLUDED.last_authorized_at;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS device_authorization_history ON devices;
CREATE TRIGGER device_authorization_history AFTER INSERT OR UPDATE OF last_authorized_at ON devices
FOR EACH ROW EXECUTE FUNCTION record_device_business_authorizations();
