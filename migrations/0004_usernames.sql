-- Run once on PDF_AUTH_DB before deploying the new account forms.
ALTER TABLE pdf_email_users ADD COLUMN username TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS pdf_email_users_username_idx ON pdf_email_users(username);
ALTER TABLE pdf_email_challenges ADD COLUMN username TEXT;
-- The verified site owner's existing account gets the requested administrator login name.
UPDATE pdf_email_users SET username='admin' WHERE email='mr.abdulmohsinalotaibi@gmail.com' AND username IS NULL;
