CREATE TABLE hestia_member (
  user_id text PRIMARY KEY REFERENCES "user"(id) ON DELETE CASCADE,
  active boolean NOT NULL DEFAULT true,
  role text NOT NULL CHECK (role IN ('owner', 'admin', 'member')),
  epoch integer NOT NULL DEFAULT 0 CHECK (epoch >= 0)
);
CREATE UNIQUE INDEX hestia_one_owner ON hestia_member(role) WHERE role = 'owner';

CREATE TABLE hestia_session_policy (
  session_id text PRIMARY KEY REFERENCES session(id) ON DELETE CASCADE,
  member_epoch integer NOT NULL,
  started_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  touched_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE hestia_folder (
  id uuid PRIMARY KEY,
  name text NOT NULL CHECK (length(btrim(name)) BETWEEN 1 AND 120 AND name = btrim(name)),
  version integer NOT NULL DEFAULT 1 CHECK (version > 0),
  created_by text NOT NULL REFERENCES "user"(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE hestia_grant (
  id uuid PRIMARY KEY,
  folder_id uuid NOT NULL REFERENCES hestia_folder(id) ON DELETE CASCADE,
  user_id text NOT NULL REFERENCES hestia_member(user_id),
  capability text NOT NULL CHECK (capability IN ('consulter','déposer','modifier','supprimer','partager','exporter','administrer')),
  kind text NOT NULL CHECK (kind IN ('direct','reference')),
  revoked_at timestamptz,
  expires_at timestamptz,
  CHECK (kind <> 'reference' OR capability = 'administrer')
);
CREATE INDEX hestia_grant_access ON hestia_grant(user_id, folder_id) WHERE revoked_at IS NULL;
CREATE UNIQUE INDEX hestia_folder_reference ON hestia_grant(folder_id) WHERE kind = 'reference';
