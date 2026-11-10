-- Short-lived WebRTC rendezvous only. No PDF bytes, titles, annotations, or keys on the server.
CREATE TABLE IF NOT EXISTS pdf_sync_peers (
  user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  device_name TEXT NOT NULL,
  last_seen INTEGER NOT NULL,
  PRIMARY KEY(user_id,device_id)
);
CREATE INDEX IF NOT EXISTS pdf_sync_peers_seen ON pdf_sync_peers(last_seen);
CREATE TABLE IF NOT EXISTS pdf_sync_signals (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  from_device TEXT NOT NULL,
  to_device TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('offer','answer')),
  payload TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS pdf_sync_signals_inbox ON pdf_sync_signals(user_id,to_device,created_at);
CREATE INDEX IF NOT EXISTS pdf_sync_signals_expiry ON pdf_sync_signals(expires_at);
