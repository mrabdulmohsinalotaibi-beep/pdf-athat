-- PDF.ATHAT account and ephemeral peer signaling (no PDF payload storage).
CREATE TABLE IF NOT EXISTS otp_codes (
 email TEXT PRIMARY KEY, code_hash TEXT NOT NULL, expires_at INTEGER NOT NULL,
 sent_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS sessions (
 token_hash TEXT PRIMARY KEY, email TEXT NOT NULL, device_id TEXT NOT NULL,
 device_name TEXT NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_email_idx ON sessions(email,expires_at);
CREATE TABLE IF NOT EXISTS peer_signals (
 id INTEGER PRIMARY KEY AUTOINCREMENT, email TEXT NOT NULL,
 recipient TEXT NOT NULL, sender TEXT NOT NULL,
 kind TEXT NOT NULL, payload TEXT NOT NULL, expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS signals_recipient_idx ON peer_signals(email,recipient,id);
