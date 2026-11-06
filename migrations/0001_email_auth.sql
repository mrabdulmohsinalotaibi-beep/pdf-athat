-- New tables leave earlier account/sync experiments untouched.
CREATE TABLE IF NOT EXISTS pdf_email_users (
 id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE,
 salt TEXT NOT NULL, password_hash TEXT NOT NULL, created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS pdf_email_sessions (
 token_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL REFERENCES pdf_email_users(id),
 expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS pdf_email_sessions_user ON pdf_email_sessions(user_id);
CREATE TABLE IF NOT EXISTS pdf_email_challenges (
 id TEXT PRIMARY KEY, email TEXT NOT NULL, purpose TEXT NOT NULL,
 code_hash TEXT NOT NULL, salt TEXT, password_hash TEXT,
 expires_at INTEGER NOT NULL, attempts INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS pdf_email_challenges_email ON pdf_email_challenges(email,purpose);
CREATE TABLE IF NOT EXISTS pdf_email_limits (
 key TEXT PRIMARY KEY, count INTEGER NOT NULL, expires_at INTEGER NOT NULL
);
