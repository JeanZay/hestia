CREATE TABLE hestia_storage_budget (id integer PRIMARY KEY CHECK(id=1));
INSERT INTO hestia_storage_budget VALUES(1);
CREATE TABLE hestia_upload (
 id uuid PRIMARY KEY, actor_id text NOT NULL REFERENCES "user"(id), folder_id uuid NOT NULL REFERENCES hestia_folder(id),
 owner_id text NOT NULL REFERENCES "user"(id), idempotency_key uuid NOT NULL, identity_sha text NOT NULL,
 title text NOT NULL, file_name text NOT NULL, media_type text NOT NULL, size integer NOT NULL CHECK(size>0 AND size<=20971520),
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'), source text NOT NULL CHECK(source IN ('import','camera')),
 status text NOT NULL DEFAULT 'uploading' CHECK(status IN ('uploading','finalizing','completed','cancelled')),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), expires_at timestamptz NOT NULL DEFAULT clock_timestamp()+interval '1 hour',
 reservation_released boolean NOT NULL DEFAULT false, lease_until timestamptz, final_key text, keep_duplicate boolean, document_id uuid,
 UNIQUE(actor_id,folder_id,idempotency_key)
);
CREATE UNIQUE INDEX hestia_upload_active_actor ON hestia_upload(actor_id) WHERE status IN ('uploading','finalizing');
CREATE TABLE hestia_upload_object (
 object_key text PRIMARY KEY, upload_id uuid NOT NULL REFERENCES hestia_upload(id),
 kind text NOT NULL CHECK(kind IN ('chunk','original')), chunk_index integer,
 size integer NOT NULL CHECK(size>0 AND size<=20971520), sha256 text NOT NULL,
 ready boolean NOT NULL DEFAULT false, deleted_at timestamptz,
 CHECK((kind='chunk' AND chunk_index BETWEEN 0 AND 9 AND size<=2097152) OR (kind='original' AND chunk_index IS NULL))
);
CREATE UNIQUE INDEX hestia_upload_chunk ON hestia_upload_object(upload_id,chunk_index) WHERE kind='chunk' AND deleted_at IS NULL;
CREATE TABLE hestia_document (
 id uuid PRIMARY KEY, folder_id uuid NOT NULL REFERENCES hestia_folder(id), owner_id text NOT NULL REFERENCES "user"(id),
 uploaded_by text NOT NULL REFERENCES "user"(id), uploaded_by_name text NOT NULL,
 title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 200), file_name text NOT NULL,
 media_type text NOT NULL, size integer NOT NULL CHECK(size>0 AND size<=20971520), sha256 text NOT NULL,
 source text NOT NULL CHECK(source IN ('import','camera')), object_key text NOT NULL UNIQUE REFERENCES hestia_upload_object(object_key),
 preview_supported boolean NOT NULL, version integer NOT NULL DEFAULT 1 CHECK(version>0),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), trashed_at timestamptz, purged_at timestamptz
);
CREATE INDEX hestia_document_folder ON hestia_document(folder_id,created_at) WHERE purged_at IS NULL;
ALTER TABLE hestia_upload ADD CONSTRAINT hestia_upload_document_fk FOREIGN KEY(document_id) REFERENCES hestia_document(id);

