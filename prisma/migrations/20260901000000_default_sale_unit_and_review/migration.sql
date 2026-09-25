-- The unit a billing line opens on (peti for drinks, bag for rice), which is
-- not the base unit — that stays the smallest unit so stock never goes
-- fractional.
ALTER TABLE "ProductUnit" ADD COLUMN "isDefaultSaleUnit" BOOLEAN NOT NULL DEFAULT false;

-- Catalogue rows the import could not read with confidence.
ALTER TABLE "Product" ADD COLUMN "needsReview" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Product" ADD COLUMN "reviewNotes" TEXT;
CREATE INDEX "Product_needsReview_idx" ON "Product"("needsReview");

-- Sale units the kirana catalogue needs. factorToBase on ProductUnit carries
-- the actual size, so one global "peti"/"bag" row serves every product.
INSERT INTO "Unit" (id, name, symbol, type) VALUES
  (gen_random_uuid()::text, 'peti', 'peti', 'CUSTOM'),
  (gen_random_uuid()::text, 'bag',  'bag',  'CUSTOM')
ON CONFLICT (symbol) DO NOTHING;

-- A peti rate quoted whole (Rs 680 for 9 bottles) cannot be recovered from a
-- 2-decimal per-bottle price without drifting a few paise, so the unit can
-- carry its own price. Null means "derive from the base price".
ALTER TABLE "ProductUnit" ADD COLUMN "wholesalePrice" DECIMAL(12,2);
ALTER TABLE "ProductUnit" ADD COLUMN "retailPrice" DECIMAL(12,2);
