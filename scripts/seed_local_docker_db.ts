import { getDb } from "../src/lib/db";
import bcrypt from "bcryptjs";

async function main() {
  const db = getDb();
  console.log("Seeding test data into local Docker database...");

  // 1. Warehouses
  let wh = await db.warehouse.findFirst({ where: { active: true } });
  if (!wh) {
    wh = await db.warehouse.create({
      data: {
        code: "WH-MAIN",
        name: "Main Central Hub",
        address: "Industrial Area Phase 2",
        active: true,
      },
    });
  }
  console.log("Warehouse:", wh.name, wh.id);

  // 2. Units
  const unitsData = [
    { name: "Piece", symbol: "pc", type: "COUNT" as const },
    { name: "Kilogram", symbol: "kg", type: "WEIGHT" as const },
    { name: "Gram", symbol: "g", type: "WEIGHT" as const },
    { name: "Litre", symbol: "l", type: "VOLUME" as const },
    { name: "Millilitre", symbol: "ml", type: "VOLUME" as const },
    { name: "Box", symbol: "box", type: "COUNT" as const },
    { name: "Packet", symbol: "pkt", type: "COUNT" as const },
    { name: "Jar", symbol: "jar", type: "COUNT" as const },
  ];

  const unitMap = new Map<string, string>();
  for (const u of unitsData) {
    let existing = await db.unit.findUnique({ where: { symbol: u.symbol } });
    if (!existing) {
      existing = await db.unit.create({ data: u });
    }
    unitMap.set(u.symbol, existing.id);
  }

  // 3. Admin User & Staff
  const passwordHash = await bcrypt.hash("password123", 10);
  const usersData = [
    { staffId: "ADM001", name: "System Admin", role: "ADMIN" as const, plainPassword: "password123" },
    { staffId: "MGR001", name: "Warehouse Manager", role: "MANAGER" as const, plainPassword: "password123", warehouseId: wh.id },
    { staffId: "INV001", name: "Inventory Supervisor", role: "INVENTORY" as const, plainPassword: "password123", warehouseId: wh.id },
    { staffId: "BIL001", name: "Billing Executive", role: "BILLING" as const, plainPassword: "password123", warehouseId: wh.id },
    { staffId: "FIN001", name: "Finance Officer", role: "FINANCE" as const, plainPassword: "password123", warehouseId: wh.id },
    { staffId: "QC001", name: "QC Inspector", role: "QC" as const, plainPassword: "password123", warehouseId: wh.id },
  ];

  let adminUser: any = null;
  for (const u of usersData) {
    const existing = await db.user.findUnique({ where: { staffId: u.staffId } });
    if (!existing) {
      const created = await db.user.create({
        data: {
          staffId: u.staffId,
          name: u.name,
          role: u.role,
          passwordHash,
          plainPassword: u.plainPassword,
          warehouseId: u.warehouseId,
          active: true,
        },
      });
      if (u.role === "ADMIN") adminUser = created;
    } else {
      if (u.role === "ADMIN") adminUser = existing;
    }
  }

  // 4. Products (Healthy Stock, Low Stock, and Out of Stock)
  const productsData = [
    // Healthy stock items
    { sku: "SUGAR-PREM-1KG", name: "Premium Sugar 1kg", symbol: "kg", wholesalePrice: 42, retailPrice: 48, minStock: 20, onHand: 150 },
    { sku: "OIL-SUNFLOWER-1L", name: "Sunflower Cooking Oil 1L", symbol: "l", wholesalePrice: 135, retailPrice: 150, minStock: 25, onHand: 80 },
    { sku: "ATTA-CHAKKI-10KG", name: "Chakki Fresh Atta 10kg", symbol: "kg", wholesalePrice: 380, retailPrice: 420, minStock: 15, onHand: 45 },
    { sku: "SOAP-DETTOL-125G", name: "Dettol Bath Soap 125g", symbol: "pc", wholesalePrice: 38, retailPrice: 45, minStock: 30, onHand: 120 },
    { sku: "TEA-TAZA-500G", name: "Brooke Bond Red Label Tea 500g", symbol: "pkt", wholesalePrice: 220, retailPrice: 260, minStock: 20, onHand: 60 },
    { sku: "COKE-500ML", name: "Coca Cola Bottle 500ml", symbol: "pc", wholesalePrice: 32, retailPrice: 40, minStock: 40, onHand: 95 },

    // Low stock items (stock below minStock threshold)
    { sku: "DAL-TOOR-1KG", name: "Toor Dal Special 1kg", symbol: "kg", wholesalePrice: 165, retailPrice: 190, minStock: 40, onHand: 8 },
    { sku: "RICE-BASMATI-5KG", name: "Royal Basmati Rice 5kg", symbol: "pkt", wholesalePrice: 520, retailPrice: 600, minStock: 30, onHand: 6 },
    { sku: "GHEE-AMUL-1L", name: "Amul Pure Ghee 1L Tin", symbol: "jar", wholesalePrice: 590, retailPrice: 650, minStock: 25, onHand: 4 },
    { sku: "BISCUIT-PARLE-G", name: "Parle-G Gold Biscuits Pack", symbol: "box", wholesalePrice: 110, retailPrice: 130, minStock: 50, onHand: 12 },

    // Out of Stock items (0 stock in inventory)
    { sku: "HONEY-DABUR-500G", name: "Dabur 100% Pure Honey 500g", symbol: "jar", wholesalePrice: 210, retailPrice: 250, minStock: 15, onHand: 0 },
    { sku: "KETCHUP-KISSAN-1KG", name: "Kissan Fresh Tomato Ketchup 1kg", symbol: "pc", wholesalePrice: 125, retailPrice: 150, minStock: 20, onHand: 0 },
    { sku: "SHAMPOO-DOVE-650ML", name: "Dove Hair Therapy Shampoo 650ml", symbol: "pc", wholesalePrice: 420, retailPrice: 499, minStock: 10, onHand: 0 },
    { sku: "MAGGI-2MINUTE-4PK", name: "Maggi Masala Noodles 4-Pack", symbol: "pkt", wholesalePrice: 54, retailPrice: 60, minStock: 35, onHand: 0 },
    { sku: "SALT-TATA-LITE-1KG", name: "Tata Salt Lite Low Sodium 1kg", symbol: "pkt", wholesalePrice: 38, retailPrice: 45, minStock: 25, onHand: 0 },
    { sku: "DETERGENT-SURF-2KG", name: "Surf Excel Easy Wash 2kg", symbol: "pkt", wholesalePrice: 290, retailPrice: 340, minStock: 20, onHand: 0 },
    { sku: "CHIPS-LAYS-CLASSIC", name: "Lays Classic Salted Chips Box", symbol: "box", wholesalePrice: 180, retailPrice: 220, minStock: 15, onHand: 0 },
    { sku: "JUICE-REAL-MANGO-1L", name: "Real Fruit Power Mango Juice 1L", symbol: "pc", wholesalePrice: 95, retailPrice: 120, minStock: 30, onHand: 0 },
  ];

  const createdProducts: any[] = [];

  for (const p of productsData) {
    const unitId = unitMap.get(p.symbol) || unitMap.get("pc")!;
    let prod = await db.product.findUnique({ where: { sku: p.sku } });
    if (!prod) {
      prod = await db.product.create({
        data: {
          sku: p.sku,
          name: p.name,
          baseUnitId: unitId,
          wholesalePrice: p.wholesalePrice,
          retailPrice: p.retailPrice,
          minStock: p.minStock,
          active: true,
        },
      });
    } else {
      prod = await db.product.update({
        where: { id: prod.id },
        data: {
          name: p.name,
          wholesalePrice: p.wholesalePrice,
          retailPrice: p.retailPrice,
          minStock: p.minStock,
          active: true,
        },
      });
    }

    createdProducts.push({ ...prod, onHand: p.onHand });

    // Inventory row
    const existingInv = await db.inventory.findFirst({
      where: { productId: prod.id, warehouseId: wh.id },
    });
    if (existingInv) {
      await db.inventory.update({
        where: { id: existingInv.id },
        data: { quantityOnHand: p.onHand },
      });
    } else {
      await db.inventory.create({
        data: {
          productId: prod.id,
          warehouseId: wh.id,
          quantityOnHand: p.onHand,
        },
      });
    }
  }

  // 5. Stock Batches (Expired & Near Expiry)
  const now = new Date();
  const dayMs = 24 * 60 * 60 * 1000;

  await db.stockBatch.deleteMany({ where: { warehouseId: wh.id } });

  const batchList = [
    // 2 Expired batches
    {
      productId: createdProducts[0].id, // Premium Sugar
      batchNumber: "EXP-SUG-2026-08",
      quantityOnHand: 20,
      costRate: 40,
      expiryDate: new Date(now.getTime() - 15 * dayMs),
      mfgDate: new Date(now.getTime() - 200 * dayMs),
      notes: "Expired sugar batch",
    },
    {
      productId: createdProducts[1].id, // Cooking Oil
      batchNumber: "EXP-OIL-2026-07",
      quantityOnHand: 10,
      costRate: 130,
      expiryDate: new Date(now.getTime() - 40 * dayMs),
      mfgDate: new Date(now.getTime() - 240 * dayMs),
      notes: "Expired oil batch",
    },
    // 3 Near Expiry batches
    {
      productId: createdProducts[2].id, // Atta
      batchNumber: "NEAR-ATTA-CRIT",
      quantityOnHand: 15,
      costRate: 360,
      expiryDate: new Date(now.getTime() + 4 * dayMs),
      mfgDate: new Date(now.getTime() - 80 * dayMs),
      notes: "Critical near-expiry (expires in 4 days)",
    },
    {
      productId: createdProducts[3].id, // Soap
      batchNumber: "NEAR-SOAP-HIGH",
      quantityOnHand: 40,
      costRate: 35,
      expiryDate: new Date(now.getTime() + 18 * dayMs),
      mfgDate: new Date(now.getTime() - 60 * dayMs),
      notes: "High priority (expires in 18 days)",
    },
    {
      productId: createdProducts[4].id, // Tea
      batchNumber: "NEAR-TEA-MED",
      quantityOnHand: 30,
      costRate: 210,
      expiryDate: new Date(now.getTime() + 42 * dayMs),
      mfgDate: new Date(now.getTime() - 50 * dayMs),
      notes: "Medium priority (expires in 42 days)",
    },
  ];

  for (const b of batchList) {
    await db.stockBatch.create({
      data: {
        ...b,
        warehouseId: wh.id,
      },
    });
  }

  // 6. Today Movements
  await db.inventoryMovement.deleteMany({ where: { warehouseId: wh.id } });
  const startOfToday = new Date();
  startOfToday.setHours(9, 0, 0, 0);

  if (adminUser) {
    await db.inventoryMovement.create({
      data: {
        productId: createdProducts[0].id,
        warehouseId: wh.id,
        movementType: "GRN",
        movementQty: 120,
        beforeQty: 30,
        afterQty: 150,
        referenceType: "PURCHASE_ORDER",
        referenceId: "PO-DOCKER-001",
        userId: adminUser.id,
        timestamp: startOfToday,
      },
    });

    await db.inventoryMovement.create({
      data: {
        productId: createdProducts[1].id,
        warehouseId: wh.id,
        movementType: "SALE",
        movementQty: -25,
        beforeQty: 105,
        afterQty: 80,
        referenceType: "ORDER",
        referenceId: "ORD-DOCKER-001",
        userId: adminUser.id,
        timestamp: new Date(startOfToday.getTime() + 2 * 60 * 60 * 1000),
      },
    });
  }

  console.log("Local Docker DB has been seeded with full inventory test data!");
}

main().catch(console.error);
