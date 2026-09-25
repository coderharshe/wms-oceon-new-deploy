import { relations } from "drizzle-orm/relations";
import { user, auditLog, bill, billVersion, billItem, product, unit, order, warehouse, inventory, cashSession, cashTransaction, notification, inventoryMovement, paymentAdjustment, payment, purchaseBillItem, purchaseBill, customer, supplier, qcAdjustment, qcSession, qcRestrictionRule, orderItem, stockReservation, paymentTransaction, productUnit, bankBalance } from "./schema";

export const auditLogRelations = relations(auditLog, ({one}) => ({
	user: one(user, {
		fields: [auditLog.userId],
		references: [user.id]
	}),
}));

export const userRelations = relations(user, ({one, many}) => ({
	auditLogs: many(auditLog),
	billVersions: many(billVersion),
	cashSessions: many(cashSession),
	notifications: many(notification),
	inventoryMovements: many(inventoryMovement),
	orders: many(order),
	purchaseBills: many(purchaseBill),
	warehouse: one(warehouse, {
		fields: [user.warehouseId],
		references: [warehouse.id]
	}),
	paymentTransactions: many(paymentTransaction),
	qcSessions: many(qcSession),
}));

export const billVersionRelations = relations(billVersion, ({one, many}) => ({
	bill: one(bill, {
		fields: [billVersion.billId],
		references: [bill.id]
	}),
	user: one(user, {
		fields: [billVersion.createdByUserId],
		references: [user.id]
	}),
	billItems: many(billItem),
}));

export const billRelations = relations(bill, ({one, many}) => ({
	billVersions: many(billVersion),
	order: one(order, {
		fields: [bill.orderId],
		references: [order.id]
	}),
	warehouse: one(warehouse, {
		fields: [bill.warehouseId],
		references: [warehouse.id]
	}),
	paymentAdjustments: many(paymentAdjustment),
	payments: many(payment),
}));

export const billItemRelations = relations(billItem, ({one}) => ({
	billVersion: one(billVersion, {
		fields: [billItem.billVersionId],
		references: [billVersion.id]
	}),
	product: one(product, {
		fields: [billItem.productId],
		references: [product.id]
	}),
	unit: one(unit, {
		fields: [billItem.unitId],
		references: [unit.id]
	}),
}));

export const productRelations = relations(product, ({one, many}) => ({
	billItems: many(billItem),
	inventories: many(inventory),
	inventoryMovements: many(inventoryMovement),
	purchaseBillItems: many(purchaseBillItem),
	qcAdjustments: many(qcAdjustment),
	qcRestrictionRules: many(qcRestrictionRule),
	orderItems: many(orderItem),
	stockReservations: many(stockReservation),
	unit: one(unit, {
		fields: [product.baseUnitId],
		references: [unit.id]
	}),
	productUnits: many(productUnit),
}));

export const unitRelations = relations(unit, ({many}) => ({
	billItems: many(billItem),
	purchaseBillItems: many(purchaseBillItem),
	orderItems: many(orderItem),
	products: many(product),
	productUnits: many(productUnit),
}));

export const orderRelations = relations(order, ({one, many}) => ({
	bills: many(bill),
	customer: one(customer, {
		fields: [order.customerId],
		references: [customer.id]
	}),
	user: one(user, {
		fields: [order.financeUserId],
		references: [user.id]
	}),
	warehouse: one(warehouse, {
		fields: [order.warehouseId],
		references: [warehouse.id]
	}),
	orderItems: many(orderItem),
	stockReservations: many(stockReservation),
	qcSessions: many(qcSession),
}));

export const warehouseRelations = relations(warehouse, ({many}) => ({
	bills: many(bill),
	inventories: many(inventory),
	cashSessions: many(cashSession),
	inventoryMovements: many(inventoryMovement),
	orders: many(order),
	purchaseBills: many(purchaseBill),
	qcRestrictionRules: many(qcRestrictionRule),
	users: many(user),
	bankBalances: many(bankBalance),
}));

export const inventoryRelations = relations(inventory, ({one}) => ({
	product: one(product, {
		fields: [inventory.productId],
		references: [product.id]
	}),
	warehouse: one(warehouse, {
		fields: [inventory.warehouseId],
		references: [warehouse.id]
	}),
}));

export const cashTransactionRelations = relations(cashTransaction, ({one}) => ({
	cashSession: one(cashSession, {
		fields: [cashTransaction.cashSessionId],
		references: [cashSession.id]
	}),
}));

export const cashSessionRelations = relations(cashSession, ({one, many}) => ({
	cashTransactions: many(cashTransaction),
	user: one(user, {
		fields: [cashSession.financeUserId],
		references: [user.id]
	}),
	warehouse: one(warehouse, {
		fields: [cashSession.warehouseId],
		references: [warehouse.id]
	}),
}));

export const notificationRelations = relations(notification, ({one}) => ({
	user: one(user, {
		fields: [notification.userId],
		references: [user.id]
	}),
}));

export const inventoryMovementRelations = relations(inventoryMovement, ({one}) => ({
	product: one(product, {
		fields: [inventoryMovement.productId],
		references: [product.id]
	}),
	user: one(user, {
		fields: [inventoryMovement.userId],
		references: [user.id]
	}),
	warehouse: one(warehouse, {
		fields: [inventoryMovement.warehouseId],
		references: [warehouse.id]
	}),
}));

export const paymentAdjustmentRelations = relations(paymentAdjustment, ({one}) => ({
	bill: one(bill, {
		fields: [paymentAdjustment.billId],
		references: [bill.id]
	}),
}));

export const paymentRelations = relations(payment, ({one, many}) => ({
	bill: one(bill, {
		fields: [payment.billId],
		references: [bill.id]
	}),
	paymentTransactions: many(paymentTransaction),
}));

export const purchaseBillItemRelations = relations(purchaseBillItem, ({one}) => ({
	product: one(product, {
		fields: [purchaseBillItem.productId],
		references: [product.id]
	}),
	purchaseBill: one(purchaseBill, {
		fields: [purchaseBillItem.purchaseBillId],
		references: [purchaseBill.id]
	}),
	unit: one(unit, {
		fields: [purchaseBillItem.unitId],
		references: [unit.id]
	}),
}));

export const purchaseBillRelations = relations(purchaseBill, ({one, many}) => ({
	purchaseBillItems: many(purchaseBillItem),
	user: one(user, {
		fields: [purchaseBill.receivedByUserId],
		references: [user.id]
	}),
	supplier: one(supplier, {
		fields: [purchaseBill.supplierId],
		references: [supplier.id]
	}),
	warehouse: one(warehouse, {
		fields: [purchaseBill.warehouseId],
		references: [warehouse.id]
	}),
}));

export const customerRelations = relations(customer, ({many}) => ({
	orders: many(order),
}));

export const supplierRelations = relations(supplier, ({many}) => ({
	purchaseBills: many(purchaseBill),
}));

export const qcAdjustmentRelations = relations(qcAdjustment, ({one}) => ({
	product: one(product, {
		fields: [qcAdjustment.productId],
		references: [product.id]
	}),
	qcSession: one(qcSession, {
		fields: [qcAdjustment.qcSessionId],
		references: [qcSession.id]
	}),
}));

export const qcSessionRelations = relations(qcSession, ({one, many}) => ({
	qcAdjustments: many(qcAdjustment),
	order: one(order, {
		fields: [qcSession.orderId],
		references: [order.id]
	}),
	user: one(user, {
		fields: [qcSession.qcUserId],
		references: [user.id]
	}),
}));

export const qcRestrictionRuleRelations = relations(qcRestrictionRule, ({one}) => ({
	product: one(product, {
		fields: [qcRestrictionRule.productId],
		references: [product.id]
	}),
	warehouse: one(warehouse, {
		fields: [qcRestrictionRule.warehouseId],
		references: [warehouse.id]
	}),
}));

export const orderItemRelations = relations(orderItem, ({one}) => ({
	order: one(order, {
		fields: [orderItem.orderId],
		references: [order.id]
	}),
	product: one(product, {
		fields: [orderItem.productId],
		references: [product.id]
	}),
	unit: one(unit, {
		fields: [orderItem.unitId],
		references: [unit.id]
	}),
}));

export const stockReservationRelations = relations(stockReservation, ({one}) => ({
	order: one(order, {
		fields: [stockReservation.orderId],
		references: [order.id]
	}),
	product: one(product, {
		fields: [stockReservation.productId],
		references: [product.id]
	}),
}));

export const paymentTransactionRelations = relations(paymentTransaction, ({one}) => ({
	payment: one(payment, {
		fields: [paymentTransaction.paymentId],
		references: [payment.id]
	}),
	user: one(user, {
		fields: [paymentTransaction.recordedByUserId],
		references: [user.id]
	}),
}));

export const productUnitRelations = relations(productUnit, ({one}) => ({
	product: one(product, {
		fields: [productUnit.productId],
		references: [product.id]
	}),
	unit: one(unit, {
		fields: [productUnit.unitId],
		references: [unit.id]
	}),
}));

export const bankBalanceRelations = relations(bankBalance, ({one}) => ({
	warehouse: one(warehouse, {
		fields: [bankBalance.warehouseId],
		references: [warehouse.id]
	}),
}));