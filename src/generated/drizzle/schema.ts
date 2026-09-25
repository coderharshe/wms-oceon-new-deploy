import { pgTable, index, foreignKey, text, jsonb, timestamp, uniqueIndex, integer, numeric, date, boolean, varchar, pgEnum } from "drizzle-orm/pg-core"
import { sql } from "drizzle-orm"

export const adjustmentResolution = pgEnum("AdjustmentResolution", ['ADDITIONAL_PAYMENT', 'CASH_REFUND', 'UPI_REFUND', 'CUSTOMER_CREDIT', 'MANAGER_ADJUSTMENT'])
export const approvalStatus = pgEnum("ApprovalStatus", ['NOT_REQUIRED', 'PENDING', 'APPROVED', 'REJECTED'])
export const billVersionType = pgEnum("BillVersionType", ['FINANCE', 'QC_ADJUSTMENT', 'FINAL'])
export const cashSessionStatus = pgEnum("CashSessionStatus", ['OPEN', 'CLOSED'])
export const cashTxType = pgEnum("CashTxType", ['SALE', 'REFUND', 'WITHDRAWAL', 'OTHER_RECEIPT', 'BANK_DEPOSIT'])
export const customerType = pgEnum("CustomerType", ['WHOLESALE', 'RETAIL'])
export const lineChangeType = pgEnum("LineChangeType", ['KEPT', 'REDUCED', 'INCREASED', 'REMOVED', 'ADDED', 'REPLACED', 'UNAVAILABLE'])
export const movementType = pgEnum("MovementType", ['GRN', 'PUTAWAY', 'SALE', 'QC_ADJUSTMENT', 'RETURN', 'TRANSFER_IN', 'TRANSFER_OUT', 'DAMAGE', 'EXPIRY', 'STOCK_COUNT_ADJUSTMENT', 'MANUAL_ADJUSTMENT'])
export const orderStatus = pgEnum("OrderStatus", ['DRAFT', 'BILLED', 'PAYMENT_PENDING', 'PAID', 'READY_FOR_QC', 'QC_IN_PROGRESS', 'QC_ADJUSTMENT_REQUIRED', 'ADDITIONAL_PAYMENT_REQUIRED', 'REFUND_REQUIRED', 'READY_FOR_HANDOVER', 'COMPLETED', 'CANCELLED'])
export const paymentMethod = pgEnum("PaymentMethod", ['CASH', 'UPI'])
export const paymentStatus = pgEnum("PaymentStatus", ['UNPAID', 'PENDING', 'PARTIALLY_PAID', 'PAID', 'REFUND_DUE', 'REFUNDED', 'PAYMENT_ADJUSTMENT_REQUIRED'])
export const purchasePaymentStatus = pgEnum("PurchasePaymentStatus", ['UNPAID', 'PARTIAL', 'PAID'])
export const qcAction = pgEnum("QcAction", ['KEEP', 'REDUCE', 'REMOVE', 'ADD', 'REPLACE', 'MARK_UNAVAILABLE'])
export const qcSessionStatus = pgEnum("QcSessionStatus", ['IN_PROGRESS', 'CHANGES_REQUIRED', 'COMPLETED'])
export const reservationStatus = pgEnum("ReservationStatus", ['ACTIVE', 'RELEASED', 'CONSUMED'])
export const role = pgEnum("Role", ['ADMIN', 'MANAGER', 'FINANCE', 'PROCUREMENT', 'INVENTORY', 'BILLING', 'QC'])
export const sellingMode = pgEnum("SellingMode", ['WHOLESALE', 'RETAIL'])
export const transactionType = pgEnum("TransactionType", ['PAYMENT', 'REFUND', 'ADJUSTMENT'])
export const unitType = pgEnum("UnitType", ['WEIGHT', 'VOLUME', 'COUNT', 'CUSTOM'])


export const auditLog = pgTable("AuditLog", {
	id: text().primaryKey().notNull(),
	userId: text(),
	role: role(),
	warehouseId: text(),
	action: text().notNull(),
	entityType: text().notNull(),
	entityId: text().notNull(),
	oldValue: jsonb(),
	newValue: jsonb(),
	reason: text(),
	ipAddress: text(),
	timestamp: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	index("AuditLog_entityType_entityId_idx").using("btree", table.entityType.asc().nullsLast().op("text_ops"), table.entityId.asc().nullsLast().op("text_ops")),
	index("AuditLog_timestamp_idx").using("btree", table.timestamp.asc().nullsLast().op("timestamp_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "AuditLog_userId_fkey"
		}).onUpdate("cascade").onDelete("set null"),
]);

export const billVersion = pgTable("BillVersion", {
	id: text().primaryKey().notNull(),
	billId: text().notNull(),
	versionNumber: integer().notNull(),
	versionType: billVersionType().notNull(),
	subtotal: numeric({ precision: 12, scale:  2 }).notNull(),
	discountTotal: numeric({ precision: 12, scale:  2 }).default('0').notNull(),
	taxTotal: numeric({ precision: 12, scale:  2 }).default('0').notNull(),
	total: numeric({ precision: 12, scale:  2 }).notNull(),
	reason: text(),
	createdByUserId: text().notNull(),
	createdAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	uniqueIndex("BillVersion_billId_versionNumber_key").using("btree", table.billId.asc().nullsLast().op("int4_ops"), table.versionNumber.asc().nullsLast().op("int4_ops")),
	foreignKey({
			columns: [table.billId],
			foreignColumns: [bill.id],
			name: "BillVersion_billId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	foreignKey({
			columns: [table.createdByUserId],
			foreignColumns: [user.id],
			name: "BillVersion_createdByUserId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
]);

export const billItem = pgTable("BillItem", {
	id: text().primaryKey().notNull(),
	billVersionId: text().notNull(),
	productId: text().notNull(),
	quantity: numeric({ precision: 14, scale:  3 }).notNull(),
	unitId: text().notNull(),
	unitPrice: numeric({ precision: 12, scale:  2 }).notNull(),
	discount: numeric({ precision: 12, scale:  2 }).default('0').notNull(),
	taxAmount: numeric({ precision: 12, scale:  2 }).default('0').notNull(),
	lineTotal: numeric({ precision: 12, scale:  2 }).notNull(),
	changeType: lineChangeType().default('KEPT').notNull(),
	previousQuantity: numeric({ precision: 14, scale:  3 }),
	reason: text(),
}, (table) => [
	foreignKey({
			columns: [table.billVersionId],
			foreignColumns: [billVersion.id],
			name: "BillItem_billVersionId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	foreignKey({
			columns: [table.productId],
			foreignColumns: [product.id],
			name: "BillItem_productId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	foreignKey({
			columns: [table.unitId],
			foreignColumns: [unit.id],
			name: "BillItem_unitId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
]);

export const bill = pgTable("Bill", {
	id: text().primaryKey().notNull(),
	billNumber: text().notNull(),
	orderId: text().notNull(),
	warehouseId: text().notNull(),
	paymentStatus: paymentStatus().default('UNPAID').notNull(),
	currentVersion: integer().default(1).notNull(),
	createdAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	uniqueIndex("Bill_billNumber_key").using("btree", table.billNumber.asc().nullsLast().op("text_ops")),
	uniqueIndex("Bill_orderId_key").using("btree", table.orderId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.orderId],
			foreignColumns: [order.id],
			name: "Bill_orderId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	foreignKey({
			columns: [table.warehouseId],
			foreignColumns: [warehouse.id],
			name: "Bill_warehouseId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
]);

export const inventory = pgTable("Inventory", {
	id: text().primaryKey().notNull(),
	productId: text().notNull(),
	warehouseId: text().notNull(),
	quantityOnHand: numeric({ precision: 14, scale:  3 }).default('0').notNull(),
	quantityReserved: numeric({ precision: 14, scale:  3 }).default('0').notNull(),
}, (table) => [
	uniqueIndex("Inventory_productId_warehouseId_key").using("btree", table.productId.asc().nullsLast().op("text_ops"), table.warehouseId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.productId],
			foreignColumns: [product.id],
			name: "Inventory_productId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	foreignKey({
			columns: [table.warehouseId],
			foreignColumns: [warehouse.id],
			name: "Inventory_warehouseId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
]);

export const counter = pgTable("Counter", {
	key: text().primaryKey().notNull(),
	value: integer().default(0).notNull(),
});

export const cashTransaction = pgTable("CashTransaction", {
	id: text().primaryKey().notNull(),
	cashSessionId: text().notNull(),
	type: cashTxType().notNull(),
	amount: numeric({ precision: 12, scale:  2 }).notNull(),
	referenceId: text(),
	timestamp: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	note: text(),
}, (table) => [
	index("CashTransaction_cashSessionId_idx").using("btree", table.cashSessionId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.cashSessionId],
			foreignColumns: [cashSession.id],
			name: "CashTransaction_cashSessionId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
]);

export const idempotencyKey = pgTable("IdempotencyKey", {
	key: text().primaryKey().notNull(),
	createdAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
});

export const customer = pgTable("Customer", {
	id: text().primaryKey().notNull(),
	shopName: text().notNull(),
	ownerName: text(),
	mobile: text(),
	address: text(),
	gstin: text(),
	type: customerType().notNull(),
	creditLimit: numeric({ precision: 12, scale:  2 }),
	outstandingBalance: numeric({ precision: 12, scale:  2 }).default('0').notNull(),
	status: text().default('ACTIVE').notNull(),
	notes: text(),
	createdAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	uniqueIndex("Customer_mobile_key").using("btree", table.mobile.asc().nullsLast().op("text_ops")),
]);

export const cashSession = pgTable("CashSession", {
	id: text().primaryKey().notNull(),
	warehouseId: text().notNull(),
	financeUserId: text().notNull(),
	businessDate: date().notNull(),
	openingCash: numeric({ precision: 12, scale:  2 }).notNull(),
	expectedCash: numeric({ precision: 12, scale:  2 }),
	actualCash: numeric({ precision: 12, scale:  2 }),
	difference: numeric({ precision: 12, scale:  2 }),
	status: cashSessionStatus().default('OPEN').notNull(),
	discrepancyReason: text(),
	closedAt: timestamp({ precision: 3, mode: 'string' }),
	createdAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	index("CashSession_warehouseId_financeUserId_status_idx").using("btree", table.warehouseId.asc().nullsLast().op("text_ops"), table.financeUserId.asc().nullsLast().op("text_ops"), table.status.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.financeUserId],
			foreignColumns: [user.id],
			name: "CashSession_financeUserId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	foreignKey({
			columns: [table.warehouseId],
			foreignColumns: [warehouse.id],
			name: "CashSession_warehouseId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
]);

export const notification = pgTable("Notification", {
	id: text().primaryKey().notNull(),
	userId: text(),
	role: role(),
	warehouseId: text(),
	type: text().notNull(),
	title: text().notNull(),
	message: text().notNull(),
	read: boolean().default(false).notNull(),
	createdAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	index("Notification_userId_read_idx").using("btree", table.userId.asc().nullsLast().op("text_ops"), table.read.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "Notification_userId_fkey"
		}).onUpdate("cascade").onDelete("set null"),
]);

export const inventoryMovement = pgTable("InventoryMovement", {
	id: text().primaryKey().notNull(),
	productId: text().notNull(),
	warehouseId: text().notNull(),
	beforeQty: numeric({ precision: 14, scale:  3 }).notNull(),
	movementQty: numeric({ precision: 14, scale:  3 }).notNull(),
	afterQty: numeric({ precision: 14, scale:  3 }).notNull(),
	movementType: movementType().notNull(),
	referenceType: text(),
	referenceId: text(),
	userId: text().notNull(),
	timestamp: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	index("InventoryMovement_productId_warehouseId_idx").using("btree", table.productId.asc().nullsLast().op("text_ops"), table.warehouseId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.productId],
			foreignColumns: [product.id],
			name: "InventoryMovement_productId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	foreignKey({
			columns: [table.userId],
			foreignColumns: [user.id],
			name: "InventoryMovement_userId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	foreignKey({
			columns: [table.warehouseId],
			foreignColumns: [warehouse.id],
			name: "InventoryMovement_warehouseId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
]);

export const paymentAdjustment = pgTable("PaymentAdjustment", {
	id: text().primaryKey().notNull(),
	billId: text().notNull(),
	previousTotal: numeric({ precision: 12, scale:  2 }).notNull(),
	newTotal: numeric({ precision: 12, scale:  2 }).notNull(),
	difference: numeric({ precision: 12, scale:  2 }).notNull(),
	resolutionType: adjustmentResolution(),
	resolvedByUserId: text(),
	notes: text(),
	createdAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.billId],
			foreignColumns: [bill.id],
			name: "PaymentAdjustment_billId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
]);

export const payment = pgTable("Payment", {
	id: text().primaryKey().notNull(),
	billId: text().notNull(),
	amountDue: numeric({ precision: 12, scale:  2 }).notNull(),
	amountPaid: numeric({ precision: 12, scale:  2 }).default('0').notNull(),
	createdAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	uniqueIndex("Payment_billId_key").using("btree", table.billId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.billId],
			foreignColumns: [bill.id],
			name: "Payment_billId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
]);

export const purchaseBillItem = pgTable("PurchaseBillItem", {
	id: text().primaryKey().notNull(),
	purchaseBillId: text().notNull(),
	productId: text().notNull(),
	quantity: numeric({ precision: 14, scale:  3 }).notNull(),
	unitId: text().notNull(),
	rate: numeric({ precision: 12, scale:  2 }).notNull(),
	amount: numeric({ precision: 12, scale:  2 }).notNull(),
}, (table) => [
	index("PurchaseBillItem_productId_idx").using("btree", table.productId.asc().nullsLast().op("text_ops")),
	index("PurchaseBillItem_purchaseBillId_idx").using("btree", table.purchaseBillId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.productId],
			foreignColumns: [product.id],
			name: "PurchaseBillItem_productId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	foreignKey({
			columns: [table.purchaseBillId],
			foreignColumns: [purchaseBill.id],
			name: "PurchaseBillItem_purchaseBillId_fkey"
		}).onUpdate("cascade").onDelete("cascade"),
	foreignKey({
			columns: [table.unitId],
			foreignColumns: [unit.id],
			name: "PurchaseBillItem_unitId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
]);

export const order = pgTable("Order", {
	id: text().primaryKey().notNull(),
	orderNumber: text().notNull(),
	warehouseId: text().notNull(),
	customerId: text().notNull(),
	financeUserId: text().notNull(),
	sellingMode: sellingMode().notNull(),
	status: orderStatus().default('DRAFT').notNull(),
	notes: text(),
	createdAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
	needsReview: boolean().default(false).notNull(),
	reviewNotes: text(),
	clientRequestId: text(),
	offlineRef: text(),
}, (table) => [
	uniqueIndex("Order_clientRequestId_key").using("btree", table.clientRequestId.asc().nullsLast().op("text_ops")),
	index("Order_customerId_idx").using("btree", table.customerId.asc().nullsLast().op("text_ops")),
	index("Order_needsReview_idx").using("btree", table.needsReview.asc().nullsLast().op("bool_ops")),
	index("Order_offlineRef_idx").using("btree", table.offlineRef.asc().nullsLast().op("text_ops")),
	uniqueIndex("Order_orderNumber_key").using("btree", table.orderNumber.asc().nullsLast().op("text_ops")),
	index("Order_warehouseId_status_idx").using("btree", table.warehouseId.asc().nullsLast().op("enum_ops"), table.status.asc().nullsLast().op("enum_ops")),
	foreignKey({
			columns: [table.customerId],
			foreignColumns: [customer.id],
			name: "Order_customerId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	foreignKey({
			columns: [table.financeUserId],
			foreignColumns: [user.id],
			name: "Order_financeUserId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	foreignKey({
			columns: [table.warehouseId],
			foreignColumns: [warehouse.id],
			name: "Order_warehouseId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
]);

export const purchaseBill = pgTable("PurchaseBill", {
	id: text().primaryKey().notNull(),
	grnNumber: text().notNull(),
	supplierBillNo: text().notNull(),
	billDate: date().notNull(),
	supplierId: text().notNull(),
	warehouseId: text().notNull(),
	subtotal: numeric({ precision: 12, scale:  2 }).notNull(),
	gstAmount: numeric({ precision: 12, scale:  2 }).default('0').notNull(),
	otherCharges: numeric({ precision: 12, scale:  2 }).default('0').notNull(),
	total: numeric({ precision: 12, scale:  2 }).notNull(),
	paymentStatus: purchasePaymentStatus().default('UNPAID').notNull(),
	dueDate: date(),
	notes: text(),
	invoiceKeys: text().array().default(["RAY"]),
	receivedByUserId: text().notNull(),
	createdAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	uniqueIndex("PurchaseBill_grnNumber_key").using("btree", table.grnNumber.asc().nullsLast().op("text_ops")),
	uniqueIndex("PurchaseBill_supplierId_supplierBillNo_key").using("btree", table.supplierId.asc().nullsLast().op("text_ops"), table.supplierBillNo.asc().nullsLast().op("text_ops")),
	index("PurchaseBill_warehouseId_createdAt_idx").using("btree", table.warehouseId.asc().nullsLast().op("text_ops"), table.createdAt.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.receivedByUserId],
			foreignColumns: [user.id],
			name: "PurchaseBill_receivedByUserId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	foreignKey({
			columns: [table.supplierId],
			foreignColumns: [supplier.id],
			name: "PurchaseBill_supplierId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	foreignKey({
			columns: [table.warehouseId],
			foreignColumns: [warehouse.id],
			name: "PurchaseBill_warehouseId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
]);

export const qcAdjustment = pgTable("QcAdjustment", {
	id: text().primaryKey().notNull(),
	qcSessionId: text().notNull(),
	productId: text().notNull(),
	originalQty: numeric({ precision: 14, scale:  3 }).notNull(),
	finalQty: numeric({ precision: 14, scale:  3 }).notNull(),
	unitId: text().notNull(),
	action: qcAction().notNull(),
	reason: text(),
	requiresApproval: boolean().default(false).notNull(),
	approvalStatus: approvalStatus().default('NOT_REQUIRED').notNull(),
	approvedByUserId: text(),
	createdAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.productId],
			foreignColumns: [product.id],
			name: "QcAdjustment_productId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	foreignKey({
			columns: [table.qcSessionId],
			foreignColumns: [qcSession.id],
			name: "QcAdjustment_qcSessionId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
]);

export const qcRestrictionRule = pgTable("QcRestrictionRule", {
	id: text().primaryKey().notNull(),
	productId: text(),
	warehouseId: text(),
	maxIncreasePercent: numeric({ precision: 6, scale:  2 }),
	maxDecreasePercent: numeric({ precision: 6, scale:  2 }),
	maxAbsoluteQty: numeric({ precision: 14, scale:  3 }),
	allowAddition: boolean().default(true).notNull(),
	allowRemoval: boolean().default(true).notNull(),
	reasonMandatory: boolean().default(true).notNull(),
	managerApprovalRequired: boolean().default(false).notNull(),
	financeApprovalRequired: boolean().default(false).notNull(),
}, (table) => [
	uniqueIndex("QcRestrictionRule_productId_warehouseId_key").using("btree", table.productId.asc().nullsLast().op("text_ops"), table.warehouseId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.productId],
			foreignColumns: [product.id],
			name: "QcRestrictionRule_productId_fkey"
		}).onUpdate("cascade").onDelete("set null"),
	foreignKey({
			columns: [table.warehouseId],
			foreignColumns: [warehouse.id],
			name: "QcRestrictionRule_warehouseId_fkey"
		}).onUpdate("cascade").onDelete("set null"),
]);

export const orderItem = pgTable("OrderItem", {
	id: text().primaryKey().notNull(),
	orderId: text().notNull(),
	productId: text().notNull(),
	quantity: numeric({ precision: 14, scale:  3 }).notNull(),
	unitId: text().notNull(),
	unitPrice: numeric({ precision: 12, scale:  2 }).notNull(),
	discount: numeric({ precision: 12, scale:  2 }).default('0').notNull(),
	taxAmount: numeric({ precision: 12, scale:  2 }).default('0').notNull(),
	lineTotal: numeric({ precision: 12, scale:  2 }).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.orderId],
			foreignColumns: [order.id],
			name: "OrderItem_orderId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	foreignKey({
			columns: [table.productId],
			foreignColumns: [product.id],
			name: "OrderItem_productId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	foreignKey({
			columns: [table.unitId],
			foreignColumns: [unit.id],
			name: "OrderItem_unitId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
]);

export const stockReservation = pgTable("StockReservation", {
	id: text().primaryKey().notNull(),
	orderId: text().notNull(),
	productId: text().notNull(),
	warehouseId: text().notNull(),
	quantity: numeric({ precision: 14, scale:  3 }).notNull(),
	status: reservationStatus().default('ACTIVE').notNull(),
	createdAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	releasedAt: timestamp({ precision: 3, mode: 'string' }),
}, (table) => [
	foreignKey({
			columns: [table.orderId],
			foreignColumns: [order.id],
			name: "StockReservation_orderId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	foreignKey({
			columns: [table.productId],
			foreignColumns: [product.id],
			name: "StockReservation_productId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
]);

export const systemSetting = pgTable("SystemSetting", {
	key: text().primaryKey().notNull(),
	value: jsonb().notNull(),
	updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
});

export const warehouse = pgTable("Warehouse", {
	id: text().primaryKey().notNull(),
	name: text().notNull(),
	code: text().notNull(),
	address: text(),
	active: boolean().default(true).notNull(),
	createdAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	uniqueIndex("Warehouse_code_key").using("btree", table.code.asc().nullsLast().op("text_ops")),
]);

export const unit = pgTable("Unit", {
	id: text().primaryKey().notNull(),
	name: text().notNull(),
	symbol: text().notNull(),
	type: unitType().notNull(),
}, (table) => [
	uniqueIndex("Unit_name_key").using("btree", table.name.asc().nullsLast().op("text_ops")),
	uniqueIndex("Unit_symbol_key").using("btree", table.symbol.asc().nullsLast().op("text_ops")),
]);

export const supplier = pgTable("Supplier", {
	id: text().primaryKey().notNull(),
	name: text().notNull(),
	contactPerson: text(),
	phone: text(),
	email: text(),
	address: text(),
	gstin: text(),
	notes: text(),
	active: boolean().default(true).notNull(),
	createdAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	uniqueIndex("Supplier_name_key").using("btree", table.name.asc().nullsLast().op("text_ops")),
]);

export const prismaMigrations = pgTable("_prisma_migrations", {
	id: varchar({ length: 36 }).primaryKey().notNull(),
	checksum: varchar({ length: 64 }).notNull(),
	finishedAt: timestamp("finished_at", { withTimezone: true, mode: 'string' }),
	migrationName: varchar("migration_name", { length: 255 }).notNull(),
	logs: text(),
	rolledBackAt: timestamp("rolled_back_at", { withTimezone: true, mode: 'string' }),
	startedAt: timestamp("started_at", { withTimezone: true, mode: 'string' }).defaultNow().notNull(),
	appliedStepsCount: integer("applied_steps_count").default(0).notNull(),
});

export const user = pgTable("User", {
	id: text().primaryKey().notNull(),
	staffId: text().notNull(),
	name: text().notNull(),
	passwordHash: text().notNull(),
	role: role().notNull(),
	warehouseId: text(),
	active: boolean().default(true).notNull(),
	createdAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	uniqueIndex("User_staffId_key").using("btree", table.staffId.asc().nullsLast().op("text_ops")),
	index("User_warehouseId_idx").using("btree", table.warehouseId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.warehouseId],
			foreignColumns: [warehouse.id],
			name: "User_warehouseId_fkey"
		}).onUpdate("cascade").onDelete("set null"),
]);

export const paymentTransaction = pgTable("PaymentTransaction", {
	id: text().primaryKey().notNull(),
	paymentId: text().notNull(),
	type: transactionType().notNull(),
	method: paymentMethod().notNull(),
	amount: numeric({ precision: 12, scale:  2 }).notNull(),
	amountReceived: numeric({ precision: 12, scale:  2 }),
	changeGiven: numeric({ precision: 12, scale:  2 }),
	upiReference: text(),
	status: text().default('CONFIRMED').notNull(),
	recordedByUserId: text().notNull(),
	timestamp: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	clickedAt: timestamp({ precision: 3, mode: 'string' }),
}, (table) => [
	foreignKey({
			columns: [table.paymentId],
			foreignColumns: [payment.id],
			name: "PaymentTransaction_paymentId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	foreignKey({
			columns: [table.recordedByUserId],
			foreignColumns: [user.id],
			name: "PaymentTransaction_recordedByUserId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
]);

export const qcSession = pgTable("QcSession", {
	id: text().primaryKey().notNull(),
	orderId: text().notNull(),
	qcUserId: text().notNull(),
	status: qcSessionStatus().default('IN_PROGRESS').notNull(),
	startedAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	completedAt: timestamp({ precision: 3, mode: 'string' }),
	lastActiveAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
}, (table) => [
	foreignKey({
			columns: [table.orderId],
			foreignColumns: [order.id],
			name: "QcSession_orderId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	foreignKey({
			columns: [table.qcUserId],
			foreignColumns: [user.id],
			name: "QcSession_qcUserId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
]);

export const product = pgTable("Product", {
	id: text().primaryKey().notNull(),
	sku: text().notNull(),
	barcode: text(),
	qrCode: text(),
	name: text().notNull(),
	category: text(),
	brand: text(),
	baseUnitId: text().notNull(),
	wholesalePrice: numeric({ precision: 12, scale:  2 }).notNull(),
	retailPrice: numeric({ precision: 12, scale:  2 }).notNull(),
	taxPercent: numeric({ precision: 5, scale:  2 }).default('0').notNull(),
	minStock: numeric({ precision: 14, scale:  3 }),
	maxStock: numeric({ precision: 14, scale:  3 }),
	batchTracked: boolean().default(false).notNull(),
	expiryTracked: boolean().default(false).notNull(),
	active: boolean().default(true).notNull(),
	createdAt: timestamp({ precision: 3, mode: 'string' }).default(sql`CURRENT_TIMESTAMP`).notNull(),
	imageKey: text(),
	avgCost: numeric({ precision: 12, scale:  4 }),
	needsReview: boolean().default(false).notNull(),
	reviewNotes: text(),
}, (table) => [
	uniqueIndex("Product_barcode_key").using("btree", table.barcode.asc().nullsLast().op("text_ops")),
	index("Product_category_idx").using("btree", table.category.asc().nullsLast().op("text_ops")),
	index("Product_needsReview_idx").using("btree", table.needsReview.asc().nullsLast().op("bool_ops")),
	uniqueIndex("Product_qrCode_key").using("btree", table.qrCode.asc().nullsLast().op("text_ops")),
	uniqueIndex("Product_sku_key").using("btree", table.sku.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.baseUnitId],
			foreignColumns: [unit.id],
			name: "Product_baseUnitId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
]);

export const productUnit = pgTable("ProductUnit", {
	id: text().primaryKey().notNull(),
	productId: text().notNull(),
	unitId: text().notNull(),
	factorToBase: numeric({ precision: 14, scale:  6 }).notNull(),
	isBaseUnit: boolean().default(false).notNull(),
	barcode: text(),
	barcodeGenerated: boolean().default(false).notNull(),
	isDefaultSaleUnit: boolean().default(false).notNull(),
	wholesalePrice: numeric({ precision: 12, scale:  2 }),
	retailPrice: numeric({ precision: 12, scale:  2 }),
}, (table) => [
	uniqueIndex("ProductUnit_barcode_key").using("btree", table.barcode.asc().nullsLast().op("text_ops")),
	uniqueIndex("ProductUnit_productId_unitId_key").using("btree", table.productId.asc().nullsLast().op("text_ops"), table.unitId.asc().nullsLast().op("text_ops")),
	foreignKey({
			columns: [table.productId],
			foreignColumns: [product.id],
			name: "ProductUnit_productId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
	foreignKey({
			columns: [table.unitId],
			foreignColumns: [unit.id],
			name: "ProductUnit_unitId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
]);

export const bankBalance = pgTable("BankBalance", {
	id: text().primaryKey().notNull(),
	warehouseId: text().notNull(),
	businessDate: date().notNull(),
	openingBalance: numeric({ precision: 14, scale:  2 }),
	closingBalance: numeric({ precision: 14, scale:  2 }).notNull(),
	adjustment: numeric({ precision: 14, scale:  2 }).default('0').notNull(),
	note: text(),
	enteredByUserId: text().notNull(),
	updatedAt: timestamp({ precision: 3, mode: 'string' }).notNull(),
}, (table) => [
	uniqueIndex("BankBalance_warehouseId_businessDate_key").using("btree", table.warehouseId.asc().nullsLast().op("date_ops"), table.businessDate.asc().nullsLast().op("date_ops")),
	foreignKey({
			columns: [table.warehouseId],
			foreignColumns: [warehouse.id],
			name: "BankBalance_warehouseId_fkey"
		}).onUpdate("cascade").onDelete("restrict"),
]);
