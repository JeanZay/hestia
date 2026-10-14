-- Text preparation has its own revision: no pixel, upload or artifact mutation.
ALTER TABLE hestia_capture ADD COLUMN comment text NOT NULL DEFAULT '' CHECK(char_length(comment)<=2000);
ALTER TABLE hestia_capture ADD COLUMN comment_version integer NOT NULL DEFAULT 0 CHECK(comment_version>=0);

-- Also protects an N-1 application during a rollback: closing a preparation
-- erases its context and derived results while retaining only the cost ledger.
CREATE FUNCTION hestia_capture_comment_privacy() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
 IF NEW.state IN ('finalized','abandoned','expired') THEN NEW.comment := ''; END IF;
 IF NEW.comment_version IS DISTINCT FROM OLD.comment_version OR NEW.state IN ('finalized','abandoned','expired') THEN
  DELETE FROM hestia_capture_preview WHERE capture_id=NEW.id;
  UPDATE hestia_classification_request SET identity=NULL,folders=NULL,result=NULL,status='stale'
   WHERE kind='analysis' AND identity->>'captureId'=NEW.id::text;
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER hestia_capture_comment_privacy BEFORE UPDATE ON hestia_capture
 FOR EACH ROW EXECUTE FUNCTION hestia_capture_comment_privacy();
