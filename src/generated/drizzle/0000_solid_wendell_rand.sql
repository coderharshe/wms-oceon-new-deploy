-- Current sql file was generated after introspecting the database
-- If you want to run this migration please uncomment this code before executing migrations
/*
CREATE TYPE "public"."AdjustmentResolution" AS ENUM('ADDITIONAL_PAYMENT', 'CASH_REFUND', 'UPI_REFUND', 'CUSTOMER_CREDIT', 'MANAGER_ADJUSTMENT');--> statement-breakpoint
CREATE TYPE "public"."ApprovalStatus" AS ENUM('NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED');--> statement-breakpoint
CREATE TYPE "public"."BillVersionType" AS ENUM('FINANCE', 'QC_ADJUSTMENT', 'FINAL');--> statement-breakpoint
CREATE TYPE "public"."CashSessionStatus" AS ENUM('OPEN', 'CLOSED');--> statement-breakpoint
CREATE TYPE "public"."CashTxType" AS ENUM('SALE', 'REFUND', 'WITHDRAWAL', 'OTHER_RECEIPT');--> statement-breakpoint
CREATE TYPE "public"."CustomerType" AS ENUM('WHOLESALE', 'RETAIL');--> statement-breakpoint
CREATE TYPE "public"."LineChangeType" AS ENUM('KEPT', 'REDUCED', 'REMOVED', 'ADDED', 'REPLACED', 'UNAVAILABLE');--> statement-breakpoint
CREATE TYPE "public"."MovementType" AS ENUM('GRN', 'PUTAWAY', 'SALE', 'QC_ADJUSTMENT', 'RETURN', 'TRANSFER_IN', 'TRANSFER_OUT', 'DAMAGE', 'EXPIRY', 'STOCK_COUNT_ADJUSTMENT', 'MANUAL_ADJUSTMENT');--> statement-breakpoint
CREATE TYPE "public"."OrderStatus" AS ENUM('DRAFT', 'BILLED', 'PAYMENT_PENDING', 'PAID', 'READY_FOR_QC', 'QC_IN_PROGRESS', 'QC_ADJUSTMENT_REQUIRED', 'ADDITIONAL_PAYMENT_REQUIRED', 'REFUND_REQUIRED', 'READY_FOR_HANDOVER', 'COMPLETED', 'CANCELLED');--> statement-breakpoint
CREATE TYPE "public"."PaymentMethod" AS ENUM('CASH', 'UPI');--> statement-breakpoint
CREATE TYPE "public"."PaymentStatus" AS ENUM('UNPAID', 'PENDING', 'PARTIALLY_PAID', 'PAID', 'REFUND_DUE', 'REFUNDED', 'PAYMENT_ADJUSTMENT_REQUIRED');--> statement-breakpoint
CREATE TYPE "public"."QcAction" AS ENUM('KEEP', 'REDUCE', 'REMOVE', 'ADD', 'REPLACE', 'MARK_UNAVAILABLE');--> statement-breakpoint
CREATE TYPE "public"."QcSessionStatus" AS ENUM('IN_PROGRESS', 'CHANGES_REQUIRED', 'COMPLETED');--> statement-breakpoint
CREATE TYPE "public"."ReservationStatus" AS ENUM('ACTIVE', 'RELEASED', 'CONSUMED');--> statement-breakpoint
CREATE TYPE "public"."Role" AS ENUM('ADMIN', 'MANAGER', 'FINANCE', 'QC');--> statement-breakpoint
CREATE TYPE "public"."SellingMode" AS ENUM('WHOLESALE', 'RETAIL');--> statement-breakpoint
CREATE TYPE "public"."TransactionType" AS ENUM('PAYMENT', 'REFUND', 'ADJUSTMENT');--> statement-breakpoint
CREATE TYPE "public"."UnitType" AS ENUM('WEIGHT', 'VOLUME', 'COUNT', 'CUSTOM');--> statement-breakpoint
CREATE TABLE "_prisma_migrations" (
	"id" varchar(36) PRIMARY KEY NOT NULL,
	"checksum" varchar(64) NOT NULL,
	"finished_at" timestamp with time zone,
	"migration_name" varchar(255) NOT NULL,
	"logs" text,
	"rolled_back_at" timestamp with time zone,
	"started_at" timestamp with time zone DEFAULT now() NOT NULL,
	"applied_steps_count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "SystemSetting" (
	"key" text PRIMARY KEY NOT NULL,
	"value" jsonb NOT NULL,
	"updatedAt" timestamp(3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Counter" (
	"key" text PRIMARY KEY NOT NULL,
	"value" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Warehouse" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"code" text NOT NULL,
	"address" text,
	"active" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "User" (
	"id" text PRIMARY KEY NOT NULL,
	"staffId" text NOT NULL,
	"name" text NOT NULL,
	"passwordHash" text NOT NULL,
	"role" "Role" NOT NULL,
	"warehouseId" text,
	"active" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Unit" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"symbol" text NOT NULL,
	"type" "UnitType" NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ProductUnit" (
	"id" text PRIMARY KEY NOT NULL,
	"productId" text NOT NULL,
	"unitId" text NOT NULL,
	"factorToBase" numeric(14, 6) NOT NULL,
	"isBaseUnit" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Order" (
	"id" text PRIMARY KEY NOT NULL,
	"orderNumber" text NOT NULL,
	"warehouseId" text NOT NULL,
	"customerId" text NOT NULL,
	"financeUserId" text NOT NULL,
	"sellingMode" "SellingMode" NOT NULL,
	"status" "OrderStatus" DEFAULT 'DRAFT' NOT NULL,
	"notes" text,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"updatedAt" timestamp(3) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Customer" (
	"id" text PRIMARY KEY NOT NULL,
	"shopName" text NOT NULL,
	"ownerName" text,
	"mobile" text NOT NULL,
	"address" text,
	"gstin" text,
	"type" "CustomerType" NOT NULL,
	"creditLimit" numeric(12, 2),
	"outstandingBalance" numeric(12, 2) DEFAULT '0' NOT NULL,
	"status" text DEFAULT 'ACTIVE' NOT NULL,
	"notes" text,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "OrderItem" (
	"id" text PRIMARY KEY NOT NULL,
	"orderId" text NOT NULL,
	"productId" text NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"unitId" text NOT NULL,
	"unitPrice" numeric(12, 2) NOT NULL,
	"discount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"taxAmount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"lineTotal" numeric(12, 2) NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Bill" (
	"id" text PRIMARY KEY NOT NULL,
	"billNumber" text NOT NULL,
	"orderId" text NOT NULL,
	"warehouseId" text NOT NULL,
	"paymentStatus" "PaymentStatus" DEFAULT 'UNPAID' NOT NULL,
	"currentVersion" integer DEFAULT 1 NOT NULL,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "BillVersion" (
	"id" text PRIMARY KEY NOT NULL,
	"billId" text NOT NULL,
	"versionNumber" integer NOT NULL,
	"versionType" "BillVersionType" NOT NULL,
	"subtotal" numeric(12, 2) NOT NULL,
	"discountTotal" numeric(12, 2) DEFAULT '0' NOT NULL,
	"taxTotal" numeric(12, 2) DEFAULT '0' NOT NULL,
	"total" numeric(12, 2) NOT NULL,
	"reason" text,
	"createdByUserId" text NOT NULL,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "BillItem" (
	"id" text PRIMARY KEY NOT NULL,
	"billVersionId" text NOT NULL,
	"productId" text NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"unitId" text NOT NULL,
	"unitPrice" numeric(12, 2) NOT NULL,
	"discount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"taxAmount" numeric(12, 2) DEFAULT '0' NOT NULL,
	"lineTotal" numeric(12, 2) NOT NULL,
	"changeType" "LineChangeType" DEFAULT 'KEPT' NOT NULL,
	"previousQuantity" numeric(14, 3),
	"reason" text
);
--> statement-breakpoint
CREATE TABLE "Payment" (
	"id" text PRIMARY KEY NOT NULL,
	"billId" text NOT NULL,
	"amountDue" numeric(12, 2) NOT NULL,
	"amountPaid" numeric(12, 2) DEFAULT '0' NOT NULL,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "PaymentTransaction" (
	"id" text PRIMARY KEY NOT NULL,
	"paymentId" text NOT NULL,
	"type" "TransactionType" NOT NULL,
	"method" "PaymentMethod" NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"amountReceived" numeric(12, 2),
	"changeGiven" numeric(12, 2),
	"upiReference" text,
	"status" text DEFAULT 'CONFIRMED' NOT NULL,
	"recordedByUserId" text NOT NULL,
	"timestamp" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "PaymentAdjustment" (
	"id" text PRIMARY KEY NOT NULL,
	"billId" text NOT NULL,
	"previousTotal" numeric(12, 2) NOT NULL,
	"newTotal" numeric(12, 2) NOT NULL,
	"difference" numeric(12, 2) NOT NULL,
	"resolutionType" "AdjustmentResolution",
	"resolvedByUserId" text,
	"notes" text,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "CashSession" (
	"id" text PRIMARY KEY NOT NULL,
	"warehouseId" text NOT NULL,
	"financeUserId" text NOT NULL,
	"businessDate" date NOT NULL,
	"openingCash" numeric(12, 2) NOT NULL,
	"expectedCash" numeric(12, 2),
	"actualCash" numeric(12, 2),
	"difference" numeric(12, 2),
	"status" "CashSessionStatus" DEFAULT 'OPEN' NOT NULL,
	"discrepancyReason" text,
	"closedAt" timestamp(3),
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "CashTransaction" (
	"id" text PRIMARY KEY NOT NULL,
	"cashSessionId" text NOT NULL,
	"type" "CashTxType" NOT NULL,
	"amount" numeric(12, 2) NOT NULL,
	"referenceId" text,
	"timestamp" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Inventory" (
	"id" text PRIMARY KEY NOT NULL,
	"productId" text NOT NULL,
	"warehouseId" text NOT NULL,
	"quantityOnHand" numeric(14, 3) DEFAULT '0' NOT NULL,
	"quantityReserved" numeric(14, 3) DEFAULT '0' NOT NULL
);
--> statement-breakpoint
CREATE TABLE "InventoryMovement" (
	"id" text PRIMARY KEY NOT NULL,
	"productId" text NOT NULL,
	"warehouseId" text NOT NULL,
	"beforeQty" numeric(14, 3) NOT NULL,
	"movementQty" numeric(14, 3) NOT NULL,
	"afterQty" numeric(14, 3) NOT NULL,
	"movementType" "MovementType" NOT NULL,
	"referenceType" text,
	"referenceId" text,
	"userId" text NOT NULL,
	"timestamp" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "StockReservation" (
	"id" text PRIMARY KEY NOT NULL,
	"orderId" text NOT NULL,
	"productId" text NOT NULL,
	"warehouseId" text NOT NULL,
	"quantity" numeric(14, 3) NOT NULL,
	"status" "ReservationStatus" DEFAULT 'ACTIVE' NOT NULL,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"releasedAt" timestamp(3)
);
--> statement-breakpoint
CREATE TABLE "QcSession" (
	"id" text PRIMARY KEY NOT NULL,
	"orderId" text NOT NULL,
	"qcUserId" text NOT NULL,
	"status" "QcSessionStatus" DEFAULT 'IN_PROGRESS' NOT NULL,
	"startedAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"completedAt" timestamp(3)
);
--> statement-breakpoint
CREATE TABLE "QcAdjustment" (
	"id" text PRIMARY KEY NOT NULL,
	"qcSessionId" text NOT NULL,
	"productId" text NOT NULL,
	"originalQty" numeric(14, 3) NOT NULL,
	"finalQty" numeric(14, 3) NOT NULL,
	"unitId" text NOT NULL,
	"action" "QcAction" NOT NULL,
	"reason" text,
	"requiresApproval" boolean DEFAULT false NOT NULL,
	"approvalStatus" "ApprovalStatus" DEFAULT 'NOT_REQUIRED' NOT NULL,
	"approvedByUserId" text,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "QcRestrictionRule" (
	"id" text PRIMARY KEY NOT NULL,
	"productId" text,
	"warehouseId" text,
	"maxIncreasePercent" numeric(6, 2),
	"maxDecreasePercent" numeric(6, 2),
	"maxAbsoluteQty" numeric(14, 3),
	"allowAddition" boolean DEFAULT true NOT NULL,
	"allowRemoval" boolean DEFAULT true NOT NULL,
	"reasonMandatory" boolean DEFAULT true NOT NULL,
	"managerApprovalRequired" boolean DEFAULT false NOT NULL,
	"financeApprovalRequired" boolean DEFAULT false NOT NULL
);
--> statement-breakpoint
CREATE TABLE "AuditLog" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text,
	"role" "Role",
	"warehouseId" text,
	"action" text NOT NULL,
	"entityType" text NOT NULL,
	"entityId" text NOT NULL,
	"oldValue" jsonb,
	"newValue" jsonb,
	"reason" text,
	"ipAddress" text,
	"timestamp" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Notification" (
	"id" text PRIMARY KEY NOT NULL,
	"userId" text,
	"role" "Role",
	"warehouseId" text,
	"type" text NOT NULL,
	"title" text NOT NULL,
	"message" text NOT NULL,
	"read" boolean DEFAULT false NOT NULL,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL
);
--> statement-breakpoint
CREATE TABLE "Product" (
	"id" text PRIMARY KEY NOT NULL,
	"sku" text NOT NULL,
	"barcode" text,
	"qrCode" text,
	"name" text NOT NULL,
	"category" text,
	"brand" text,
	"baseUnitId" text NOT NULL,
	"wholesalePrice" numeric(12, 2) NOT NULL,
	"retailPrice" numeric(12, 2) NOT NULL,
	"taxPercent" numeric(5, 2) DEFAULT '0' NOT NULL,
	"minStock" numeric(14, 3),
	"maxStock" numeric(14, 3),
	"batchTracked" boolean DEFAULT false NOT NULL,
	"expiryTracked" boolean DEFAULT false NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"createdAt" timestamp(3) DEFAULT CURRENT_TIMESTAMP NOT NULL,
	"imageKey" text
);
--> statement-breakpoint
ALTER TABLE "User" ADD CONSTRAINT "User_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "public"."Warehouse"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ProductUnit" ADD CONSTRAINT "ProductUnit_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "ProductUnit" ADD CONSTRAINT "ProductUnit_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "public"."Unit"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Order" ADD CONSTRAINT "Order_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "public"."Warehouse"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Order" ADD CONSTRAINT "Order_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "public"."Customer"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Order" ADD CONSTRAINT "Order_financeUserId_fkey" FOREIGN KEY ("financeUserId") REFERENCES "public"."User"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "public"."Order"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "OrderItem" ADD CONSTRAINT "OrderItem_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "public"."Unit"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "public"."Order"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Bill" ADD CONSTRAINT "Bill_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "public"."Warehouse"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "BillVersion" ADD CONSTRAINT "BillVersion_billId_fkey" FOREIGN KEY ("billId") REFERENCES "public"."Bill"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "BillVersion" ADD CONSTRAINT "BillVersion_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "public"."User"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "BillItem" ADD CONSTRAINT "BillItem_billVersionId_fkey" FOREIGN KEY ("billVersionId") REFERENCES "public"."BillVersion"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "BillItem" ADD CONSTRAINT "BillItem_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "BillItem" ADD CONSTRAINT "BillItem_unitId_fkey" FOREIGN KEY ("unitId") REFERENCES "public"."Unit"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_billId_fkey" FOREIGN KEY ("billId") REFERENCES "public"."Bill"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "public"."Payment"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "PaymentTransaction" ADD CONSTRAINT "PaymentTransaction_recordedByUserId_fkey" FOREIGN KEY ("recordedByUserId") REFERENCES "public"."User"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "PaymentAdjustment" ADD CONSTRAINT "PaymentAdjustment_billId_fkey" FOREIGN KEY ("billId") REFERENCES "public"."Bill"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "CashSession" ADD CONSTRAINT "CashSession_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "public"."Warehouse"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "CashSession" ADD CONSTRAINT "CashSession_financeUserId_fkey" FOREIGN KEY ("financeUserId") REFERENCES "public"."User"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "CashTransaction" ADD CONSTRAINT "CashTransaction_cashSessionId_fkey" FOREIGN KEY ("cashSessionId") REFERENCES "public"."CashSession"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Inventory" ADD CONSTRAINT "Inventory_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "public"."Warehouse"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "public"."Warehouse"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "InventoryMovement" ADD CONSTRAINT "InventoryMovement_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "public"."Order"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "StockReservation" ADD CONSTRAINT "StockReservation_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "QcSession" ADD CONSTRAINT "QcSession_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "public"."Order"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "QcSession" ADD CONSTRAINT "QcSession_qcUserId_fkey" FOREIGN KEY ("qcUserId") REFERENCES "public"."User"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "QcAdjustment" ADD CONSTRAINT "QcAdjustment_qcSessionId_fkey" FOREIGN KEY ("qcSessionId") REFERENCES "public"."QcSession"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "QcAdjustment" ADD CONSTRAINT "QcAdjustment_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "QcRestrictionRule" ADD CONSTRAINT "QcRestrictionRule_productId_fkey" FOREIGN KEY ("productId") REFERENCES "public"."Product"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "QcRestrictionRule" ADD CONSTRAINT "QcRestrictionRule_warehouseId_fkey" FOREIGN KEY ("warehouseId") REFERENCES "public"."Warehouse"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE set null ON UPDATE cascade;--> statement-breakpoint
ALTER TABLE "Product" ADD CONSTRAINT "Product_baseUnitId_fkey" FOREIGN KEY ("baseUnitId") REFERENCES "public"."Unit"("id") ON DELETE restrict ON UPDATE cascade;--> statement-breakpoint
CREATE UNIQUE INDEX "Warehouse_code_key" ON "Warehouse" USING btree ("code" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "User_staffId_key" ON "User" USING btree ("staffId" text_ops);--> statement-breakpoint
CREATE INDEX "User_warehouseId_idx" ON "User" USING btree ("warehouseId" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "Unit_name_key" ON "Unit" USING btree ("name" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "Unit_symbol_key" ON "Unit" USING btree ("symbol" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "ProductUnit_productId_unitId_key" ON "ProductUnit" USING btree ("productId" text_ops,"unitId" text_ops);--> statement-breakpoint
CREATE INDEX "Order_customerId_idx" ON "Order" USING btree ("customerId" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "Order_orderNumber_key" ON "Order" USING btree ("orderNumber" text_ops);--> statement-breakpoint
CREATE INDEX "Order_warehouseId_status_idx" ON "Order" USING btree ("warehouseId" enum_ops,"status" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "Customer_mobile_key" ON "Customer" USING btree ("mobile" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "Bill_billNumber_key" ON "Bill" USING btree ("billNumber" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "Bill_orderId_key" ON "Bill" USING btree ("orderId" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "BillVersion_billId_versionNumber_key" ON "BillVersion" USING btree ("billId" int4_ops,"versionNumber" int4_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "Payment_billId_key" ON "Payment" USING btree ("billId" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "CashSession_warehouseId_financeUserId_businessDate_key" ON "CashSession" USING btree ("warehouseId" date_ops,"financeUserId" date_ops,"businessDate" date_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "Inventory_productId_warehouseId_key" ON "Inventory" USING btree ("productId" text_ops,"warehouseId" text_ops);--> statement-breakpoint
CREATE INDEX "InventoryMovement_productId_warehouseId_idx" ON "InventoryMovement" USING btree ("productId" text_ops,"warehouseId" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "QcRestrictionRule_productId_warehouseId_key" ON "QcRestrictionRule" USING btree ("productId" text_ops,"warehouseId" text_ops);--> statement-breakpoint
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog" USING btree ("entityType" text_ops,"entityId" text_ops);--> statement-breakpoint
CREATE INDEX "AuditLog_timestamp_idx" ON "AuditLog" USING btree ("timestamp" timestamp_ops);--> statement-breakpoint
CREATE INDEX "Notification_userId_read_idx" ON "Notification" USING btree ("userId" text_ops,"read" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "Product_barcode_key" ON "Product" USING btree ("barcode" text_ops);--> statement-breakpoint
CREATE INDEX "Product_category_idx" ON "Product" USING btree ("category" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "Product_qrCode_key" ON "Product" USING btree ("qrCode" text_ops);--> statement-breakpoint
CREATE UNIQUE INDEX "Product_sku_key" ON "Product" USING btree ("sku" text_ops);
*/