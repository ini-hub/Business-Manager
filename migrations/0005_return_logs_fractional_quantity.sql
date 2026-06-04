-- Allow fractional quantities in return_logs to support items sold by weight/measure
ALTER TABLE "return_logs" ALTER COLUMN "quantity" TYPE numeric(12, 4) USING "quantity"::numeric(12, 4);
