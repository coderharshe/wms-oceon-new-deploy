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
    { staffId: "ADMIN-1", name: "Asha Admin", role: "ADMIN" as const, warehouseId: null },
    { staffId: "MGR-1", name: "Manoj Manager", role: "MANAGER" as const, warehouseId: warehouse.id },
    { staffId: "FIN-1", name: "Farah Finance", role: "FINANCE" as const, warehouseId: warehouse.id },
    { staffId: "QC-1", name: "Qasim QC", role: "QC" as const, warehouseId: warehouse.id },
  ];
  for (const u of users) {
    await db.user.upsert({
      where: { staffId: u.staffId },
      update: { plainPassword },
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
