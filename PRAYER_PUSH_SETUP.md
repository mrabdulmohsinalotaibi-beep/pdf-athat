# Background prayer reminders
Web Push notifications are **opt-in** per registered account and device. Guest mode has no background push. On iPhone, the website must be added to Home Screen (iOS 16.4+).

Files: `functions/api/prayer-push/[[path]].js` (authenticated subscriptions), `prayer-background-push.js` (settings), generated `sw.js` (push handler), `workers/prayer-push-worker.mjs` (Cloudflare Worker scheduled once per minute). Files are never read or uploaded.

Required configuration:
1. Apply `migrations/0010_prayer_push.sql` **once** to the existing `PDF_AUTH_DB` D1 database.
2. Put the base64url VAPID public key in the `PRAYER_VAPID_PUBLIC` environment variable of the Pages production and preview configurations (public, no secret). Keep the matching private JWK only in the scheduled Worker's `PRAYER_VAPID_PRIVATE_JWK` encrypted secret.
3. Deploy the Worker with `PDF_AUTH_DB` binding to the existing D1 database, and configure a `*/1 * * * *` Cron Trigger (UTC).
4. Test a full subscription and a near-due test on an installed iPhone PWA. Push delivery and sound are subject to device connectivity and notification settings.

Privacy and safety:
- Push endpoints and keys are stored in D1 only after an explicit click.
- API requires the authenticated session for subscribe/unsubscribe.
- Endpoints are restricted to known push-service domains.
- Maximum 6 devices per account; no PDF contents in the push system.
- Users can unsubscribe each device. The iPhone notification sound is chosen by the OS; uploaded audio only plays when the page is open.
- The scheduler stores a deduplication key and caches daily city timings.
