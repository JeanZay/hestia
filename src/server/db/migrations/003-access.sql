ALTER TABLE hestia_member ADD COLUMN departure_epoch integer NOT NULL DEFAULT 0;
ALTER TABLE hestia_grant DROP CONSTRAINT hestia_grant_kind_check;
ALTER TABLE hestia_grant ADD CONSTRAINT hestia_grant_kind_check CHECK(kind IN ('direct','reference','delegated'));
ALTER TABLE hestia_grant ADD COLUMN parent_id uuid REFERENCES hestia_grant(id);
ALTER TABLE hestia_grant ADD COLUMN transmit text[] NOT NULL DEFAULT '{}';
ALTER TABLE hestia_grant ADD COLUMN lineage text[] NOT NULL DEFAULT '{}';
ALTER TABLE hestia_grant ADD COLUMN origin text NOT NULL DEFAULT 'initial';
ALTER TABLE hestia_grant ADD COLUMN author_id text REFERENCES "user"(id);
ALTER TABLE hestia_grant ADD COLUMN subject_epoch integer NOT NULL DEFAULT 0;
ALTER TABLE hestia_grant ADD COLUMN batch_id uuid;
ALTER TABLE hestia_grant ADD COLUMN created_at timestamptz NOT NULL DEFAULT clock_timestamp();
UPDATE hestia_grant SET transmit=ARRAY['consulter','déposer','modifier','supprimer','partager','exporter','administrer'] WHERE kind='reference';
UPDATE hestia_grant SET transmit=ARRAY['consulter','déposer','modifier','supprimer','partager','exporter'] WHERE capability='partager';
UPDATE hestia_grant g SET batch_id=g.folder_id,author_id=f.created_by FROM hestia_folder f WHERE f.id=g.folder_id AND g.user_id=f.created_by;
ALTER TABLE hestia_grant ADD CONSTRAINT hestia_grant_parent_kind CHECK((kind='delegated' AND parent_id IS NOT NULL) OR (kind IN ('direct','reference') AND parent_id IS NULL));
ALTER TABLE hestia_grant ADD CONSTRAINT hestia_grant_envelope CHECK(transmit <@ ARRAY['consulter','déposer','modifier','supprimer','partager','exporter','administrer']::text[] AND (capability IN ('partager','administrer') OR cardinality(transmit)=0));
CREATE INDEX hestia_grant_parent ON hestia_grant(parent_id);
CREATE TABLE hestia_share_receipt (
 actor_id text NOT NULL REFERENCES hestia_member(user_id), folder_id uuid NOT NULL REFERENCES hestia_folder(id),
 idempotency_key uuid NOT NULL, identity_sha text NOT NULL, batch_id uuid NOT NULL,
 PRIMARY KEY(actor_id,folder_id,idempotency_key)
);
-- Statement triggers take the family policy lock before any member/grant row
-- locks, including maintenance SQL. Web transactions use the identical order.
CREATE FUNCTION hestia_lock_policy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM pg_advisory_xact_lock(480519001); RETURN NULL; END $$;
CREATE TRIGGER hestia_member_policy_lock BEFORE INSERT OR UPDATE OR DELETE ON hestia_member FOR EACH STATEMENT EXECUTE FUNCTION hestia_lock_policy();
CREATE TRIGGER hestia_grant_policy_lock BEFORE INSERT OR UPDATE OR DELETE ON hestia_grant FOR EACH STATEMENT EXECUTE FUNCTION hestia_lock_policy();
CREATE FUNCTION hestia_member_departure() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF OLD.active AND NOT NEW.active THEN
   NEW.departure_epoch := OLD.departure_epoch+1;
   NEW.epoch := OLD.epoch+1;
   UPDATE hestia_grant SET revoked_at=COALESCE(revoked_at,clock_timestamp()) WHERE user_id=OLD.user_id;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER hestia_member_departure BEFORE UPDATE ON hestia_member FOR EACH ROW EXECUTE FUNCTION hestia_member_departure();
