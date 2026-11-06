# PDF.ATHAT secure peer transfer — deployment checklist

Status: **prototype on a feature branch, NOT production-ready / NOT deployed**.
PDF bytes, annotations, and all document contents remain on devices.
D1 stores only verified email sessions, device names and **short-lived signaling messages**.
A direct WebRTC DataChannel sends the PDF and associated annotations after sender confirmation.

## Provision separate service
1. Create a **new isolated D1** database, e.g. `pdf-athat-peer`; never use the original ATHAT data store. Add its ID to `wrangler.toml`.
2. In `sync/`, run `npx wrangler d1 migrations apply pdf-athat-peer --remote`.
3. Configure secrets using `npx wrangler secret put RESEND_API_KEY`,
   `npx wrangler secret put MAIL_FROM` (a verified sender),
   and `npx wrangler secret put OTP_PEPPER` (random high-entropy value).
4. Deploy via `npx wrangler deploy`; configure `pdf-sync.athat.app` DNS/Worker route for a separate API host.
5. Set website build variable `PDF_ATHAT_SYNC_API=https://pdf-sync.athat.app` in Cloudflare Pages and deploy site. Without this variable, all sync UI is disabled and existing offline reader stays unchanged.

## Required quality/security work before production
- Apply per-IP and per-email rate limits, abuse prevention and lifecycle cleanup for expired OTP, sessions and signals.
- Verify both endpoints and end-to-end transfer in iPhone Safari and Android tablet; test WiFi/mobile data and network interruptions.
- Handle resumable transfers and large files without retaining all received chunks in JS memory.
- Add session/device revocation, cancel controls and download conflict handling, account switching protection, and clearer transfer progress.
- Add authenticated TURN credential issuance for NAT-restricted networks if direct P2P fails.
- Restrict device signaling to explicitly approved peer sessions; add stronger device pairing and shared short authentication phrase or QR verification.
- Desktop app remains separate/fully offline; its sync implementation would be a separate follow-up.

**Never deploy without security review.** Standard WebRTC DataChannels are encrypted on the wire, but sender confirmation and email login do not independently guarantee peer identity. A server does not retain the original PDF.
