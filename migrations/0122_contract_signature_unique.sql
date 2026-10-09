-- 0122_contract_signature_unique.sql
--
-- One signature per contract version. StaffContractRepository.recordSignature
-- already guards the pending_signature -> signed flip, so a concurrent double
-- submit cannot normally reach the insert; this is the database-level backstop.
-- A re-signature after an amendment is a different version row, so it is
-- unaffected.

CREATE UNIQUE INDEX IF NOT EXISTS uq_staff_contract_signatures_version
  ON staff_contract_signatures (staff_contract_id, staff_contract_version_id);
