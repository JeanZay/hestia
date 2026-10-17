-- Prospective metadata only. No backfill and no changes to the financial ledger.
CREATE TABLE hestia_provider_invocation_observation (
  request_id uuid PRIMARY KEY REFERENCES hestia_classification_request(id) ON DELETE CASCADE,
  measurement_version integer NOT NULL CHECK (measurement_version = 1),
  basis text NOT NULL CHECK (basis = 'SERVER_PROVIDER_INVOCATION_MONOTONIC'),
  clock text NOT NULL CHECK (clock = 'NODE_HRTIME'),
  operation text NOT NULL CHECK (operation IN ('summary','inbox_analysis','analysis','check')),
  outcome text NOT NULL CHECK (outcome IN ('resolved','rejected','timeout')),
  measurement_status text NOT NULL CHECK (measurement_status IN ('OBSERVED','CLOCK_INVALID')),
  elapsed_us bigint,
  timeout_ms integer NOT NULL CHECK (timeout_ms > 0),
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK ((measurement_status = 'OBSERVED' AND elapsed_us IS NOT NULL AND elapsed_us >= 0)
    OR (measurement_status = 'CLOCK_INVALID' AND elapsed_us IS NULL))
);
