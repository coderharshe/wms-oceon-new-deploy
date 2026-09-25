# Warehouse & Wholesale/Retail Management System (WMS)

A complete, production-grade Warehouse Management and High-Speed POS Billing System built with Next.js 15, TypeScript, Tailwind CSS, PostgreSQL, Prisma, and Drizzle ORM.

---

## 🌟 Portals & Modules

- **💳 Billing & POS (`/billing`)**: High-speed counter billing with offline-first local IndexedDB storage, thermal printing, barcode scanning, single-bar customer search, and wholesale/retail price toggling.
- **💰 Finance & Recon (`/finance`)**: Day Book, blind cash drawer EOD counts, bank statement & reconciliation module, UPI batch settlements, expenses, receivables, and payables.
- **📦 Procurement (`/procurement`)**: Purchase orders (PO), supplier price comparisons, stock requisitions, and historical SKU rate analysis.
- **🏭 Inventory (`/inventory`)**: Goods Receipt Notes (GRN) with batch & expiry tracking, physical stock audit & counts, outward dispatch, and low-stock alerts.
- **🛡️ Admin (`/admin`)**: Multi-warehouse controls, user & role permissions with instant password resolution, BI reporting, discount approvals, and audit logs.
- **👔 Manager (`/manager`)**: Operational task delegation, bill review, customer credit management, and staff session tracking.
- **🔍 Quality Check (`/qc`)**: Barcode validation queue and order verification.

---

## ⚡ Universal Keyboard Shortcuts

- `Alt + 1` … `Alt + 9`: Instant Portal Navigation
- `Alt + D`: Dashboard / Home
- `Alt + C`: Quick Calculator
- `Alt + S` or `/`: Focus Search Input
- `F2`: New Bill / PO
- `F3`: Focus Customer Search
- `F5`: Focus Product Search
- `F10`: Generate / Settle Bill
- `Alt + R`: Switch Wholesale / Retail
- `Ctrl + P`: Print Bill / Thermal Slip
- `?`: Open Keyboard Shortcuts Help

---

## 🚀 Free Cloud Deployment (Vercel + Neon Postgres)

### Step 1: Create a Free PostgreSQL Database
1. Go to [Neon.tech](https://neon.tech) and sign up for a free database.
2. Copy your pooled connection string (`DATABASE_URL`).

### Step 2: Push Database Migrations & Seed Data
From your local terminal:
```bash
DATABASE_URL="your-neon-database-url" npx prisma migrate deploy
DATABASE_URL="your-neon-database-url" npx tsx prisma/seed.ts
```

### Step 3: Deploy to Vercel
1. Import this repository into [Vercel](https://vercel.com).
2. Set Environment Variables:
   - `DATABASE_URL`: Your Neon connection string
   - `JWT_SECRET`: A secure random secret string
   - `BUSINESS_NAME`: `My Wholesale Store`
   - `UPI_VPA`: `yourstore@upi`
3. Click **Deploy**.

---

## 💻 Local Development Setup

```bash
# 1. Install dependencies
npm install

# 2. Configure environment
cp .env.example .env

# 3. Generate DB client & run migrations
npm run db:generate
npm run db:migrate
npm run db:seed

# 4. Start local development server
npm run dev

# 5. Run test suite
npm test
```
