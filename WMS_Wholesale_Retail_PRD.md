# WMS + Wholesale/Retail Billing System — Product Requirements Document (PRD)

**Version:** 1.0  
**Date:** 10 August 2026  
**Status:** Development-ready baseline  
**Product Type:** Local wholesale/retail warehouse + order fulfillment + billing + payment management system

---

## 1. Executive Summary

This system is a local-area wholesale/retail ordering and warehouse fulfillment platform. Shopkeepers place orders for products, a Finance/Billing operator creates the bill and collects/records payment, and a Quality Checker (QC) prepares and hands over the actual products.

The critical business requirement is that the **bill created by Finance is not necessarily the final quantity**. During physical handover, the QC can identify product changes requested by the customer — for example, removing an item, reducing quantity, adding an item, or changing quantity/unit — but only within configurable restrictions.

Therefore the system must maintain a complete chain:

**Customer Order → Finance Bill → Payment → QC Verification/Edit → Revised Bill → Inventory Movement → Final Payment Adjustment → Cash/UPI Reconciliation → End-of-Day Closing**

The system must support:
- Wholesale and retail selling
- Units such as kg, g, litre, ml, piece, box, packet, dozen, etc.
- Unit conversion where configured
- Product additions/removals/quantity changes during QC
- Cash and UPI payments
- Payment QR display screen
- Real-time inventory movement
- Multiple warehouses
- Role-based access
- Separate deployable applications/screens
- Full audit history for financial and inventory changes

---

# 2. Important Architecture Decision

The requirement says "3 type of screens" but the described business workflow actually requires **five application surfaces/roles**:

1. **Admin Portal**
2. **Manager Portal**
3. **Finance/Billing Portal**
4. **Quality Checker Portal**
5. **Payment Display Screen**

These should be treated as separate frontend applications/deployments while sharing the same backend/database/authentication infrastructure.

Recommended deployment structure:

```text
                    ┌─────────────────────┐
                    │   Shared Backend    │
                    │ API + Auth + DB     │
                    └──────────┬──────────┘
                               │
          ┌──────────┬────────┼────────┬──────────┐
          │          │        │        │          │
       Admin       Manager  Finance    QC      Payment
       Portal      Portal   Portal   Portal    Display
```

Each frontend should be independently deployable and independently routable, but all business rules must be enforced centrally by the backend.

Example:

```text
admin.domain.com
manager.domain.com
finance.domain.com
qc.domain.com
payment.domain.com
```

The exact domains can be changed later.

---

# 3. Business Problem

The existing manual process creates several risks:

- Finance may generate a bill for quantities that later change.
- QC may physically give a different quantity from the original bill.
- Inventory can become inaccurate if QC changes are not recorded as transactions.
- Cash collected may not match final invoice value.
- UPI payments may be difficult to reconcile.
- There may be disputes about who changed a bill and when.
- Different units make quantity calculations difficult.
- Wholesale and retail prices may differ.
- End-of-day cash may not reconcile with system records.
- Managers need operational visibility without accessing financial/admin information outside their scope.

The system must solve these problems using a controlled transaction lifecycle.

---

# 4. Core Business Workflow

## 4.1 Standard Order Flow

```text
Customer places order
        ↓
Finance creates order
        ↓
Finance selects customer
        ↓
Products + quantities + selling mode entered
        ↓
System calculates subtotal/taxes/discounts/total
        ↓
Bill generated with timestamp
        ↓
Payment initiated/recorded
        ↓
Order moves to QC
        ↓
QC sees original order/bill
        ↓
QC verifies physical products
        ↓
Customer may request permitted changes
        ↓
QC adds/removes/changes quantities
        ↓
System validates restrictions
        ↓
Final bill/revised bill generated
        ↓
Inventory deducted according to FINAL fulfilled quantity
        ↓
Payment adjusted
        ↓
Order completed
        ↓
Transaction locked/audited
```

---

# 5. Roles

## 5.1 Admin

Admin is the highest-level system owner.

### Admin can:
- Create/manage warehouses
- Create/manage managers
- Create/manage Finance users
- Create/manage QC users
- Create/manage staff IDs
- Configure roles and permissions
- Create/manage products
- Configure product units
- Configure unit conversions
- Configure wholesale/retail prices
- Manage customers
- View all orders
- View all bills
- View all payments
- View cash/UPI reconciliation
- View inventory
- View stock movements
- View reports
- Export data
- View audit logs
- Configure business rules
- Configure QC modification limits
- Configure payment methods
- Configure UPI/payment QR
- Manage system settings

Admin has global access.

---

# 6. Manager

A manager is assigned to a specific warehouse.

This follows the existing WMS hierarchy:

- One manager is assigned to a warehouse.
- Employees belong to exactly one warehouse.
- Manager cannot access another warehouse's operational data.
- APIs must enforce warehouse-level authorization.

### Manager can:
- View warehouse inventory
- Monitor orders
- Monitor QC operations
- Monitor Finance operational status where permitted
- Manage warehouse staff
- Assign tasks
- Manage attendance if enabled
- View warehouse stock movements
- View warehouse operational reports
- Handle stock discrepancies
- Approve operational adjustments where configured

### Manager cannot:
- Manage global system settings
- Create Admin accounts
- Access other warehouses
- View unrestricted global financial data
- Modify global roles/permissions
- Change system-wide configuration

Every warehouse-scoped API request must validate:

```text
user.warehouse_id == requested_resource.warehouse_id
```

Unauthorized cross-warehouse access must return HTTP 403.

---

# 7. Finance/Billing Operator

Finance is the **first operational person in the sales workflow**.

Their primary responsibility:

**Take order → generate bill → collect/record payment → send order to QC**

### Finance functions

#### Customer
- Search customer
- Select existing customer
- Create customer
- View customer outstanding balance if enabled

#### Order creation
- Create new order
- Add products
- Enter quantity
- Select unit
- Select wholesale/retail selling mode
- Apply permitted discount
- Calculate totals
- Add notes

#### Bill generation
Every bill must record:
- Bill number
- Order number
- Warehouse
- Finance user
- Customer
- Date
- Exact creation time
- Products
- Ordered quantity
- Unit
- Unit price
- Discount
- Tax if applicable
- Total
- Payment status
- Timestamp

#### Payment
Support:
- Cash
- UPI

Payment states:

```text
Unpaid
Pending
Partially Paid
Paid
Refund Due
Refunded
Payment Adjustment Required
```

Finance should not be allowed to silently overwrite payment records.

All changes must create an audit record.

---

# 8. Quality Checker (QC)

QC is the **second operational person**.

QC physically verifies and hands over products to the customer.

This is where the system must handle real-world quantity changes.

## 8.1 QC receives

QC sees:

- Order number
- Customer
- Finance operator
- Bill number
- Original ordered quantity
- Unit
- Product
- Selling mode
- Payment status
- Order status
- Special notes

---

# 9. QC Product Modification Rules

QC must have a controlled editing interface.

Each product line should have:

```text
Product
Original Qty
Unit
Allowed Action
Final Qty
Difference
Reason
```

Possible actions:

- Keep
- Reduce
- Remove
- Add
- Replace/change quantity
- Mark unavailable

But permissions must be configurable.

---

# 10. QC "Yes/No" Confirmation

For every bill item:

```text
Product: Rice
Ordered: 25 kg

Available?
[ YES ] [ NO ]
```

If YES:
- Product remains in fulfillment.

If NO:
- System requires a reason.
- Product quantity becomes zero or moves to an exception workflow.

The system must never allow a simple YES/NO action to bypass quantity and inventory validation.

---

# 11. Quantity Modification Restrictions

QC changes must follow configurable business rules.

Examples:

```text
Original: 10 kg

Allowed reduction: up to 2 kg
Allowed increase: up to 0 kg
```

or:

```text
Original: 10 pieces

Allowed:
Reduction: 100%
Addition: 5 pieces
```

Admin should configure:

- Maximum increase percentage
- Maximum decrease percentage
- Maximum absolute quantity
- Whether addition is allowed
- Whether removal is allowed
- Whether a reason is mandatory
- Whether manager approval is required
- Whether finance approval is required

If a modification exceeds the limit:

```text
CHANGE BLOCKED
Approval Required
```

QC must not bypass the restriction.

---

# 12. Adding Products During QC

If the customer requests an additional product:

```text
QC → Add Product
```

System must:

1. Search product
2. Check stock
3. Check selling price
4. Determine wholesale/retail price
5. Add quantity
6. Recalculate total
7. Record who added it
8. Record exact timestamp
9. Add audit log
10. Generate revised bill/adjustment

The system must never simply modify the original historical bill without retaining the previous version.

---

# 13. Removing Products During QC

If the customer removes an item:

1. QC selects product
2. Enters final quantity
3. Selects reason if required
4. System calculates difference
5. System recalculates invoice total
6. System calculates payment adjustment
7. Inventory movement is calculated from final fulfilled quantity
8. Revised bill is generated

---

# 14. Revised Bill / Bill Versioning

The original Finance bill must remain immutable after finalization.

Instead:

```text
Bill #INV-1001
Version 1 — Finance Bill
Version 2 — QC Adjustment
Version 3 — Final Bill
```

The system must retain:

- Previous quantity
- New quantity
- Difference
- Previous price
- New price
- Previous total
- New total
- User
- Timestamp
- Reason

This prevents disputes.

---

# 15. Payment Adjustment Logic

This is one of the most important parts of the system.

## Case A — Final amount equals original bill

```text
Original Bill = ₹1,000
Final Bill = ₹1,000
Paid = ₹1,000

Status = PAID
Adjustment = ₹0
```

## Case B — Final amount increases

```text
Original Bill = ₹1,000
Final Bill = ₹1,200
Paid = ₹1,000

Additional Amount Due = ₹200
```

Payment must become:

```text
PARTIALLY PAID / ADDITIONAL PAYMENT REQUIRED
```

The customer pays the additional ₹200.

## Case C — Final amount decreases

```text
Original Bill = ₹1,000
Final Bill = ₹800
Paid = ₹1,000

Refund/Credit Due = ₹200
```

The system must record the ₹200 difference.

Possible resolution:

- Cash refund
- UPI refund
- Customer credit balance
- Manager-approved adjustment

The resolution must be explicitly recorded.

---

# 16. Payment Display Screen

A dedicated display application should be used at the payment counter.

Its primary purpose is to show:

- Amount payable
- Payment status
- UPI QR
- Business name
- Bill/order reference
- Payment confirmation
- Cash/UPI instruction

Example:

```text
--------------------------------
          TOTAL PAYABLE
             ₹1,250

       Scan to Pay via UPI

            [ QR CODE ]

Order: ORD-10293
Bill: INV-10293

Waiting for payment...
--------------------------------
```

The screen should not expose sensitive admin information.

---

# 17. Cash Payment

For cash:

Finance selects:

```text
Payment Method = CASH
Amount Received = ₹1,500
Bill Total = ₹1,250
```

System calculates:

```text
Change = ₹250
```

Transaction becomes paid only after confirmation.

Cash transactions must be included in end-of-day reconciliation.

---

# 18. UPI Payment

For UPI:

```text
Bill Total
      ↓
Generate/display payment QR
      ↓
Customer scans
      ↓
Payment initiated
      ↓
Payment confirmation
      ↓
Transaction marked paid
```

The architecture should support a payment gateway/webhook in the future.

Do not mark a UPI payment as successful solely because the QR was displayed.

---

# 19. End-of-Day Cash Closing

Finance must be able to close their cash counter/day.

At EOD:

```text
Opening Cash
+ Cash Sales
+ Other Cash Receipts
- Cash Refunds
- Cash Withdrawals
= Expected Cash
```

Finance enters:

```text
Actual Cash Counted
```

System calculates:

```text
Difference = Actual Cash - Expected Cash
```

Possible result:

```text
Matched
Short
Excess
```

If there is a discrepancy, the system must require a reason and preserve the record.

EOD closing should include:

- Finance user
- Warehouse
- Business date
- Opening cash
- Expected cash
- Actual cash
- Difference
- Number of cash transactions
- Total UPI transactions
- Total sales
- Refunds
- Adjustments
- Closing timestamp

Once closed, editing should require elevated permission.

---

# 20. Inventory Management

Inventory must be transaction-based.

Do not directly overwrite stock numbers without a stock movement record.

Example:

```text
Opening Stock: 100 kg

Sale:
-20 kg

QC reduction:
-2 kg less fulfilled than ordered

Final deduction:
18 kg
```

The system should record:

```text
Stock Movement
Product
Warehouse
Before Qty
Movement Qty
After Qty
Unit
Movement Type
Reference
User
Timestamp
```

Movement types:

- GRN / Receiving
- Putaway
- Sale
- QC Adjustment
- Return
- Transfer In
- Transfer Out
- Damage
- Expiry
- Stock Count Adjustment
- Manual Adjustment

---

# 21. Inventory Timing

Inventory must update at the correct business event.

Recommended model:

### Before QC
Order quantity may be **reserved**, but should not necessarily be permanently deducted.

### At final QC confirmation
Actual fulfilled quantity is deducted from available stock.

Example:

```text
Ordered: 20 kg
Reserved: 20 kg

QC final quantity: 17 kg

Final inventory deduction: 17 kg
Reservation released: 3 kg
```

This prevents inventory from being incorrectly reduced when customers change orders.

---

# 22. Units and Quantity System

The system must support:

### Weight
- kg
- g
- mg

### Volume
- litre
- ml

### Count
- piece
- packet
- box
- dozen
- pair

### Custom units
Admin can configure additional units.

Products should have a base unit.

Example:

```text
Product: Sugar
Base Unit: kg

1 kg = 1000 g
```

Inventory should preferably be stored internally using a normalized base quantity.

Display quantities can then use customer-facing units.

Example:

```text
Inventory:
25.500 kg

Display:
25 kg 500 g
```

The conversion system must prevent invalid conversions.

---

# 23. Wholesale vs Retail

Each product can have:

```text
Retail Price
Wholesale Price
```

The order must store the price actually used at the time of sale.

Do not dynamically recalculate historical bills if the product price changes later.

Example:

```text
Product Price Today:
Wholesale = ₹90/kg
Retail = ₹100/kg

Order uses:
Wholesale = ₹90/kg
```

If tomorrow the price becomes ₹95/kg, the old order remains ₹90/kg.

---

# 24. Product Master

Admin manages:

- SKU
- Barcode
- QR code
- Product name
- Category
- Brand
- Base unit
- Sale units
- Unit conversions
- Wholesale price
- Retail price
- Tax
- Minimum stock
- Maximum stock
- Warehouse availability
- Batch/lot if applicable
- Expiry tracking if applicable
- Active/inactive status

---

# 25. Customer Master

Customer fields:

- Customer ID
- Shop name
- Owner/contact person
- Mobile
- Address
- GSTIN if applicable
- Wholesale/retail classification
- Credit limit if enabled
- Outstanding balance
- Status
- Notes

---

# 26. Order Statuses

Recommended states:

```text
DRAFT
BILLED
PAYMENT_PENDING
PAID
READY_FOR_QC
QC_IN_PROGRESS
QC_ADJUSTMENT_REQUIRED
ADDITIONAL_PAYMENT_REQUIRED
REFUND_REQUIRED
READY_FOR_HANDOVER
COMPLETED
CANCELLED
```

---

# 27. Inventory / Fulfillment Statuses

```text
NOT_RESERVED
RESERVED
PICKING
QC_PENDING
QC_IN_PROGRESS
READY
HANDED_OVER
PARTIALLY_FULFILLED
CANCELLED
RETURNED
```

---

# 28. Finance Dashboard

Finance screen should prioritize speed.

### Main actions

```text
+ New Order
Search Order
Pending Payments
Ready for QC
Recent Bills
Cash Summary
```

### New Order UI

```text
Customer
↓
Selling Type
Wholesale / Retail
↓
Product Search
↓
Quantity + Unit
↓
Price
↓
Discount
↓
Total
↓
Payment
↓
Generate Bill
```

The UI must be optimized for keyboard/scanner-based fast operation.

---

# 29. QC Dashboard

QC screen should be operational and simple.

### Main sections

```text
Waiting for QC
In Progress
Changes Required
Ready to Hand Over
Completed
```

QC should not be overloaded with administrative information.

The primary screen should show:

```text
Order
Customer
Bill
Product list
Original Qty
Final Qty
Unit
Stock status
Change controls
Payment status
Confirm
```

---

# 30. Admin Dashboard

Admin gets global visibility.

KPIs:

- Total sales
- Orders
- Payments
- Cash collection
- UPI collection
- Outstanding payments
- Inventory value
- Low-stock products
- Stock movements
- Warehouse performance
- QC adjustments
- Refunds
- EOD reconciliation
- Staff activity

---

# 31. Manager Dashboard

Manager gets warehouse-level visibility.

KPIs:

- Today's orders
- Pending QC
- Completed orders
- Inventory
- Low stock
- Stock discrepancies
- Staff activity
- Warehouse movements

Financial visibility should be restricted according to configured permissions.

---

# 32. Reports

## Sales
- Daily sales
- Monthly sales
- Product sales
- Customer sales
- Wholesale sales
- Retail sales

## Payment
- Cash collection
- UPI collection
- Payment pending
- Refunds
- Payment adjustments
- EOD reconciliation

## Inventory
- Current stock
- Stock movement
- Low stock
- Stock valuation
- Product movement
- Warehouse movement
- Stock adjustment

## QC
- Quantity changes
- Added products
- Removed products
- Reduced quantities
- Unavailable products
- QC discrepancy rate
- QC user activity

## Audit
- Bill edits
- Payment changes
- Inventory changes
- User actions
- Login activity
- Permission changes

---

# 33. Audit Trail

Every sensitive action must create an immutable audit event.

Minimum fields:

```text
Audit ID
User ID
Role
Warehouse ID
Action
Entity Type
Entity ID
Old Value
New Value
Reason
IP/device information where appropriate
Timestamp
```

Important events:

- Bill created
- Bill revised
- Product added
- Product removed
- Quantity changed
- Payment recorded
- Payment adjusted
- Refund created
- Inventory adjusted
- Stock transferred
- User created
- Permission changed
- EOD closed

---

# 34. Database Architecture

Recommended core entities:

```text
users
roles
permissions
warehouses
staff
customers
products
product_units
unit_conversions
product_prices
orders
order_items
bills
bill_versions
bill_items
payments
payment_transactions
payment_adjustments
cash_sessions
cash_transactions
inventory
inventory_movements
stock_reservations
qc_sessions
qc_adjustments
returns
audit_logs
notifications
system_settings
```

---

# 35. Critical Data Relationships

```text
Warehouse
  ├── Manager
  ├── Staff
  ├── Inventory
  ├── Orders
  ├── Bills
  └── Payments

Customer
  └── Orders

Order
  ├── Order Items
  ├── Bill
  ├── Payment
  └── QC Session

Bill
  ├── Bill Versions
  ├── Bill Items
  └── Payment Adjustments

Product
  ├── Prices
  ├── Units
  └── Inventory

Inventory
  └── Inventory Movements
```

---

# 36. Transaction Integrity

Financial and inventory operations must be atomic wherever possible.

Example QC completion:

```text
1. Validate quantities
2. Validate stock
3. Calculate final bill
4. Calculate payment adjustment
5. Create bill version
6. Create inventory movement
7. Release/adjust reservation
8. Update order status
9. Record audit log
10. Commit transaction
```

If any critical operation fails, the transaction should roll back rather than leaving half-updated data.

---

# 37. Concurrency Requirements

Two QC users must not be able to sell/deduct the same limited stock simultaneously.

The backend must protect against:

- Overselling
- Double payment
- Duplicate bill generation
- Duplicate stock deduction
- Duplicate QC completion

Use database transactions/row locking or an equivalent concurrency-control strategy.

---

# 38. Security

Required:

- Role-based access control
- Warehouse-level authorization
- Secure authentication
- Session management
- Password hashing
- Server-side permission validation
- API authorization
- Audit logs
- Rate limiting where appropriate
- Input validation
- SQL injection protection
- XSS protection
- CSRF protection where applicable
- Secure secrets management

Frontend hiding a button is NOT security.

Every permission must be enforced on the backend.

---

# 39. Deployment Architecture

Recommended monorepo:

```text
wms/
│
├── apps/
│   ├── admin/
│   ├── manager/
│   ├── finance/
│   ├── qc/
│   └── payment-display/
│
├── backend/
│   ├── api/
│   ├── auth/
│   ├── billing/
│   ├── payments/
│   ├── inventory/
│   ├── orders/
│   ├── qc/
│   ├── reports/
│   └── audit/
│
├── packages/
│   ├── database/
│   ├── types/
│   ├── validation/
│   └── shared/
│
└── docs/
    └── PRD.md
```

Each app can have its own deployment.

Example:

```text
Admin       → admin.domain.com
Manager     → manager.domain.com
Finance     → finance.domain.com
QC          → qc.domain.com
Display     → pay.domain.com
```

The backend remains shared.

---

# 40. Real-Time Requirements

The system should support real-time updates for:

- New orders appearing in QC
- Payment confirmation
- Order status
- Inventory changes
- Bill revisions
- Payment adjustment
- QC completion
- Payment display status

WebSockets, Server-Sent Events, or a realtime database service can be used.

---

# 41. Notifications

Examples:

### Finance
- Payment successful
- Payment pending
- QC completed with price change
- Refund required

### QC
- New order ready
- Payment confirmed
- Additional payment required

### Manager
- Low stock
- Stock discrepancy
- QC exception
- EOD discrepancy

### Admin
- Significant financial discrepancy
- Inventory discrepancy
- Permission change
- System-critical event

---

# 42. Edge Cases That MUST Be Handled

## Customer adds product but stock is unavailable
System blocks addition or requires alternative workflow.

## Customer reduces quantity after payment
System creates refund/credit adjustment.

## Customer increases quantity after payment
System calculates additional amount due.

## Customer removes entire order
Order becomes cancelled/returned according to business rules.

## UPI payment fails
Payment remains pending/failed; order must not be marked paid.

## UPI QR displayed but payment not confirmed
Do not mark paid.

## Cash amount differs from bill
System requires correction/confirmation.

## QC tries to exceed modification limit
Block and request approval.

## Product price changes after bill creation
Existing bill retains original price.

## Product becomes out of stock during QC
QC cannot confirm unavailable quantity without an approved exception.

## Two users modify the same order
Backend must prevent conflicting writes.

## Internet temporarily fails
The application must clearly show whether the transaction was actually committed. Do not blindly retry payment or bill creation.

---

# 43. Business Rules

1. Every order has a unique ID.
2. Every bill has a unique bill number.
3. Every payment has a unique transaction ID.
4. Original bills cannot be silently overwritten.
5. QC changes must be auditable.
6. Inventory changes must have movement records.
7. Final inventory deduction is based on final fulfilled quantity.
8. Cash and UPI are separate payment methods.
9. UPI success must be verified.
10. EOD cash must be reconciled.
11. Warehouse users cannot access unauthorized warehouses.
12. Wholesale and retail pricing must be explicitly determined.
13. Historical transactions must retain their original prices.
14. Units must be validated through configured conversions.
15. Critical financial actions require proper authorization.
16. No frontend-only permission controls.
17. Every sensitive change must be logged.

---

# 44. MVP Scope

The first production version should prioritize:

### Phase 1
- Authentication
- Roles
- Warehouses
- Product master
- Customer master
- Units
- Wholesale/retail pricing

### Phase 2
- Finance order creation
- Bill generation
- Cash payment
- UPI payment/display QR
- Payment status

### Phase 3
- QC queue
- QC YES/NO
- Quantity modification
- Product addition/removal
- Modification restrictions
- Revised bills

### Phase 4
- Inventory
- Stock reservations
- Final stock deduction
- Stock movements

### Phase 5
- Cash EOD
- Payment reconciliation
- Reports
- Audit logs

### Phase 6
- Manager portal
- Admin portal
- Advanced reports
- Notifications
- Multi-warehouse operations

---

# 45. Non-MVP / Future Enhancements

Potential later modules:

- Purchase orders
- Supplier management
- GRN
- Putaway/bin management
- Barcode/QR scanning
- Batch/lot tracking
- Expiry tracking
- Stock transfers
- Returns management
- Customer credit/ledger
- GST invoicing
- WhatsApp invoice delivery
- Printer integration
- Thermal printer support
- Payment gateway integration
- Advanced analytics
- Demand forecasting
- Automatic reorder suggestions
- Mobile/PWA mode

These should not complicate the initial MVP unless operationally required.

---

# 46. Acceptance Criteria

The system is ready for initial production when:

### Finance
- Can create an order in under a practical counter workflow.
- Can generate a timestamped bill.
- Can accept/record cash.
- Can initiate/record UPI payment.
- Can send completed order to QC.

### QC
- Can see pending orders.
- Can confirm products using YES/NO.
- Can change permitted quantities.
- Can add/remove products.
- Cannot exceed configured restrictions.
- Can see recalculated totals.
- Can complete final handover.

### Inventory
- Stock reflects final fulfilled quantities.
- Every movement is logged.
- Reservations are released correctly.
- Overselling is prevented.

### Payments
- Cash and UPI totals are separately tracked.
- Additional payment is calculated correctly.
- Refund/credit due is calculated correctly.
- EOD cash reconciliation works.

### Admin
- Can configure users, warehouses, products, pricing and rules.
- Can view global transactions and reports.
- Can inspect audit logs.

### Manager
- Can operate only within assigned warehouse.
- Can monitor warehouse operations.
- Cannot access unauthorized global data.

### Payment Display
- Shows correct amount.
- Shows correct order reference.
- Displays payment QR.
- Reflects payment status in real time.
- Does not expose sensitive information.

---

# 47. Recommended Development Principle

Do NOT build five completely independent systems.

Build:

```text
One shared backend
+
One shared database
+
Five thin role-specific frontends
```

This prevents the Finance, QC, Admin and Manager applications from developing conflicting business logic.

The backend should be the source of truth for:

- Pricing
- Bills
- Payments
- Inventory
- QC restrictions
- Permissions
- Warehouse access
- Audit history
- Transaction status

The frontends should primarily provide role-specific workflows.

---

# 48. Final Product Architecture

```text
                        USERS
                          │
        ┌─────────────────┼──────────────────┐
        │                 │                  │
      Admin            Manager            Staff
                                            │
                             ┌──────────────┴──────────────┐
                             │                             │
                          Finance                          QC
                             │                             │
                             └──────────────┬──────────────┘
                                            │
                                      Shared Backend
                                            │
       ┌──────────────┬──────────────┬──────┼───────────────┐
       │              │              │      │               │
     Orders         Billing       Payments Inventory       QC
       │              │              │      │               │
       └──────────────┴──────────────┴──────┴───────────────┘
                                            │
                                        Database
                                            │
                                   Audit / Reporting
                                            │
                                   Payment Display
```

---

# 49. Key Design Decision

The most important design rule is:

> **The Finance bill represents the customer's initial commercial transaction; the QC confirmation represents the actual fulfillment. The final financial and inventory state must be derived from the controlled QC adjustment process, not by silently editing the original bill.**

This distinction is what makes the system reliable for a real warehouse where customers can change quantities at the counter.

---

# 50. Definition of Done

A feature is not considered complete merely because the UI works.

For every feature:

```text
UI
↓
API
↓
Validation
↓
Database transaction
↓
Permission check
↓
Audit log
↓
Error handling
↓
Concurrency handling
↓
Report/reconciliation impact
↓
Testing
```

must be implemented.

The production system should prioritize **transaction correctness, inventory accuracy, payment reconciliation, role isolation, and auditability** over visual complexity.
