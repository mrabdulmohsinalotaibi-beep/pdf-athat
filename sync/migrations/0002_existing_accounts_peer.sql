-- Additive peer coordination only. No document content or document metadata is stored.
CREATE TABLE IF NOT EXISTS peer_signals (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 user_id TEXT NOT NULL,
 recipient TEXT NOT NULL,
 sender TEXT NOT NULL,
 kind TEXT NOT NULL,
 payload TEXT NOT NULL,
 expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS peer_signals_lookup_idx ON peer_signals(user_id,recipient,id);
CREATE TABLE IF NOT EXISTS peer_presence (
 user_id TEXT NOT NULL,
 device_id TEXT NOT NULL,
 last_seen INTEGER NOT NULL,
 PRIMARY KEY(user_id,device_id)
);
