ALTER TABLE hestia_folder ADD COLUMN parent_folder_id uuid REFERENCES hestia_folder(id);
ALTER TABLE hestia_folder ADD COLUMN name_key text;
ALTER TABLE hestia_folder ADD COLUMN trashed_at timestamptz;
ALTER TABLE hestia_folder ADD CONSTRAINT hestia_folder_not_self_parent CHECK(parent_folder_id IS DISTINCT FROM id);
CREATE INDEX hestia_folder_parent ON hestia_folder(parent_folder_id);
-- Historical homonyms survive. Writers serialize collision checks under the
-- policy lock; an unconditional unique index would destroy that compatibility.
CREATE INDEX hestia_folder_sibling_name ON hestia_folder(parent_folder_id,name_key);
CREATE TRIGGER hestia_folder_policy_lock BEFORE INSERT OR UPDATE OR DELETE ON hestia_folder
 FOR EACH STATEMENT EXECUTE FUNCTION hestia_lock_policy();
CREATE TABLE hestia_folder_restriction (
 id uuid PRIMARY KEY,
 folder_id uuid NOT NULL REFERENCES hestia_folder(id),
 user_id text NOT NULL REFERENCES hestia_member(user_id),
 capability text NOT NULL CHECK(capability IN ('consulter','déposer','modifier','supprimer','partager','exporter','administrer')),
 authority_grant_id uuid NOT NULL REFERENCES hestia_grant(id),
 author_id text NOT NULL REFERENCES hestia_member(user_id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(folder_id,user_id,capability)
);
CREATE TRIGGER hestia_restriction_policy_lock BEFORE INSERT OR UPDATE OR DELETE ON hestia_folder_restriction
 FOR EACH STATEMENT EXECUTE FUNCTION hestia_lock_policy();
CREATE TABLE hestia_folder_receipt (
 actor_id text NOT NULL REFERENCES hestia_member(user_id),
 idempotency_key uuid NOT NULL,
 request_sha256 text NOT NULL CHECK(length(request_sha256)=64),
 actor_epoch integer NOT NULL,
 folder_id uuid NOT NULL REFERENCES hestia_folder(id),
 kind text NOT NULL CHECK(kind IN ('create','rename')),
 committed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(actor_id,idempotency_key)
);
-- An explicit transfer of inherited management creates an independently
-- attested local reference, while cutting only the previous authority chain
-- in that subtree. Placement, creator and byte ownership are unchanged.
ALTER TABLE hestia_grant ADD COLUMN anchor_reference_id uuid REFERENCES hestia_grant(id);
CREATE TABLE hestia_management_cut (
 folder_id uuid NOT NULL REFERENCES hestia_folder(id),
 source_reference_id uuid NOT NULL REFERENCES hestia_grant(id),
 new_reference_id uuid NOT NULL UNIQUE REFERENCES hestia_grant(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(folder_id,source_reference_id)
);
CREATE TRIGGER hestia_management_cut_lock BEFORE INSERT OR UPDATE OR DELETE ON hestia_management_cut
 FOR EACH STATEMENT EXECUTE FUNCTION hestia_lock_policy();
CREATE FUNCTION hestia_tree_reference_anchor() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE source hestia_grant%ROWTYPE;
BEGIN
 IF TG_OP='UPDATE' AND NEW.anchor_reference_id IS DISTINCT FROM OLD.anchor_reference_id THEN
   RAISE EXCEPTION 'Reference anchor is immutable' USING ERRCODE='23514';
 END IF;
 IF TG_OP='INSERT' AND NEW.anchor_reference_id IS NOT NULL THEN
   SELECT * INTO source FROM hestia_grant WHERE id=NEW.anchor_reference_id;
   IF NOT FOUND OR NEW.origin<>'reference-inherited-transfer' OR NEW.kind<>'reference'
      OR source.kind<>'reference' OR source.revoked_at IS NOT NULL
      OR NEW.parent_id IS NOT NULL OR NEW.replaces_reference_id IS NOT NULL
      OR NEW.author_id IS DISTINCT FROM source.user_id OR NEW.folder_id=source.folder_id
      OR NOT (NEW.transmit <@ source.transmit)
      OR (source.expires_at IS NOT NULL AND (NEW.expires_at IS NULL OR NEW.expires_at>source.expires_at))
      OR NOT EXISTS(SELECT 1 FROM hestia_member WHERE user_id=source.user_id AND active AND departure_epoch=source.subject_epoch)
      OR NOT EXISTS(WITH RECURSIVE parents AS (
         SELECT id,parent_folder_id FROM hestia_folder WHERE id=NEW.folder_id
         UNION SELECT f.id,f.parent_folder_id FROM hestia_folder f JOIN parents p ON f.id=p.parent_folder_id
       ) SELECT 1 FROM parents WHERE id=source.folder_id) THEN
     RAISE EXCEPTION 'Invalid inherited reference anchor' USING ERRCODE='23514';
   END IF;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER hestia_tree_reference_anchor BEFORE INSERT OR UPDATE ON hestia_grant
 FOR EACH ROW EXECUTE FUNCTION hestia_tree_reference_anchor();
CREATE FUNCTION hestia_folder_tree_acyclic() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.parent_folder_id IS NOT NULL AND EXISTS(WITH RECURSIVE parents AS (
   SELECT id,parent_folder_id FROM hestia_folder WHERE id=NEW.parent_folder_id
   UNION SELECT f.id,f.parent_folder_id FROM hestia_folder f JOIN parents p ON f.id=p.parent_folder_id
 ) SELECT 1 FROM parents WHERE id=NEW.id) THEN
   RAISE EXCEPTION 'Folder cycle' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER hestia_folder_tree_acyclic BEFORE INSERT OR UPDATE ON hestia_folder
 FOR EACH ROW EXECUTE FUNCTION hestia_folder_tree_acyclic();
