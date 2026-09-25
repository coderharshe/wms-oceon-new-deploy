-- Mobile is no longer mandatory: a walk-in customer often won't give one.
-- The unique index stays; Postgres treats NULLs as distinct, so many
-- customers may have no number while a number, once given, is still unique.
ALTER TABLE "Customer" ALTER COLUMN "mobile" DROP NOT NULL;
