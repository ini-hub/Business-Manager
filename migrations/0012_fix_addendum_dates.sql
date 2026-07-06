-- Backfill addendum records so they carry the original sale's date.
-- SAFETY: Skips addendums whose corrected date would fall inside an already
-- approved or paid payroll period — those must be reviewed and handled manually
-- (staff may have been underpaid for those periods and require a manual adjustment).

-- Step 1: Correct addendum checkout dates, skipping any that would land
--         in a locked (approved/paid) payroll period.
UPDATE checkouts AS addendum
SET created_at = (
  SELECT MIN(orig.created_at)
  FROM checkouts orig
  WHERE orig.receipt_number = addendum.receipt_number
    AND orig.is_addendum = false
)
WHERE addendum.is_addendum = true
  AND EXISTS (
    SELECT 1 FROM checkouts orig
    WHERE orig.receipt_number = addendum.receipt_number
      AND orig.is_addendum = false
  )
  AND NOT EXISTS (
    SELECT 1 FROM payroll_periods pp
    WHERE pp.store_id = addendum.store_id
      AND pp.status IN ('approved', 'paid')
      AND (
        SELECT MIN(orig.created_at)::date
        FROM checkouts orig
        WHERE orig.receipt_number = addendum.receipt_number
          AND orig.is_addendum = false
      ) BETWEEN pp.start_date::date AND pp.end_date::date
  );

-- Step 2: Align transaction dates — apply the same safety filter so only
--         transactions for corrected addendums are touched.
UPDATE transactions t
SET transaction_date = c.created_at
FROM checkouts c
WHERE t.checkout_id = c.id
  AND c.is_addendum = true
  AND NOT EXISTS (
    SELECT 1 FROM payroll_periods pp
    WHERE pp.store_id = c.store_id
      AND pp.status IN ('approved', 'paid')
      AND c.created_at::date BETWEEN pp.start_date::date AND pp.end_date::date
  );
