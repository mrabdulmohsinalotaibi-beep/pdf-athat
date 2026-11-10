-- Run once against the PDF.ATHAT D1 database.
-- Existing accounts retain the regular user role.
ALTER TABLE pdf_email_users ADD COLUMN role TEXT NOT NULL DEFAULT 'user' CHECK(role IN ('user', 'admin'));
