-- Billing at the counter never refuses a bill. Whatever was wrong with it is
-- billed anyway and written here, and the manager's Orders screen lists the
-- flagged ones to resolve. Mirrors Product.needsReview/reviewNotes.
ALTER TABLE "Order" ADD COLUMN "needsReview" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Order" ADD COLUMN "reviewNotes" TEXT;
CREATE INDEX "Order_needsReview_idx" ON "Order"("needsReview");
