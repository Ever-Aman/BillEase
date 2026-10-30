CREATE TABLE IF NOT EXISTS request_limits (
  key_hash text PRIMARY KEY,
  hits integer NOT NULL,
  window_started_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS request_limits_window ON request_limits(window_started_at);
