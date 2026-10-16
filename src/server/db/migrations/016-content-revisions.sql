-- Physical originals have one charge, independent of their current placement.
CREATE TABLE hestia_content (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), object_key text NOT NULL UNIQUE,
 owner_id text NOT NULL REFERENCES "user"(id), size integer NOT NULL CHECK(size>0 AND size<=20971520),
 sha256 text NOT NULL CHECK(sha256 ~ '^[a-f0-9]{64}$'), media_type text NOT NULL,
 file_name text, preview_supported boolean NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), deleted_at timestamptz, purge_pending_at timestamptz,
 CHECK(deleted_at IS NOT NULL OR file_name IS NOT NULL)
);
CREATE INDEX hestia_content_charged_owner ON hestia_content(owner_id) WHERE deleted_at IS NULL;
CREATE TABLE hestia_document_revision (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 document_id uuid NOT NULL REFERENCES hestia_document(id) DEFERRABLE INITIALLY DEFERRED,
 content_id uuid NOT NULL REFERENCES hestia_content(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), recoverable_until timestamptz,
 UNIQUE(document_id,content_id), UNIQUE(id,document_id)
);
CREATE INDEX hestia_document_revision_expiry ON hestia_document_revision(recoverable_until,id)
 WHERE recoverable_until IS NOT NULL;
ALTER TABLE hestia_document ADD COLUMN current_revision_id uuid;
ALTER TABLE hestia_document ADD CONSTRAINT hestia_document_current_revision_fk
 FOREIGN KEY(current_revision_id,id) REFERENCES hestia_document_revision(id,document_id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE hestia_document ADD COLUMN last_revision_action_key uuid;
CREATE TABLE hestia_revision_operation (
 actor_id text NOT NULL REFERENCES "user"(id), idempotency_key uuid NOT NULL,
 actor_epoch bigint NOT NULL, departure_epoch bigint NOT NULL,
 document_id uuid NOT NULL REFERENCES hestia_document(id), revision_id uuid NOT NULL,
 expected_version integer NOT NULL, result_version integer NOT NULL, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(actor_id,idempotency_key)
);
ALTER TABLE hestia_document DROP CONSTRAINT hestia_document_source_check;
ALTER TABLE hestia_document ADD CONSTRAINT hestia_document_source_check CHECK(source IN ('import','camera','mail'));
ALTER TABLE hestia_upload DROP CONSTRAINT hestia_upload_source_check;
ALTER TABLE hestia_upload ADD CONSTRAINT hestia_upload_source_check CHECK(source IN ('import','camera','mail'));

-- Backfill metadata only; no analysis jobs for historical documents.
INSERT INTO hestia_content(object_key,owner_id,size,sha256,media_type,file_name,preview_supported,created_at)
 SELECT d.object_key,d.owner_id,d.size,d.sha256,d.media_type,COALESCE(d.file_name,''),d.preview_supported,d.created_at
 FROM hestia_document d JOIN hestia_upload_object o USING(object_key) WHERE d.object_key IS NOT NULL AND o.deleted_at IS NULL;
INSERT INTO hestia_document_revision(document_id,content_id,created_at)
 SELECT d.id,c.id,d.created_at FROM hestia_document d JOIN hestia_content c USING(object_key);
UPDATE hestia_document d SET current_revision_id=r.id FROM hestia_document_revision r WHERE r.document_id=d.id;

CREATE FUNCTION hestia_content_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.object_key IS DISTINCT FROM OLD.object_key
 OR NEW.size IS DISTINCT FROM OLD.size OR NEW.sha256 IS DISTINCT FROM OLD.sha256
 OR NEW.media_type IS DISTINCT FROM OLD.media_type OR NEW.preview_supported IS DISTINCT FROM OLD.preview_supported
 OR NEW.created_at IS DISTINCT FROM OLD.created_at
 OR (NEW.file_name IS DISTINCT FROM OLD.file_name AND NOT(NEW.deleted_at IS NOT NULL AND NEW.file_name IS NULL))
 OR (OLD.deleted_at IS NOT NULL AND NEW.deleted_at IS DISTINCT FROM OLD.deleted_at)
 THEN RAISE EXCEPTION 'immutable content'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER hestia_content_immutable BEFORE UPDATE ON hestia_content FOR EACH ROW EXECUTE FUNCTION hestia_content_immutable();
CREATE FUNCTION hestia_revision_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.id IS DISTINCT FROM OLD.id OR NEW.document_id IS DISTINCT FROM OLD.document_id
 OR NEW.content_id IS DISTINCT FROM OLD.content_id OR NEW.created_at IS DISTINCT FROM OLD.created_at
 THEN RAISE EXCEPTION 'immutable revision'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER hestia_revision_immutable BEFORE UPDATE ON hestia_document_revision FOR EACH ROW EXECUTE FUNCTION hestia_revision_immutable();

-- All writers (manual, Capture, inbox) pass through this database boundary.
CREATE FUNCTION hestia_document_content_revision() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE cid uuid; rid uuid; stamp timestamptz;
BEGIN
 IF TG_OP='UPDATE' AND NEW.object_key IS NOT DISTINCT FROM OLD.object_key THEN RETURN NEW; END IF;
 IF NEW.object_key IS NULL THEN NEW.current_revision_id:=NULL; RETURN NEW; END IF;
 stamp:=COALESCE(NULLIF(current_setting('hestia.revision_now',true),'')::timestamptz,clock_timestamp());
 INSERT INTO hestia_content(object_key,owner_id,size,sha256,media_type,file_name,preview_supported)
 VALUES(NEW.object_key,NEW.owner_id,NEW.size,NEW.sha256,NEW.media_type,NEW.file_name,NEW.preview_supported)
 ON CONFLICT(object_key) DO NOTHING;
 SELECT id INTO cid FROM hestia_content WHERE object_key=NEW.object_key AND deleted_at IS NULL AND purge_pending_at IS NULL
 AND size=NEW.size AND sha256=NEW.sha256 AND media_type=NEW.media_type AND file_name=NEW.file_name
 AND preview_supported=NEW.preview_supported AND owner_id=NEW.owner_id FOR UPDATE;
 IF cid IS NULL THEN RAISE EXCEPTION 'unavailable content'; END IF;
 IF TG_OP='UPDATE' AND OLD.current_revision_id IS NOT NULL THEN
  UPDATE hestia_document_revision SET recoverable_until=stamp+interval '168 hours' WHERE id=OLD.current_revision_id;
 END IF;
 SELECT id INTO rid FROM hestia_document_revision WHERE document_id=NEW.id AND content_id=cid;
 IF rid IS NULL THEN
  INSERT INTO hestia_document_revision(document_id,content_id,created_at) VALUES(NEW.id,cid,stamp) RETURNING id INTO rid;
 ELSE
  UPDATE hestia_document_revision SET recoverable_until=NULL WHERE id=rid AND recoverable_until>stamp;
  IF NOT FOUND THEN RAISE EXCEPTION 'expired revision'; END IF;
 END IF;
 NEW.current_revision_id:=rid;
 RETURN NEW;
END $$;
CREATE TRIGGER hestia_document_content_revision BEFORE INSERT OR UPDATE OF object_key ON hestia_document
 FOR EACH ROW EXECUTE FUNCTION hestia_document_content_revision();
