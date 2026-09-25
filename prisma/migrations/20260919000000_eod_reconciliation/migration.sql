-- Cash out to the bank is its own movement: it leaves the drawer and arrives
-- in the bank, where WITHDRAWAL leaves the business entirely.
ALTER TYPE "CashTxType" ADD VALUE 'BANK_DEPOSIT';

-- A drawer is now a chain of sessions (count -> next session), so one person
-- can have several in a day.
DROP INDEX "CashSession_warehouseId_financeUserId_businessDate_key";
CREATE INDEX "CashSession_warehouseId_financeUserId_status_idx" ON "CashSession"("warehouseId", "financeUserId", "status");

ALTER TABLE "CashTransaction" ADD COLUMN "note" TEXT;
CREATE INDEX "CashTransaction_cashSessionId_idx" ON "CashTransaction"("cashSessionId");

CREATE TABLE "BankBalance" (
    "id" TEXT NOT NULL,
    "warehouseId" TEXT NOT NULL,
    "businessDate" DATE NOT NULL,
    "openingBalance" DECIMAL(14,2),
    "closingBalance" DECIMAL(14,2) NOT NULL,
    "adjustment" DECIMAL(14,2) NOT NULL DEFAULT 0,
    "note" TEXT,
    "enteredByUserId" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BankBalance_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BankBalance_warehouseId_businessDate_key" ON "BankBalance"("warehouseId", "businessDate");

ALTER TABLE "BankBalance" ADD CONSTRAINT "BankBalance_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "Warehouse"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
