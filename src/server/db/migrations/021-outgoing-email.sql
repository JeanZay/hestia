-- Private references only: neither draft nor receipt creates a physical copy.
CREATE TABLE hestia_outgoing_draft (
 id uuid PRIMARY KEY, actor_id text NOT NULL REFERENCES "user"(id),
 actor_epoch bigint NOT NULL, departure_epoch bigint NOT NULL,
 revision integer NOT NULL DEFAULT 1 CHECK(revision>0), ciphertext text NOT NULL,
 lock_operation_id uuid, consumed_revision integer, created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(actor_id,actor_epoch,departure_epoch)
);
CREATE TABLE hestia_outgoing_selection (
 id uuid PRIMARY KEY, draft_id uuid NOT NULL REFERENCES hestia_outgoing_draft(id) ON DELETE CASCADE,
 document_id uuid NOT NULL, revision_id uuid NOT NULL, document_version integer NOT NULL,
 title_digest text NOT NULL, position integer NOT NULL CHECK(position BETWEEN 0 AND 19),
 UNIQUE(draft_id,document_id), UNIQUE(draft_id,position)
);
CREATE TABLE hestia_outgoing_operation (
 id uuid PRIMARY KEY, actor_id text NOT NULL REFERENCES "user"(id), actor_epoch bigint NOT NULL,
 departure_epoch bigint NOT NULL, draft_id uuid NOT NULL, draft_revision integer NOT NULL,
 request_id uuid NOT NULL, owner_token uuid, generation bigint,
 state text NOT NULL CHECK(state IN ('preparing','sending','accepted','failed','uncertain')),
 code text, payload_digest text, provider_id uuid, marker_at timestamptz,
 lease_until timestamptz, quiescent_at timestamptz,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(), terminal_at timestamptz,
 UNIQUE(actor_id,draft_id,draft_revision), UNIQUE(actor_id,request_id)
);
CREATE TABLE hestia_outgoing_slot (
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton), generation bigint NOT NULL DEFAULT 0,
 operation_id uuid, owner_token uuid, lease_until timestamptz,
 phase text NOT NULL DEFAULT 'free' CHECK(phase IN ('free','assembling','dispatched'))
);
INSERT INTO hestia_outgoing_slot(singleton) VALUES(true);
CREATE TABLE hestia_outgoing_admission (
 operation_id uuid PRIMARY KEY, actor_id text NOT NULL, recipients integer NOT NULL CHECK(recipients BETWEEN 1 AND 20),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX hestia_outgoing_admission_clock ON hestia_outgoing_admission(created_at);
CREATE INDEX hestia_outgoing_terminal ON hestia_outgoing_operation(terminal_at) WHERE terminal_at IS NOT NULL;
CREATE INDEX hestia_outgoing_operation_clock ON hestia_outgoing_operation(created_at,actor_id);
