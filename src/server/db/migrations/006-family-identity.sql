-- Additive identity storage. Credentials remain in the installed Better Auth schema.
CREATE TABLE hestia_installation (
 id integer PRIMARY KEY CHECK(id=1), initialized_at timestamptz, owner_id text REFERENCES "user"(id)
);
INSERT INTO hestia_installation(id,initialized_at,owner_id)
 SELECT 1,CASE WHEN user_id IS NULL THEN NULL ELSE clock_timestamp() END,user_id
 FROM (SELECT (SELECT user_id FROM hestia_member WHERE role='owner') AS user_id) owner;
CREATE TABLE hestia_identity_flow (
 id uuid PRIMARY KEY, kind text NOT NULL CHECK(kind IN ('bootstrap','invite','readmit','recovery','rotation','exceptional')),
 actor_id text REFERENCES hestia_member(user_id), actor_epoch integer, actor_role text,
 target_id text REFERENCES "user"(id), target_epoch integer,
 email text NOT NULL, name text, version integer NOT NULL DEFAULT 1,
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','proved','recovering','prepared','completed','revoked')),
 capability_digest text, browser_digest text, browser_until timestamptz,
 expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '72 hours',
 email_verified boolean NOT NULL DEFAULT false, admission_id uuid,
 prepared_password_hash text, prepared_ciphertext text, prepared_batch uuid, prepared_until timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX hestia_identity_pending_email ON hestia_identity_flow(email)
 WHERE kind='invite' AND status NOT IN ('completed','revoked');
CREATE UNIQUE INDEX hestia_identity_pending_readmit ON hestia_identity_flow(target_id)
 WHERE kind='readmit' AND status NOT IN ('completed','revoked');
CREATE INDEX hestia_identity_target ON hestia_identity_flow(target_id);
CREATE TABLE hestia_identity_proof (
 id uuid PRIMARY KEY, flow_id uuid NOT NULL REFERENCES hestia_identity_flow(id), version integer NOT NULL,
 email text NOT NULL, purpose text NOT NULL, digest text NOT NULL,
 expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '10 minutes',
 attempts integer NOT NULL DEFAULT 0, consumed_at timestamptz, revoked_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE hestia_recovery_code (
 user_id text NOT NULL REFERENCES hestia_member(user_id), batch_id uuid NOT NULL, selector text NOT NULL,
 digest text NOT NULL, consumed_at timestamptz, revoked_at timestamptz,
 PRIMARY KEY(user_id,selector)
);
CREATE TABLE hestia_identity_receipt (
 principal text NOT NULL, request_id uuid NOT NULL, operation text NOT NULL, command_digest text NOT NULL,
 result jsonb NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(principal,request_id)
);
CREATE TABLE hestia_identity_rate (
 key text NOT NULL, bucket bigint NOT NULL, count integer NOT NULL, expires_at timestamptz NOT NULL,
 PRIMARY KEY(key,bucket)
);
CREATE TABLE hestia_identity_confirmation (
 id uuid PRIMARY KEY, actor_id text NOT NULL REFERENCES hestia_member(user_id), actor_epoch integer NOT NULL,
 target_id text NOT NULL REFERENCES hestia_member(user_id), target_epoch integer NOT NULL,
 expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '5 minutes', consumed_at timestamptz
);
CREATE TABLE hestia_mail_outbox (
 id uuid PRIMARY KEY, flow_id uuid NOT NULL REFERENCES hestia_identity_flow(id), version integer NOT NULL,
 template text NOT NULL, state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','sent','failed','cancelled')),
 ciphertext text, key_version integer NOT NULL DEFAULT 1, attempts integer NOT NULL DEFAULT 0,
 next_attempt timestamptz NOT NULL DEFAULT clock_timestamp(), lease_until timestamptz, lease_id uuid,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX hestia_mail_pending ON hestia_mail_outbox(next_attempt) WHERE state IN ('pending','sending','failed');
