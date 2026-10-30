CREATE TABLE IF NOT EXISTS requests (
 id uuid NOT NULL, business_id uuid NOT NULL REFERENCES businesses(id),
 type text NOT NULL CHECK(type IN ('bill_cancel','return','delivery_correct')),
 target_id uuid NOT NULL, payload jsonb NOT NULL, reason text NOT NULL,
 actor_id uuid NOT NULL REFERENCES users(id), state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','approved','rejected')),
 decision_by uuid REFERENCES users(id), decision_reason text, performed_operation_id uuid,
 created_at timestamptz NOT NULL DEFAULT now(), decided_at timestamptz,
 PRIMARY KEY(business_id,id)
);
CREATE INDEX IF NOT EXISTS requests_business_state ON requests(business_id,state,created_at);
CREATE UNIQUE INDEX IF NOT EXISTS one_request_per_owner_action ON requests(business_id,performed_operation_id) WHERE performed_operation_id IS NOT NULL;
