-- Administrative actions only: does not contain PDF filenames, contents, notes, or device IDs.
CREATE TABLE IF NOT EXISTS pdf_admin_audit (
  id TEXT PRIMARY KEY,
  actor_id TEXT NOT NULL,
  target_id TEXT,
  action TEXT NOT NULL CHECK (action IN ('change_role','revoke_sessions','transfer_ownership')),
  details TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS pdf_admin_audit_recent ON pdf_admin_audit(created_at DESC);
