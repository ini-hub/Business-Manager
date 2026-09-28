-- 0069_hr_documents.sql
--
-- hr_document_folders is a flat per-business configurable list (same
-- pattern as custom_roles/expense_categories), seeded with the 4 default
-- folders from the product spec. hr_documents reuses the presigned-S3-URL
-- upload pattern from staff_contract_versions (server/lib/objectStorage.ts)
-- rather than proxying uploads through the server.

CREATE TABLE IF NOT EXISTS hr_document_folders (
  id                VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  business_id       VARCHAR NOT NULL REFERENCES organisations(id),
  key               TEXT NOT NULL,
  label             TEXT NOT NULL,
  is_system_folder  BOOLEAN NOT NULL DEFAULT false,
  is_enabled        BOOLEAN NOT NULL DEFAULT true,
  sort_order        INTEGER NOT NULL DEFAULT 0,
  UNIQUE (business_id, key)
);

CREATE TABLE IF NOT EXISTS hr_documents (
  id                   VARCHAR PRIMARY KEY DEFAULT gen_random_uuid(),
  staff_id             VARCHAR NOT NULL REFERENCES staff(id),
  folder_id            VARCHAR NOT NULL REFERENCES hr_document_folders(id),
  file_name            TEXT NOT NULL,
  storage_key          TEXT NOT NULL,
  file_mime_type       TEXT NOT NULL,
  file_size_bytes      INTEGER NOT NULL,
  uploaded_by_user_id  VARCHAR NOT NULL REFERENCES users(id),
  uploaded_at          TIMESTAMP NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_hr_documents_staff_folder ON hr_documents (staff_id, folder_id);

INSERT INTO hr_document_folders (business_id, key, label, is_system_folder, sort_order)
SELECT o.id, f.key, f.label, true, f.sort_order
FROM organisations o
CROSS JOIN (VALUES
  ('personal_action_letter', 'Personal Action Letter', 0),
  ('employee_upload', 'Employee Upload', 1),
  ('payslip', 'Payslip', 2),
  ('reward_letter', 'Reward Letter', 3)
) AS f(key, label, sort_order)
ON CONFLICT (business_id, key) DO NOTHING;
