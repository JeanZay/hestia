-- Independent, disabled-by-default dictation settings. Sealed credentials only.
CREATE TABLE hestia_transcription_config (
 id integer PRIMARY KEY CHECK(id=1), version bigint NOT NULL DEFAULT 1 CHECK(version>0),
 provider text NOT NULL DEFAULT '', model text NOT NULL DEFAULT '', enabled boolean NOT NULL DEFAULT false,
 monthly_limit_micros bigint NOT NULL DEFAULT 0 CHECK(monthly_limit_micros BETWEEN 0 AND 1000000000000),
 currency text NOT NULL DEFAULT 'EUR' CHECK(currency='EUR'), credential_sealed text, key_set_at timestamptz,
 CHECK(NOT enabled OR (monthly_limit_micros>0 AND credential_sealed IS NOT NULL))
);
INSERT INTO hestia_transcription_config(id) VALUES(1);
-- Financial/idempotency receipts only: no audio, transcript, vocabulary or capture ID.
-- Unknown charges survive errors, configuration changes and UTC month rollover.
CREATE TABLE hestia_transcription_request (
 id uuid PRIMARY KEY, actor_id text NOT NULL REFERENCES hestia_member(user_id), actor_epoch bigint NOT NULL,
 idempotency_key uuid NOT NULL, identity_hash text NOT NULL, config_version bigint NOT NULL,
 month_start date NOT NULL, reserved_micros bigint NOT NULL CHECK(reserved_micros BETWEEN 0 AND 1000000000000),
 actual_micros bigint CHECK(actual_micros BETWEEN 0 AND 9007199254740991),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','complete','failed','stale')),
 sent_at timestamptz, settled_at timestamptz, created_at timestamptz NOT NULL,
 UNIQUE(actor_id,idempotency_key)
);
CREATE INDEX hestia_transcription_budget ON hestia_transcription_request(month_start,actual_micros);
