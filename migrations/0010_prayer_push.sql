-- Optional Web Push subscriptions for prayer reminders. No PDF content stored.
CREATE TABLE IF NOT EXISTS pdf_prayer_push_subscriptions (
 id TEXT PRIMARY KEY,
 user_id TEXT NOT NULL,
 endpoint TEXT NOT NULL UNIQUE,
 p256dh TEXT NOT NULL,
 auth TEXT NOT NULL,
 city TEXT NOT NULL,
 country TEXT NOT NULL DEFAULT 'SA',
 timezone TEXT NOT NULL DEFAULT 'Asia/Riyadh',
 before_minutes INTEGER NOT NULL DEFAULT 0 CHECK(before_minutes IN (0,5,10,15,30)),
 adhan INTEGER NOT NULL DEFAULT 1 CHECK(adhan IN (0,1)),
 iqama INTEGER NOT NULL DEFAULT 0 CHECK(iqama IN (0,1)),
 iqama_delay INTEGER NOT NULL DEFAULT 10 CHECK(iqama_delay IN (5,10,15,20,30)),
 enabled INTEGER NOT NULL DEFAULT 1 CHECK(enabled IN (0,1)),
 created_at INTEGER NOT NULL,
 updated_at INTEGER NOT NULL,
 FOREIGN KEY(user_id) REFERENCES pdf_email_users(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS pdf_prayer_push_active_idx ON pdf_prayer_push_subscriptions(enabled,city,country);
CREATE INDEX IF NOT EXISTS pdf_prayer_push_user_idx ON pdf_prayer_push_subscriptions(user_id);
CREATE TABLE IF NOT EXISTS pdf_prayer_push_deliveries (
 subscription_id TEXT NOT NULL,
 event_key TEXT NOT NULL,
 created_at INTEGER NOT NULL,
 PRIMARY KEY(subscription_id,event_key)
);
CREATE INDEX IF NOT EXISTS pdf_prayer_push_delivery_age_idx ON pdf_prayer_push_deliveries(created_at);

CREATE TABLE IF NOT EXISTS pdf_prayer_push_times (
 city_day TEXT PRIMARY KEY,
 timings TEXT NOT NULL,
 created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS pdf_prayer_push_worker_status (
 key TEXT PRIMARY KEY,
 heartbeat_at INTEGER NOT NULL
);
