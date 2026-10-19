-- Additive Agenda V1. Ownership follows departure_epoch, never auth recovery epoch.
CREATE TABLE hestia_agenda_card (
 id uuid PRIMARY KEY, creator_id text NOT NULL REFERENCES "user"(id), creator_departure_epoch integer NOT NULL,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), title text NOT NULL CHECK(length(btrim(title)) BETWEEN 1 AND 200),
 description text NOT NULL DEFAULT '' CHECK(length(description)<=20000), category text NOT NULL DEFAULT '' CHECK(length(category)<=80),
 start_date date, start_time time, end_date date, end_time time, start_fold text CHECK(start_fold IN ('first','second')),
 share_mode text NOT NULL CHECK(share_mode IN ('all','selected')), links jsonb NOT NULL DEFAULT '[]' CHECK(jsonb_typeof(links)='array' AND jsonb_array_length(links)<=20),
 archived_at timestamptz, creator_departed_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(start_date IS NOT NULL OR (start_time IS NULL AND end_date IS NULL AND end_time IS NULL AND start_fold IS NULL)),
 CHECK(end_date IS NULL OR end_date>=start_date), CHECK(start_fold IS NULL OR start_time IS NOT NULL)
);
CREATE INDEX hestia_agenda_card_creator ON hestia_agenda_card(creator_id,creator_departure_epoch);
CREATE TABLE hestia_agenda_member_admission (
 user_id text NOT NULL REFERENCES hestia_member(user_id), departure_epoch integer NOT NULL,
 admitted_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(user_id,departure_epoch)
);
INSERT INTO hestia_agenda_member_admission(user_id,departure_epoch) SELECT user_id,departure_epoch FROM hestia_member WHERE active;
CREATE TABLE hestia_agenda_access (
 card_id uuid NOT NULL REFERENCES hestia_agenda_card(id), user_id text NOT NULL REFERENCES hestia_member(user_id),
 subject_departure_epoch integer NOT NULL, active boolean NOT NULL DEFAULT true,
 eligibility_token uuid NOT NULL DEFAULT gen_random_uuid(), eligible_since timestamptz NOT NULL DEFAULT clock_timestamp(), ended_at timestamptz,
 PRIMARY KEY(card_id,user_id), CHECK(active=(ended_at IS NULL))
);
CREATE INDEX hestia_agenda_access_reader ON hestia_agenda_access(user_id,subject_departure_epoch,card_id) WHERE active;
CREATE TABLE hestia_agenda_document_link (
 id uuid PRIMARY KEY, card_id uuid NOT NULL REFERENCES hestia_agenda_card(id), document_id uuid NOT NULL REFERENCES hestia_document(id),
 position integer NOT NULL CHECK(position BETWEEN 0 AND 19), UNIQUE(card_id,document_id)
);
CREATE TABLE hestia_agenda_reminder (
 card_id uuid NOT NULL REFERENCES hestia_agenda_card(id), id uuid NOT NULL,
 unit text NOT NULL CHECK(unit IN ('days','hours')), value integer NOT NULL CHECK(value BETWEEN 0 AND 365 AND (unit<>'hours' OR value>=1)), send_time time,
 generation integer NOT NULL DEFAULT 1 CHECK(generation>0), due_at timestamptz, cutoff_at timestamptz,
 configuration_state text NOT NULL CHECK(configuration_state IN ('scheduled','past','clarify','stopped')),
 configured_at timestamptz NOT NULL DEFAULT clock_timestamp(), removed_at timestamptz,
 PRIMARY KEY(card_id,id), CHECK(unit<>'hours' OR send_time IS NULL)
);
CREATE INDEX hestia_agenda_reminder_due ON hestia_agenda_reminder(due_at,card_id,id) WHERE removed_at IS NULL AND configuration_state='scheduled';
CREATE TABLE hestia_agenda_delivery (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(), card_id uuid NOT NULL, reminder_id uuid NOT NULL, reminder_generation integer NOT NULL,
 recipient_id text NOT NULL REFERENCES "user"(id), recipient_departure_epoch integer NOT NULL,
 eligibility_token uuid NOT NULL, eligible_since timestamptz NOT NULL, due_at timestamptz NOT NULL, cutoff_at timestamptz NOT NULL,
 state text NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','claimed','marked','accepted','failed','cancelled','expired','uncertain')),
 lease_token uuid, fence bigint NOT NULL DEFAULT 0 CHECK(fence>=0), lease_until timestamptz,
 attempts integer NOT NULL DEFAULT 0 CHECK(attempts>=0), next_attempt_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 first_attempt_at timestamptz, marked_at timestamptz, accepted_at timestamptz,
 payload_binding text, provider_id text, error_code text, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(card_id,reminder_id) REFERENCES hestia_agenda_reminder(card_id,id),
 UNIQUE(card_id,reminder_id,reminder_generation,recipient_id,recipient_departure_epoch)
);
CREATE INDEX hestia_agenda_delivery_pending ON hestia_agenda_delivery(next_attempt_at,due_at,id) WHERE state IN ('pending','claimed','marked');
CREATE INDEX hestia_agenda_delivery_quota ON hestia_agenda_delivery(first_attempt_at) WHERE first_attempt_at IS NOT NULL;
CREATE TABLE hestia_agenda_operation (
 actor_id text NOT NULL REFERENCES "user"(id), actor_epoch integer NOT NULL, request_id uuid NOT NULL, request_sha256 text NOT NULL,
 card_id uuid NOT NULL REFERENCES hestia_agenda_card(id), committed_revision integer NOT NULL,
 committed_at timestamptz NOT NULL DEFAULT clock_timestamp(), PRIMARY KEY(actor_id,actor_epoch,request_id)
);
-- Only future uploads have attributable admission. No backfill guesses from
-- expires_at or an old actor ID; inaccessible historical uploads remain unusable.
CREATE TABLE hestia_agenda_upload_admission (
 upload_id uuid PRIMARY KEY REFERENCES hestia_upload(id) ON DELETE CASCADE, actor_id text NOT NULL REFERENCES "user"(id),
 actor_epoch integer NOT NULL, departure_epoch integer NOT NULL
);
CREATE FUNCTION hestia_agenda_bind_upload() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 INSERT INTO hestia_agenda_upload_admission(upload_id,actor_id,actor_epoch,departure_epoch)
   SELECT NEW.id,m.user_id,m.epoch,m.departure_epoch FROM hestia_member m
   WHERE m.user_id=NEW.actor_id AND m.active AND NOT m.recovering;
 RETURN NEW;
END $$;
CREATE TRIGGER hestia_agenda_bind_upload AFTER INSERT ON hestia_upload FOR EACH ROW EXECUTE FUNCTION hestia_agenda_bind_upload();
-- Same global policy lock/order as Access and membership. Direct SQL membership
-- changes also archive/freeze atomically, not only the HTTP remove handler.
CREATE TRIGGER hestia_agenda_card_policy_lock BEFORE INSERT OR UPDATE OR DELETE ON hestia_agenda_card FOR EACH STATEMENT EXECUTE FUNCTION hestia_lock_policy();
CREATE TRIGGER hestia_agenda_access_policy_lock BEFORE INSERT OR UPDATE OR DELETE ON hestia_agenda_access FOR EACH STATEMENT EXECUTE FUNCTION hestia_lock_policy();
CREATE FUNCTION hestia_agenda_membership() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF TG_OP='UPDATE' AND OLD.active AND NOT NEW.active THEN
  UPDATE hestia_agenda_card SET archived_at=COALESCE(archived_at,clock_timestamp()),creator_departed_at=clock_timestamp(),
    revision=revision+1,updated_at=clock_timestamp()
    WHERE creator_id=NEW.user_id AND creator_departure_epoch=OLD.departure_epoch AND creator_departed_at IS NULL;
  UPDATE hestia_agenda_reminder r SET configuration_state='stopped'
    FROM hestia_agenda_card c WHERE c.id=r.card_id AND c.creator_id=NEW.user_id AND c.creator_departure_epoch=OLD.departure_epoch;
  UPDATE hestia_agenda_access SET active=false,ended_at=clock_timestamp(),eligibility_token=gen_random_uuid()
    WHERE user_id=NEW.user_id AND active;
  UPDATE hestia_agenda_delivery d SET state=CASE WHEN d.first_attempt_at IS NOT NULL OR d.state IN ('marked','uncertain') THEN 'uncertain' ELSE 'cancelled' END,
    lease_token=NULL,lease_until=NULL,fence=fence+1,error_code='membership-changed'
    FROM hestia_agenda_card c WHERE c.id=d.card_id AND d.state IN ('pending','claimed','marked','failed','uncertain')
      AND (d.recipient_id=NEW.user_id OR c.creator_id=NEW.user_id AND c.creator_departure_epoch=OLD.departure_epoch);
 ELSIF NEW.active AND (TG_OP='INSERT' OR NOT OLD.active) THEN
  INSERT INTO hestia_agenda_member_admission(user_id,departure_epoch) VALUES(NEW.user_id,NEW.departure_epoch) ON CONFLICT DO NOTHING;
  INSERT INTO hestia_agenda_access(card_id,user_id,subject_departure_epoch,eligible_since)
    SELECT c.id,NEW.user_id,NEW.departure_epoch,clock_timestamp()
    FROM hestia_agenda_card c JOIN hestia_member creator ON creator.user_id=c.creator_id
    WHERE c.share_mode='all' AND c.creator_departed_at IS NULL AND creator.active AND creator.departure_epoch=c.creator_departure_epoch
    ON CONFLICT(card_id,user_id) DO UPDATE SET subject_departure_epoch=EXCLUDED.subject_departure_epoch,active=true,
      eligibility_token=gen_random_uuid(),eligible_since=EXCLUDED.eligible_since,ended_at=NULL;
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER hestia_agenda_membership AFTER INSERT OR UPDATE OF active ON hestia_member FOR EACH ROW EXECUTE FUNCTION hestia_agenda_membership();
