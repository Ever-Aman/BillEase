ALTER TABLE devices ADD COLUMN IF NOT EXISTS last_authorized_at timestamptz;
ALTER TABLE devices ADD COLUMN IF NOT EXISTS offline_expires_at timestamptz;
