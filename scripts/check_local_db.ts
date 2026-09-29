import { PrismaClient } from "../src/generated/prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";

async function main() {
  const connectionString = "postgresql://wms:wms@localhost:5432/wms";
  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  try {
    const products = await prisma.product.findMany();
    const inventory = await prisma.inventory.findMany();
    const batches = await prisma.stockBatch.findMany();
    const warehouses = await prisma.warehouse.findMany();

    console.log("=== LOCAL DOCKER DB STATUS ===");
    console.log("Warehouses:", warehouses.length);
    console.log("Products:", products.length);
    console.log("Inventory Rows:", inventory.length);
    console.log("Batches:", batches.length);
  } catch (err: any) {
    console.log("Local Docker DB Query Error / Unmigrated:", err.message);
  } finally {
    await prisma.$disconnect();
  }
}

main().catch(console.error);
