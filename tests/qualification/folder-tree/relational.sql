-- Experimental relational proof only. Not a Hestia product migration.
CREATE TABLE policy (id integer PRIMARY KEY, revision integer NOT NULL);
INSERT INTO policy VALUES (1,1);
CREATE TABLE folder (id text PRIMARY KEY, parent text REFERENCES folder(id), creator text NOT NULL,
 name text NOT NULL, name_key text NOT NULL, trashed_group text);
CREATE TABLE doc (id text PRIMARY KEY, folder_id text REFERENCES folder(id), owner_id text NOT NULL,
 object_key text NOT NULL, trashed_group text);
CREATE TABLE deletion_group (id text PRIMARY KEY, deleted_at timestamptz NOT NULL,
 deadline timestamptz NOT NULL CHECK(deadline=deleted_at+interval '168 hours'));
CREATE TABLE deletion_member (group_id text REFERENCES deletion_group(id), kind text, id text,
 PRIMARY KEY(group_id,kind,id));
CREATE TABLE receipt (actor text, op text, request_hash text NOT NULL, result text NOT NULL,
 PRIMARY KEY(actor,op));
-- Existing duplicates are seeded before the admission guard. They remain intact.
INSERT INTO folder VALUES ('root',NULL,'a','Maison','maison',NULL),
 ('sub','root','a','Travaux','travaux',NULL),('oldsub','sub','a','Ancien','ancien','old'),
 ('dup1',NULL,'a','Archives','archives',NULL),('dup2',NULL,'a','ARCHIVES','archives',NULL);
INSERT INTO doc VALUES ('active','sub','a','immutable/object',NULL),('prior','sub','a','old/object','old');
INSERT INTO deletion_group VALUES('old','2026-10-01 00:00Z','2026-10-08 00:00Z');
INSERT INTO deletion_member VALUES ('old','folder','oldsub'),('old','doc','prior');
-- Global bounded-work study lock models the existing Hestia policy lock.
CREATE FUNCTION lock_policy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN PERFORM pg_advisory_xact_lock(480519001); RETURN NULL; END $$;
CREATE TRIGGER folders_lock BEFORE INSERT OR UPDATE OR DELETE ON folder FOR EACH STATEMENT EXECUTE FUNCTION lock_policy();
CREATE FUNCTION name_available() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND ROW(NEW.parent,NEW.creator,NEW.name,NEW.trashed_group)
    IS NOT DISTINCT FROM ROW(OLD.parent,OLD.creator,OLD.name,OLD.trashed_group) THEN RETURN NEW; END IF;
 IF NEW.trashed_group IS NULL AND EXISTS(SELECT 1 FROM folder f WHERE f.id<>NEW.id
   AND f.trashed_group IS NULL AND f.name_key=NEW.name_key
   AND f.parent IS NOT DISTINCT FROM NEW.parent AND (NEW.parent IS NOT NULL OR f.creator=NEW.creator))
 THEN RAISE EXCEPTION 'name_unavailable' USING ERRCODE='23505'; END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER folders_name BEFORE INSERT OR UPDATE ON folder FOR EACH ROW EXECUTE FUNCTION name_available();
CREATE FUNCTION require_true(value boolean, message text) RETURNS void LANGUAGE plpgsql AS $$
BEGIN IF value IS DISTINCT FROM true THEN RAISE EXCEPTION 'assertion:%',message; END IF; END $$;
-- One group owns exactly the active subtree at the time of this deletion.
BEGIN;
SELECT pg_advisory_xact_lock(480519001);
INSERT INTO deletion_group VALUES('new','2026-10-07 00:00Z','2026-10-14 00:00Z');
WITH RECURSIVE affected AS (
 SELECT id FROM folder WHERE id='sub' AND trashed_group IS NULL
 UNION ALL SELECT f.id FROM folder f JOIN affected a ON f.parent=a.id WHERE f.trashed_group IS NULL
) INSERT INTO deletion_member SELECT 'new','folder',id FROM affected;
INSERT INTO deletion_member SELECT 'new','doc',d.id FROM doc d
 JOIN deletion_member m ON m.id=d.folder_id AND m.kind='folder' AND m.group_id='new' WHERE d.trashed_group IS NULL;
UPDATE folder SET trashed_group='new' WHERE id IN (SELECT id FROM deletion_member WHERE group_id='new' AND kind='folder');
UPDATE doc SET trashed_group='new' WHERE id IN (SELECT id FROM deletion_member WHERE group_id='new' AND kind='doc');
INSERT INTO receipt VALUES('a','delete-sub','body-v1','new');
COMMIT;
SELECT require_true((SELECT count(*)=2 FROM deletion_member WHERE group_id='new'),'exact-members');
SELECT require_true((SELECT deadline='2026-10-08 00:00Z' FROM deletion_group WHERE id='old'),'old-deadline');
-- Failed restore rolls back every write even after the first update.
DO $$ BEGIN
 BEGIN
  UPDATE folder SET trashed_group=NULL WHERE id='sub';
  RAISE EXCEPTION 'current-rights-refused' USING ERRCODE='42501';
 EXCEPTION WHEN insufficient_privilege THEN NULL; END;
 PERFORM require_true((SELECT trashed_group='new' FROM folder WHERE id='sub'),'restore-rollback');
END $$;
BEGIN;
SELECT pg_advisory_xact_lock(480519001);
UPDATE folder SET trashed_group=NULL WHERE trashed_group='new';
UPDATE doc SET trashed_group=NULL WHERE trashed_group='new';
COMMIT;
SELECT require_true((SELECT trashed_group='old' FROM doc WHERE id='prior'),'prior-still-trashed');
SELECT require_true((SELECT trashed_group='old' FROM folder WHERE id='oldsub'),'old-sub-still-trashed');
SELECT require_true((SELECT owner_id='a' AND object_key='immutable/object' FROM doc WHERE id='active'),'object-owner-stable');
SELECT require_true((SELECT NOT ('2026-10-14 00:00Z'::timestamptz<deadline) FROM deletion_group WHERE id='new'),'exact-deadline-denied');
DO $$ BEGIN
 BEGIN INSERT INTO receipt VALUES('a','delete-sub','other-body','other');
 EXCEPTION WHEN unique_violation THEN NULL; END;
 PERFORM require_true((SELECT count(*)=1 FROM receipt WHERE actor='a' AND op='delete-sub'),'one-receipt');
 PERFORM require_true((SELECT request_hash='body-v1' FROM receipt WHERE actor='a' AND op='delete-sub'),'body-identity-stable');
END $$;
SELECT require_true((SELECT count(*)=2 FROM folder WHERE name_key='archives'),'legacy-duplicates-preserved');
DO $$ BEGIN
 BEGIN INSERT INTO folder VALUES('newdup',NULL,'a','archives','archives',NULL);
 EXCEPTION WHEN unique_violation THEN NULL; END;
 PERFORM require_true(NOT EXISTS(SELECT 1 FROM folder WHERE id='newdup'),'new-collision-denied');
END $$;
-- A stored preview at revision 1 becomes stale after a policy mutation.
UPDATE policy SET revision=revision+1 WHERE id=1;
SELECT require_true((SELECT revision<>1 FROM policy WHERE id=1),'stale-preview-detectable');
