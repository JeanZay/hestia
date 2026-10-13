-- Dedicated slots: a legacy full-resolution preview must never be interpreted
-- as a bounded derivative, including after an application N -> N-1 -> N rollback.
ALTER TABLE hestia_capture_page
 ADD COLUMN thumbnail_key text REFERENCES hestia_capture_object(object_key),
 ADD COLUMN thumbnail_version integer,
 ADD COLUMN thumbnail_identity text,
 ADD COLUMN settings_key text REFERENCES hestia_capture_object(object_key),
 ADD COLUMN settings_version integer,
 ADD COLUMN settings_identity text,
 ADD CONSTRAINT capture_thumbnail_slot CHECK (
  (thumbnail_key IS NULL AND thumbnail_version IS NULL AND thumbnail_identity IS NULL) OR
  (thumbnail_key IS NOT NULL AND thumbnail_version IS NOT NULL AND thumbnail_version > 0 AND thumbnail_identity IS NOT NULL AND thumbnail_identity ~ '^[a-f0-9]{64}$')),
 ADD CONSTRAINT capture_settings_slot CHECK (
  (settings_key IS NULL AND settings_version IS NULL AND settings_identity IS NULL) OR
  (settings_key IS NOT NULL AND settings_version IS NOT NULL AND settings_version > 0 AND settings_identity IS NOT NULL AND settings_identity ~ '^[a-f0-9]{64}$'));

-- NULL is deliberate for historical/N-1 renders: their engine/content identity
-- has not been attested, so N must prepare once before reusing them.
ALTER TABLE hestia_capture_artifact ADD COLUMN content_sha text
 CHECK(content_sha IS NULL OR content_sha ~ '^[a-f0-9]{64}$');
