import { PrismaClient } from "@/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import bcrypt from "bcryptjs";

// engineType = "client" (see schema.prisma) means PrismaClient always needs
// an explicit driver adapter now — this standalone script isn't part of the
// Worker runtime, but the requirement applies everywhere.
const db = new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

async function main() {
  const units = await Promise.all(
    [
      { name: "kilogram", symbol: "kg", type: "WEIGHT" as const },
      { name: "gram", symbol: "g", type: "WEIGHT" as const },
      { name: "litre", symbol: "l", type: "VOLUME" as const },
      { name: "millilitre", symbol: "ml", type: "VOLUME" as const },
      { name: "piece", symbol: "pc", type: "COUNT" as const },
      { name: "box", symbol: "box", type: "COUNT" as const },
      { name: "dozen", symbol: "dz", type: "COUNT" as const },
    ].map((u) => db.unit.upsert({ where: { symbol: u.symbol }, update: {}, create: u }))
  );
  const bySymbol = Object.fromEntries(units.map((u) => [u.symbol, u]));

  const warehouse = await db.warehouse.upsert({
    where: { code: "WH1" },
    update: {},
    create: { name: "Main Warehouse", code: "WH1", address: "1 Market Road" },
  });

  const passwordHash = await bcrypt.hash("password123", 10);
  const plainPassword = "password123";
  const users = [
    { staffId: "ADMIN-1", name: "Asha Admin", role: "ADMIN" as const, warehouseId: null, contact: "9811000001", designation: "General Administrator", city: "Gurugram", town: "Haryana", employmentType: "Full-time", shift: "General", joiningDate: "2024-01-15", salary: "65,000", bankUpi: "UPI:asha@hdfc", reportingManager: "Managing Director" },
    { staffId: "MGR-1", name: "Manoj Manager", role: "MANAGER" as const, warehouseId: warehouse.id, contact: "9811000002", designation: "Warehouse Manager", city: "Gurugram", town: "Haryana", employmentType: "Full-time", shift: "8AM–5PM", joiningDate: "2024-03-01", salary: "45,000", bankUpi: "UPI:manoj@icici", reportingManager: "Asha Admin" },
    { staffId: "BILL-1", name: "Bikram Billing", role: "BILLING" as const, warehouseId: warehouse.id, contact: "9811000003", designation: "Head Cashier / Billing", city: "Gurugram", town: "Haryana", employmentType: "Full-time", shift: "9AM–6PM", joiningDate: "2024-05-10", salary: "22,000", bankUpi: "UPI:bikram@paytm", reportingManager: "Manoj Manager" },
    { staffId: "FIN-1", name: "Farah Finance", role: "FINANCE" as const, warehouseId: warehouse.id, contact: "9811000004", designation: "Accounts Executive", city: "Gurugram", town: "Haryana", employmentType: "Full-time", shift: "9AM–6PM", joiningDate: "2024-04-12", salary: "32,000", bankUpi: "UPI:farah@axis", reportingManager: "Manoj Manager" },
    { staffId: "INV-1", name: "Irfan Inventory", role: "INVENTORY" as const, warehouseId: warehouse.id, contact: "9811000005", designation: "Senior Picker / Stock Clerk", city: "Gurugram", town: "Haryana", employmentType: "Full-time", shift: "6AM–2PM", joiningDate: "2024-06-01", salary: "18,000", bankUpi: "UPI:irfan@upi", reportingManager: "Manoj Manager" },
    { staffId: "PROC-1", name: "Pooja Procurement", role: "PROCUREMENT" as const, warehouseId: warehouse.id, contact: "9811000006", designation: "Procurement Officer", city: "Gurugram", town: "Haryana", employmentType: "Full-time", shift: "9AM–6PM", joiningDate: "2024-05-20", salary: "28,000", bankUpi: "UPI:pooja@sbi", reportingManager: "Manoj Manager" },
    { staffId: "QC-1", name: "Qasim QC", role: "QC" as const, warehouseId: warehouse.id, contact: "9811000007", designation: "Quality Checker", city: "Gurugram", town: "Haryana", employmentType: "Full-time", shift: "7AM–3PM", joiningDate: "2024-06-15", salary: "20,000", bankUpi: "UPI:qasim@okaxis", reportingManager: "Manoj Manager" },
  ];
  for (const u of users) {
    await db.user.upsert({
      where: { staffId: u.staffId },
      update: { ...u, plainPassword },
      create: { ...u, passwordHash, plainPassword },
    });
  }

  const sugar = await db.product.upsert({
    where: { sku: "SUGAR-1KG" },
    update: {},
    create: {
      sku: "SUGAR-1KG",
      barcode: "8901000001",
      name: "Sugar",
      category: "Grocery",
      baseUnitId: bySymbol.kg!.id,
      wholesalePrice: 42,
      retailPrice: 48,
      taxPercent: 5,
      minStock: 50,
      saleUnits: {
        create: [
          { unitId: bySymbol.kg!.id, factorToBase: 1, isBaseUnit: true },
          { unitId: bySymbol.g!.id, factorToBase: 0.001, isBaseUnit: false },
        ],
      },
    },
  });

  const oil = await db.product.upsert({
    where: { sku: "OIL-1L" },
    update: {},
    create: {
      sku: "OIL-1L",
      barcode: "8901000002",
      name: "Cooking Oil",
      category: "Grocery",
      baseUnitId: bySymbol.l!.id,
      wholesalePrice: 130,
      retailPrice: 145,
      taxPercent: 5,
      minStock: 30,
      saleUnits: {
        create: [
          { unitId: bySymbol.l!.id, factorToBase: 1, isBaseUnit: true },
          { unitId: bySymbol.ml!.id, factorToBase: 0.001, isBaseUnit: false },
        ],
      },
    },
  });

  const soap = await db.product.upsert({
    where: { sku: "SOAP-PC" },
    update: {},
    create: {
      sku: "SOAP-PC",
      barcode: "8901000003",
      name: "Soap Bar",
      category: "Personal Care",
      baseUnitId: bySymbol.pc!.id,
      wholesalePrice: 22,
      retailPrice: 28,
      taxPercent: 12,
      minStock: 100,
      saleUnits: {
        create: [
          { unitId: bySymbol.pc!.id, factorToBase: 1, isBaseUnit: true },
          { unitId: bySymbol.dz!.id, factorToBase: 12, isBaseUnit: false },
        ],
      },
    },
  });

  for (const [product, qty] of [
    [sugar, 500],
    [oil, 300],
    [soap, 1000],
  ] as const) {
    await db.inventory.upsert({
      where: { productId_warehouseId: { productId: product.id, warehouseId: warehouse.id } },
      update: {},
      create: { productId: product.id, warehouseId: warehouse.id, quantityOnHand: qty, quantityReserved: 0 },
    });
  }

  await db.customer.upsert({
    where: { mobile: "9800000001" },
    update: {},
    create: { shopName: "Green Grocers", ownerName: "Kiran", mobile: "9800000001", type: "RETAIL" },
  });
  await db.customer.upsert({
    where: { mobile: "9800000002" },
    update: {},
    create: { shopName: "City Wholesale Traders", ownerName: "Ramesh", mobile: "9800000002", type: "WHOLESALE" },
  });

  console.log("Seed complete. Logins (password: password123):");
  for (const u of users) console.log(`  ${u.staffId} — ${u.role}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
