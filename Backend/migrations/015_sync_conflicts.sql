CREATE TABLE IF NOT EXISTS sync_conflicts (
  id uuid PRIMARY KEY,
  business_id uuid NOT NULL REFERENCES businesses(id),
  actor_id uuid NOT NULL REFERENCES users(id),
  operation_id uuid NOT NULL,
  method text NOT NULL,
  path text NOT NULL,
  payload jsonb NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved')),
  resolution text CHECK (resolution IN ('discarded','superseded','retry_after_sync')),
  replacement_operation_id uuid,
  reviewed_by uuid REFERENCES users(id),
  review_note text,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  resolved_at timestamptz,
  UNIQUE (business_id,actor_id,operation_id)
);
CREATE INDEX IF NOT EXISTS sync_conflicts_inbox ON sync_conflicts(business_id,status,first_seen_at);
