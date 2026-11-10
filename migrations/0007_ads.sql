-- Site announcements/ads only; no user identifiers, behavioral tracking, or PDF data.
CREATE TABLE IF NOT EXISTS pdf_site_ads (
 id TEXT PRIMARY KEY,
 title TEXT NOT NULL,
 body TEXT NOT NULL DEFAULT '',
 link_url TEXT NOT NULL DEFAULT '',
 starts_at INTEGER NOT NULL,
 ends_at INTEGER NOT NULL,
 duration_seconds INTEGER NOT NULL DEFAULT 0,
 enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS pdf_site_ads_schedule ON pdf_site_ads(enabled,starts_at,ends_at);
