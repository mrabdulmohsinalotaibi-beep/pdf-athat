-- Aggregated privacy-first traffic stats. Never store raw IP, full user-agent,
-- personal email, filenames, PDF content, or referrer URLs.
CREATE TABLE IF NOT EXISTS pdf_traffic_visits (
 day TEXT NOT NULL,
 visitor_hash TEXT NOT NULL,
 country TEXT NOT NULL,
 device TEXT NOT NULL,
 browser TEXT NOT NULL,
 page TEXT NOT NULL,
 visits INTEGER NOT NULL DEFAULT 1,
 last_seen INTEGER NOT NULL,
 PRIMARY KEY (day,visitor_hash,page)
);
CREATE INDEX IF NOT EXISTS pdf_traffic_day ON pdf_traffic_visits(day);
CREATE INDEX IF NOT EXISTS pdf_traffic_country_day ON pdf_traffic_visits(country,day);
