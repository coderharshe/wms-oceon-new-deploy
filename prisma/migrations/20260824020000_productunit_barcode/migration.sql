-- AlterTable
ALTER TABLE "ProductUnit" ADD COLUMN     "barcode" TEXT,
ADD COLUMN     "barcodeGenerated" BOOLEAN NOT NULL DEFAULT false;

-- CreateIndex
CREATE UNIQUE INDEX "ProductUnit_barcode_key" ON "ProductUnit"("barcode");
