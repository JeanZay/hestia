-- Private transient aggregates, independent from placement and household role.
CREATE TABLE hestia_capture (
 id uuid PRIMARY KEY, actor_id text NOT NULL REFERENCES hestia_member(user_id), actor_epoch integer NOT NULL,
 kind text NOT NULL CHECK(kind IN ('camera','import')), idempotency_key uuid NOT NULL, identity_sha text NOT NULL,
 version integer NOT NULL DEFAULT 1 CHECK(version>0), state text NOT NULL DEFAULT 'open' CHECK(state IN ('open','preparing','finalized','abandoned','expired')),
 created_at timestamptz NOT NULL, expires_at timestamptz NOT NULL,
 current_folder_id uuid, title text NOT NULL DEFAULT 'Document', format text NOT NULL CHECK(format IN ('pdf','image','original')),
 UNIQUE(actor_id,actor_epoch,idempotency_key)
);
CREATE TABLE hestia_capture_object (
 object_key text PRIMARY KEY, capture_id uuid NOT NULL REFERENCES hestia_capture(id), owner_id text NOT NULL REFERENCES hestia_member(user_id),
 kind text NOT NULL CHECK(kind IN ('source','chunk','artifact')), charged_bytes integer NOT NULL CHECK(charged_bytes BETWEEN 0 AND 20971520),
 size integer NOT NULL CHECK(size BETWEEN 0 AND 20971520), sha256 text,
 ready boolean NOT NULL DEFAULT false, purge boolean NOT NULL DEFAULT false,
 promoted boolean NOT NULL DEFAULT false, deleted_at timestamptz,
 CHECK(NOT promoted OR kind IN ('source','artifact'))
);
CREATE INDEX hestia_capture_object_cleanup ON hestia_capture_object(capture_id) WHERE deleted_at IS NULL AND NOT promoted;
CREATE TABLE hestia_capture_page (
 id uuid PRIMARY KEY, capture_id uuid NOT NULL REFERENCES hestia_capture(id), idempotency_key uuid NOT NULL,
 identity_sha text NOT NULL, expected_version integer NOT NULL, replace_page_id uuid,
 file_name text NOT NULL, media_type text NOT NULL, size integer NOT NULL CHECK(size BETWEEN 1 AND 20971520), sha256 text NOT NULL,
 status text NOT NULL DEFAULT 'uploading' CHECK(status IN ('uploading','saved','removed')),
 object_key text NOT NULL REFERENCES hestia_capture_object(object_key),
 version integer NOT NULL DEFAULT 1, position integer NOT NULL, rotation integer NOT NULL DEFAULT 0 CHECK(rotation IN (0,90,180,270)),
 crop jsonb NOT NULL DEFAULT '{"t":0,"r":0,"b":0,"l":0}', width integer NOT NULL DEFAULT 0, height integer NOT NULL DEFAULT 0, saved_at timestamptz,
 UNIQUE(capture_id,idempotency_key)
);
CREATE TABLE hestia_capture_chunk (
 page_id uuid NOT NULL REFERENCES hestia_capture_page(id), chunk_index integer NOT NULL CHECK(chunk_index BETWEEN 0 AND 9),
 object_key text NOT NULL UNIQUE REFERENCES hestia_capture_object(object_key), PRIMARY KEY(page_id,chunk_index)
);
CREATE TABLE hestia_capture_artifact (
 id uuid PRIMARY KEY, capture_id uuid NOT NULL REFERENCES hestia_capture(id), capture_version integer NOT NULL,
 manifest_sha text NOT NULL, object_key text NOT NULL REFERENCES hestia_capture_object(object_key),
 media_type text NOT NULL, file_name text NOT NULL, size integer NOT NULL, sha256 text NOT NULL, page_count integer NOT NULL,
 UNIQUE(capture_id,capture_version)
);
CREATE TABLE hestia_capture_preview (
 token text PRIMARY KEY, capture_id uuid NOT NULL REFERENCES hestia_capture(id), actor_epoch integer NOT NULL,
 identity_sha text NOT NULL, policy_sha text NOT NULL, expires_at timestamptz NOT NULL
);
CREATE TABLE hestia_capture_receipt (
 actor_id text NOT NULL REFERENCES hestia_member(user_id), actor_epoch integer NOT NULL, idempotency_key uuid NOT NULL,
 capture_id uuid NOT NULL REFERENCES hestia_capture(id), identity_sha text NOT NULL,
 document_id uuid NOT NULL REFERENCES hestia_document(id), committed_at timestamptz NOT NULL,
 PRIMARY KEY(actor_id,actor_epoch,idempotency_key)
);
CREATE INDEX hestia_capture_expiry ON hestia_capture(expires_at) WHERE state IN ('open','preparing');
ALTER TABLE hestia_capture_page ADD COLUMN preview_key text REFERENCES hestia_capture_object(object_key), ADD COLUMN preview_version integer;
