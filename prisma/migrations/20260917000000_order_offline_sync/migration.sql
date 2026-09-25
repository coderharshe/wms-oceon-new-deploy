-- Offline-first billing. The till writes a bill to the PC before it reaches
-- the server, so the same bill can arrive more than once and long after it
-- was made. clientRequestId is the PC's id for it — unique, so a re-sent bill
-- finds the order it already became. offlineRef is the provisional slip
-- number (OFF-…) the customer may be holding, searchable from the Orders list.
-- Both NULL for every bill made online; Postgres treats NULLs as distinct.
ALTER TABLE "Order" ADD COLUMN "clientRequestId" TEXT;
ALTER TABLE "Order" ADD COLUMN "offlineRef" TEXT;
CREATE UNIQUE INDEX "Order_clientRequestId_key" ON "Order"("clientRequestId");
CREATE INDEX "Order_offlineRef_idx" ON "Order"("offlineRef");
