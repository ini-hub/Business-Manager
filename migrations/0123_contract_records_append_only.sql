-- 0123_contract_records_append_only.sql
--
-- Enforces in the database what 0046 only promised in comments: a signature is
-- append-only, and a contract version's content never changes once written
-- (the only column that may change is superseded_at, stamped when a later
-- version replaces it).
--
-- Escape hatch for deliberate purges (test teardown, a future account-erasure
-- job): run the statement inside a transaction that first executes
--   SELECT set_config('app.allow_contract_purge', 'on', true);
-- The setting is transaction-local, so nothing in normal request handling can
-- leave it switched on.

CREATE OR REPLACE FUNCTION staff_contract_signatures_immutable() RETURNS trigger AS $$
BEGIN
  IF current_setting('app.allow_contract_purge', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'staff_contract_signatures is append-only (% refused)', TG_OP;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_staff_contract_signatures_immutable ON staff_contract_signatures;
CREATE TRIGGER trg_staff_contract_signatures_immutable
  BEFORE UPDATE OR DELETE ON staff_contract_signatures
  FOR EACH ROW EXECUTE FUNCTION staff_contract_signatures_immutable();

CREATE OR REPLACE FUNCTION staff_contract_versions_immutable() RETURNS trigger AS $$
BEGIN
  IF current_setting('app.allow_contract_purge', true) = 'on' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'staff_contract_versions rows cannot be deleted';
  END IF;
  -- UPDATE: everything except superseded_at must be unchanged.
  IF (NEW.id, NEW.staff_contract_id, NEW.version_number, NEW.contract_type, NEW.storage_key,
      NEW.file_mime_type, NEW.file_size_bytes, NEW.file_original_name, NEW.content_text,
      NEW.alt_text, NEW.content_hash, NEW.created_by_user_id, NEW.created_at)
     IS DISTINCT FROM
     (OLD.id, OLD.staff_contract_id, OLD.version_number, OLD.contract_type, OLD.storage_key,
      OLD.file_mime_type, OLD.file_size_bytes, OLD.file_original_name, OLD.content_text,
      OLD.alt_text, OLD.content_hash, OLD.created_by_user_id, OLD.created_at) THEN
    RAISE EXCEPTION 'staff_contract_versions content is immutable (only superseded_at may change)';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_staff_contract_versions_immutable ON staff_contract_versions;
CREATE TRIGGER trg_staff_contract_versions_immutable
  BEFORE UPDATE OR DELETE ON staff_contract_versions
  FOR EACH ROW EXECUTE FUNCTION staff_contract_versions_immutable();
