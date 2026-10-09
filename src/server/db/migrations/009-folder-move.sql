-- Opaque previews contain hashes only. Receipts deliberately have no resource
-- foreign key: purging a resource must not make an old operation replayable.
CREATE TABLE hestia_move_preview (
 token uuid PRIMARY KEY,
 actor_id text NOT NULL REFERENCES hestia_member(user_id),
 actor_epoch integer NOT NULL,
 request_sha256 text NOT NULL CHECK(length(request_sha256)=64),
 state_sha256 text NOT NULL CHECK(length(state_sha256)=64),
 expires_at timestamptz NOT NULL
);
CREATE INDEX hestia_move_preview_actor ON hestia_move_preview(actor_id,expires_at);
CREATE TABLE hestia_move_receipt (
 actor_id text NOT NULL REFERENCES hestia_member(user_id),
 idempotency_key uuid NOT NULL,
 actor_epoch integer NOT NULL,
 request_sha256 text NOT NULL CHECK(length(request_sha256)=64),
 committed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(actor_id,idempotency_key)
);
