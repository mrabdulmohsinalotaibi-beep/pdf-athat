-- Apply after 0002_admin_role.sql. Only successfully verified emails receive administrator rights.
CREATE TABLE IF NOT EXISTS pdf_admin_allowed_emails (
 email TEXT PRIMARY KEY
);
-- Add the verified owner's email to this table through the private Cloudflare D1 console.
-- Do not hardcode credentials or create an unverified admin account.
