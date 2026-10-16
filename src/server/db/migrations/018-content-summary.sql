-- Immutable-content summaries: no retrospective AI work for content migrated in016.
CREATE TABLE hestia_content_summary (
 content_id uuid PRIMARY KEY REFERENCES hestia_content(id),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','ready','unavailable','unknown')),
 text text, permitted boolean NOT NULL DEFAULT true, auto_origin boolean NOT NULL DEFAULT false, generation integer NOT NULL DEFAULT 1,
 request_id uuid REFERENCES hestia_classification_request(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(), not_before timestamptz NOT NULL DEFAULT '-infinity',
 CHECK(text IS NULL OR (char_length(text) BETWEEN 1 AND 200 AND text !~ '[\n\r]')),
 CHECK(status='ready' OR text IS NULL)
);
CREATE FUNCTION hestia_queue_content_summary() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO hestia_content_summary(content_id) VALUES(NEW.id);
 RETURN NEW;
END $$;
CREATE TRIGGER hestia_content_summary_queue AFTER INSERT ON hestia_content
 FOR EACH ROW EXECUTE FUNCTION hestia_queue_content_summary();
ALTER TABLE hestia_classification_request DROP CONSTRAINT hestia_classification_request_kind_check;
ALTER TABLE hestia_classification_request ADD CONSTRAINT hestia_classification_request_kind_check
 CHECK(kind IN ('analysis','check','summary','inbox_analysis'));
CREATE TABLE hestia_inbox_analysis_job (
 attachment_id uuid PRIMARY KEY REFERENCES hestia_inbox_attachment(id),
 status text NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','running','ready','unavailable','unknown','stale')),
 attachment_version integer NOT NULL, comment_version integer NOT NULL, auto_origin boolean NOT NULL DEFAULT false, generation integer NOT NULL DEFAULT 1,
 request_id uuid REFERENCES hestia_classification_request(id),
 updated_at timestamptz NOT NULL DEFAULT clock_timestamp(), not_before timestamptz NOT NULL DEFAULT '-infinity'
);
CREATE TABLE hestia_inbox_analysis_command (
 actor_id text NOT NULL REFERENCES hestia_member(user_id), idempotency_key uuid NOT NULL,
 identity_sha256 text NOT NULL, PRIMARY KEY(actor_id,idempotency_key)
);
