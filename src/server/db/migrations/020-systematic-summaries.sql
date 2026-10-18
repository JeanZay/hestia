-- Metadata only. Existing terminal/uncertain results and private opt-outs are
-- deliberately untouched; admission of missing current originals is bounded
-- by the background worker, never by a migration or a document read.
ALTER TABLE hestia_content_summary
 ADD COLUMN cause text CHECK(cause IN ('format','unreadable','ai-off','budget')),
 ADD COLUMN deferred boolean NOT NULL DEFAULT false,
 ADD COLUMN backfill boolean NOT NULL DEFAULT false;
CREATE INDEX hestia_content_summary_pending ON hestia_content_summary(backfill,updated_at,content_id)
 WHERE permitted AND status='pending';
CREATE INDEX hestia_summary_request_content ON hestia_classification_request((identity->>'contentId'))
 WHERE kind='summary';

-- One durable rotating first lane keeps historical summaries, new summaries
-- and private suggestions progressing even with a one-job or short tick.
CREATE TABLE hestia_summary_scheduler (
 id boolean PRIMARY KEY DEFAULT true CHECK(id),
 next_lane integer NOT NULL DEFAULT 0 CHECK(next_lane BETWEEN 0 AND 2)
);
INSERT INTO hestia_summary_scheduler(id) VALUES(true);
