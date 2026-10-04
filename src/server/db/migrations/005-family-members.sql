-- Additive family governance. All mutations share the established policy lock.
ALTER TABLE hestia_member ADD COLUMN recovering boolean NOT NULL DEFAULT false;
ALTER TABLE hestia_member ADD COLUMN membership_version bigint NOT NULL DEFAULT 1 CHECK (membership_version > 0);
ALTER TABLE hestia_member ADD COLUMN removed_at timestamptz;
ALTER TABLE hestia_member ADD COLUMN removed_by text REFERENCES hestia_member(user_id);
CREATE FUNCTION hestia_membership_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.active IS DISTINCT FROM OLD.active OR NEW.role IS DISTINCT FROM OLD.role THEN
   NEW.membership_version := OLD.membership_version + 1;
 ELSE NEW.membership_version := OLD.membership_version;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER hestia_membership_version BEFORE UPDATE ON hestia_member
 FOR EACH ROW EXECUTE FUNCTION hestia_membership_version();

-- Existing folders were created by the shared-folder document journey (G10).
ALTER TABLE hestia_folder ADD COLUMN governance_kind text NOT NULL DEFAULT 'shared'
 CHECK (governance_kind IN ('shared','personal'));
ALTER TABLE hestia_folder ADD COLUMN admin_reference bigint GENERATED ALWAYS AS IDENTITY;
ALTER TABLE hestia_folder ADD CONSTRAINT hestia_admin_reference_unique UNIQUE(admin_reference);
ALTER TABLE hestia_folder ADD COLUMN reference_grant_id uuid REFERENCES hestia_grant(id) DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE hestia_grant ADD COLUMN replaces_reference_id uuid REFERENCES hestia_grant(id);
CREATE UNIQUE INDEX hestia_reference_predecessor ON hestia_grant(replaces_reference_id)
 WHERE replaces_reference_id IS NOT NULL;
ALTER TABLE hestia_grant ADD CONSTRAINT hestia_reference_replacement_kind
 CHECK (replaces_reference_id IS NULL OR kind='reference');

DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM hestia_grant g JOIN hestia_member m ON m.user_id=g.user_id
   JOIN hestia_folder f ON f.id=g.folder_id
   WHERE g.kind='reference' AND (g.capability<>'administrer' OR g.parent_id IS NOT NULL
     OR g.origin<>'initial' OR g.user_id<>f.created_by
     OR g.author_id IS DISTINCT FROM f.created_by OR g.batch_id IS DISTINCT FROM f.id
     OR cardinality(g.lineage)<>0
     OR g.subject_epoch > m.departure_epoch OR (g.revoked_at IS NULL
       AND (NOT m.active OR g.subject_epoch<>m.departure_epoch)))) THEN
   RAISE EXCEPTION 'Inconsistent existing folder reference';
 END IF;
END $$;
UPDATE hestia_folder f SET reference_grant_id=g.id FROM hestia_grant g
 WHERE g.folder_id=f.id AND g.kind='reference';
DROP INDEX hestia_folder_reference;
CREATE UNIQUE INDEX hestia_folder_reference ON hestia_grant(folder_id)
 WHERE kind='reference' AND revoked_at IS NULL;

-- History is append-only; changing a grant's identity cannot revive old rights.
CREATE FUNCTION hestia_grant_immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF ROW(NEW.id,NEW.folder_id,NEW.user_id,NEW.capability,NEW.kind,NEW.parent_id,
        NEW.lineage,NEW.origin,NEW.author_id,NEW.subject_epoch,NEW.batch_id,
        NEW.created_at,NEW.replaces_reference_id)
    IS DISTINCT FROM
    ROW(OLD.id,OLD.folder_id,OLD.user_id,OLD.capability,OLD.kind,OLD.parent_id,
        OLD.lineage,OLD.origin,OLD.author_id,OLD.subject_epoch,OLD.batch_id,
        OLD.created_at,OLD.replaces_reference_id) THEN
   RAISE EXCEPTION 'Grant identity is immutable' USING ERRCODE='23514';
 END IF;
 IF OLD.revoked_at IS NOT NULL AND ROW(NEW.revoked_at,NEW.transmit,NEW.expires_at)
    IS DISTINCT FROM ROW(OLD.revoked_at,OLD.transmit,OLD.expires_at) THEN
   RAISE EXCEPTION 'Revoked grant is immutable' USING ERRCODE='23514';
 END IF;
 IF NOT (NEW.transmit <@ OLD.transmit)
    OR (OLD.expires_at IS NOT NULL AND (NEW.expires_at IS NULL OR NEW.expires_at>OLD.expires_at)) THEN
   RAISE EXCEPTION 'Grant envelope cannot expand' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER hestia_grant_immutable BEFORE UPDATE ON hestia_grant
 FOR EACH ROW EXECUTE FUNCTION hestia_grant_immutable();

-- Deferred checks allow a new reference and its folder pointer in one commit.
CREATE FUNCTION hestia_check_folder_reference() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE folder_id_to_check uuid; pointer uuid; live uuid; pointed hestia_grant%ROWTYPE;
BEGIN
 IF TG_TABLE_NAME='hestia_folder' THEN folder_id_to_check:=NEW.id;
 ELSE folder_id_to_check:=NEW.folder_id; END IF;
 SELECT reference_grant_id INTO pointer FROM hestia_folder WHERE id=folder_id_to_check;
 IF NOT FOUND THEN RETURN NULL; END IF;
 IF pointer IS NOT NULL THEN
   SELECT * INTO pointed FROM hestia_grant WHERE id=pointer;
   IF NOT FOUND OR pointed.folder_id<>folder_id_to_check OR pointed.kind<>'reference' THEN
     RAISE EXCEPTION 'Invalid folder reference pointer' USING ERRCODE='23514';
   END IF;
   IF EXISTS (SELECT 1 FROM hestia_grant WHERE replaces_reference_id=pointer) THEN
     RAISE EXCEPTION 'Folder reference is not the latest' USING ERRCODE='23514';
   END IF;
 END IF;
 SELECT id INTO live FROM hestia_grant WHERE folder_id=folder_id_to_check
   AND kind='reference' AND revoked_at IS NULL;
 IF live IS NOT NULL AND pointer IS DISTINCT FROM live THEN
   RAISE EXCEPTION 'Live folder reference pointer mismatch' USING ERRCODE='23514';
 END IF;
 IF TG_TABLE_NAME='hestia_grant' THEN
   IF NEW.replaces_reference_id IS NOT NULL THEN
     IF NOT EXISTS(SELECT 1 FROM hestia_grant previous WHERE previous.id=NEW.replaces_reference_id
        AND previous.folder_id=NEW.folder_id AND previous.kind='reference'
        AND previous.revoked_at IS NOT NULL) THEN
       RAISE EXCEPTION 'Invalid reference predecessor' USING ERRCODE='23514';
     END IF;
   END IF;
 END IF;
 RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER hestia_folder_reference_consistent
 AFTER INSERT OR UPDATE ON hestia_folder DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION hestia_check_folder_reference();
CREATE CONSTRAINT TRIGGER hestia_grant_reference_consistent
 AFTER INSERT OR UPDATE ON hestia_grant DEFERRABLE INITIALLY DEFERRED
 FOR EACH ROW EXECUTE FUNCTION hestia_check_folder_reference();

CREATE TABLE hestia_membership_receipt (
 actor_id text NOT NULL REFERENCES hestia_member(user_id),
 idempotency_key uuid NOT NULL,
 kind text NOT NULL CHECK(kind IN ('remove','transfer','nominate')),
 request_sha256 text NOT NULL CHECK(length(request_sha256)=64),
 actor_epoch integer NOT NULL,
 committed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 result jsonb NOT NULL,
 PRIMARY KEY(actor_id,idempotency_key)
);
