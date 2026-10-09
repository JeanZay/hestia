-- Immutable membership describes exactly what was active at deletion time.
-- Current pointers are cleared on restore; historical memberships never grow.
CREATE TABLE hestia_trash_group (
 id uuid PRIMARY KEY,
 root_folder_id uuid NOT NULL REFERENCES hestia_folder(id),
 original_parent_id uuid REFERENCES hestia_folder(id),
 trashed_at timestamptz NOT NULL,
 expires_at timestamptz NOT NULL,
 trashed_by_name text,
 status text NOT NULL CHECK(status IN ('trashed','restored','purged')),
 CHECK(expires_at=trashed_at+interval '168 hours')
);
ALTER TABLE hestia_folder ADD COLUMN trash_group_id uuid REFERENCES hestia_trash_group(id),
 ADD COLUMN purged_at timestamptz;
ALTER TABLE hestia_folder ALTER COLUMN name DROP NOT NULL, ALTER COLUMN name_key DROP NOT NULL;
ALTER TABLE hestia_folder ADD CONSTRAINT hestia_live_folder_metadata
 CHECK(purged_at IS NOT NULL OR (name IS NOT NULL AND name_key IS NOT NULL));
ALTER TABLE hestia_document ADD COLUMN trash_group_id uuid REFERENCES hestia_trash_group(id);
CREATE TABLE hestia_trash_folder_member (
 group_id uuid NOT NULL REFERENCES hestia_trash_group(id),
 folder_id uuid NOT NULL REFERENCES hestia_folder(id), PRIMARY KEY(group_id,folder_id)
);
CREATE TABLE hestia_trash_document_member (
 group_id uuid NOT NULL REFERENCES hestia_trash_group(id),
 document_id uuid NOT NULL REFERENCES hestia_document(id), PRIMARY KEY(group_id,document_id)
);
CREATE INDEX hestia_trash_group_expiry ON hestia_trash_group(expires_at) WHERE status='trashed';
CREATE INDEX hestia_folder_trash_group ON hestia_folder(trash_group_id);
CREATE INDEX hestia_document_trash_group ON hestia_document(trash_group_id);
CREATE TABLE hestia_trash_preview (
 token uuid PRIMARY KEY,
 actor_id text NOT NULL REFERENCES hestia_member(user_id),
 actor_epoch integer NOT NULL,
 request_sha256 text NOT NULL CHECK(length(request_sha256)=64),
 state_sha256 text NOT NULL CHECK(length(state_sha256)=64),
 expires_at timestamptz NOT NULL
);
CREATE INDEX hestia_trash_preview_actor ON hestia_trash_preview(actor_id,expires_at);
-- Receipts have no resource FK and contain no old names or access projection.
CREATE TABLE hestia_trash_receipt (
 actor_id text NOT NULL REFERENCES hestia_member(user_id),
 idempotency_key uuid NOT NULL,
 actor_epoch integer NOT NULL,
 request_sha256 text NOT NULL CHECK(length(request_sha256)=64),
 committed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(actor_id,idempotency_key)
);
