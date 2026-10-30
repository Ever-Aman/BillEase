ALTER TABLE bill_lines ADD COLUMN IF NOT EXISTS catalogue_stale boolean;
ALTER TABLE bill_lines ADD COLUMN IF NOT EXISTS stale_price boolean;
ALTER TABLE bill_lines ADD COLUMN IF NOT EXISTS current_catalogue_version_at_issue integer;
ALTER TABLE bill_lines ADD COLUMN IF NOT EXISTS current_price_minor_at_issue bigint;
