CREATE TABLE hestia_inbox_settings (
 actor_id text PRIMARY KEY REFERENCES hestia_member(user_id), version integer NOT NULL DEFAULT 1,
 enabled boolean NOT NULL DEFAULT false, automatic_analysis boolean NOT NULL DEFAULT false
);
-- Stable environment/actor/message identity survives key epochs and byte purges.
CREATE TABLE hestia_inbox_event (
 id uuid PRIMARY KEY, environment text NOT NULL, relay_actor text NOT NULL, gmail_id_sha256 text NOT NULL,
 raw_sha256 text NOT NULL, raw_size integer NOT NULL CHECK(raw_size BETWEEN 1 AND 104857600), chunk_count integer NOT NULL CHECK(chunk_count BETWEEN 0 AND 46),
 configuration_epoch integer NOT NULL, state text NOT NULL DEFAULT 'staging' CHECK(state IN ('staging','processing','accepted','partial','no_attachments','all_rejected','message_rejected','sender_rejected')),
 first_at timestamptz NOT NULL DEFAULT clock_timestamp(), staging_until timestamptz NOT NULL, terminal_at timestamptz,
 lease_token uuid, lease_until timestamptz, owner_id text REFERENCES hestia_member(user_id), attributed_actor_id text REFERENCES hestia_member(user_id), owner_epoch integer, departure_epoch integer,
 sender text, subject text, context text, context_partial boolean NOT NULL DEFAULT false, excluded_inline integer, rejected jsonb NOT NULL DEFAULT '[]',
 notice_until timestamptz, context_purged_at timestamptz,
 UNIQUE(environment,relay_actor,gmail_id_sha256)
);
CREATE TABLE hestia_inbox_chunk (
 event_id uuid NOT NULL REFERENCES hestia_inbox_event(id), chunk_index integer NOT NULL,
 object_key text NOT NULL UNIQUE, size integer NOT NULL CHECK(size BETWEEN 1 AND 737280), sha256 text NOT NULL,
 ready boolean NOT NULL DEFAULT false, deleted_at timestamptz, purge_pending_at timestamptz,
 PRIMARY KEY(event_id,chunk_index)
);
CREATE TABLE hestia_inbox_nonce (
 environment text NOT NULL, actor text NOT NULL, nonce text NOT NULL, request_sha256 text NOT NULL, expires_at timestamptz NOT NULL,
 PRIMARY KEY(environment,actor,nonce)
);
CREATE TABLE hestia_inbox_attachment (
 id uuid PRIMARY KEY, event_id uuid NOT NULL REFERENCES hestia_inbox_event(id), position text NOT NULL,
 actor_id text NOT NULL REFERENCES hestia_member(user_id), departure_epoch integer NOT NULL, content_id uuid NOT NULL REFERENCES hestia_content(id),
 version integer NOT NULL DEFAULT 1, ready boolean NOT NULL DEFAULT false, state text NOT NULL DEFAULT 'staging' CHECK(state IN ('staging','pending','discarded','placed','purged')),
 received_at timestamptz NOT NULL DEFAULT clock_timestamp(), discarded_until timestamptz, document_id uuid REFERENCES hestia_document(id),
 comment text NOT NULL DEFAULT '', comment_version integer NOT NULL DEFAULT 1, analysis jsonb NOT NULL DEFAULT '{"status":"unavailable","suggestions":[]}',
 UNIQUE(event_id,position)
);
CREATE INDEX hestia_inbox_pending ON hestia_inbox_attachment(actor_id,state);
CREATE TABLE hestia_inbox_preview (
 token text PRIMARY KEY, actor_id text NOT NULL, actor_epoch integer NOT NULL, attachment_id uuid NOT NULL REFERENCES hestia_inbox_attachment(id),
 identity_sha256 text NOT NULL, policy_sha256 text NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE hestia_inbox_receipt (
 actor_id text NOT NULL REFERENCES hestia_member(user_id), departure_epoch integer NOT NULL, operation_id uuid NOT NULL,
 attachment_id uuid NOT NULL REFERENCES hestia_inbox_attachment(id), identity_sha256 text NOT NULL, result jsonb NOT NULL,
 committed_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(actor_id,departure_epoch,operation_id)
);
CREATE TABLE hestia_inbox_ack (
 id uuid PRIMARY KEY, event_id uuid NOT NULL UNIQUE REFERENCES hestia_inbox_event(id), actor_id text NOT NULL REFERENCES hestia_member(user_id),
 actor_epoch integer NOT NULL, email text NOT NULL, state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','sending','sent','failed','unknown','cancelled')),
 accepted integer NOT NULL, rejected integer NOT NULL, outcome text NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 first_attempt_at timestamptz, lease_until timestamptz, lease_token uuid, attempts integer NOT NULL DEFAULT 0, provider_id text
);
