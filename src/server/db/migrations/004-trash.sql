ALTER TABLE hestia_document ADD COLUMN trashed_by_name text,
 ADD COLUMN last_lifecycle_action text CHECK(last_lifecycle_action IN ('trash','restore')),
 ADD COLUMN last_lifecycle_version integer;
-- Purged rows retain a technical receipt, never the document title or content.
ALTER TABLE hestia_document
 ALTER COLUMN title DROP NOT NULL, ALTER COLUMN file_name DROP NOT NULL,
 ALTER COLUMN uploaded_by_name DROP NOT NULL, ALTER COLUMN uploaded_by DROP NOT NULL,
 ALTER COLUMN size DROP NOT NULL, ALTER COLUMN sha256 DROP NOT NULL,
 ALTER COLUMN media_type DROP NOT NULL, ALTER COLUMN source DROP NOT NULL,
 ALTER COLUMN preview_supported DROP NOT NULL, ALTER COLUMN object_key DROP NOT NULL;
ALTER TABLE hestia_document ADD CONSTRAINT hestia_live_document_metadata CHECK (
 purged_at IS NOT NULL OR (title IS NOT NULL AND file_name IS NOT NULL AND uploaded_by_name IS NOT NULL
 AND uploaded_by IS NOT NULL AND size IS NOT NULL AND sha256 IS NOT NULL AND media_type IS NOT NULL
 AND source IS NOT NULL AND preview_supported IS NOT NULL AND object_key IS NOT NULL));
ALTER TABLE hestia_upload ALTER COLUMN title DROP NOT NULL, ALTER COLUMN file_name DROP NOT NULL,
 ALTER COLUMN size DROP NOT NULL, ALTER COLUMN sha256 DROP NOT NULL,
 ALTER COLUMN media_type DROP NOT NULL, ALTER COLUMN source DROP NOT NULL;
ALTER TABLE hestia_upload ADD CONSTRAINT hestia_upload_live_metadata CHECK (
 status='completed' OR (title IS NOT NULL AND file_name IS NOT NULL AND size IS NOT NULL
 AND sha256 IS NOT NULL AND media_type IS NOT NULL AND source IS NOT NULL));
CREATE INDEX hestia_trash_expiry ON hestia_document(trashed_at,id) WHERE object_key IS NOT NULL;
