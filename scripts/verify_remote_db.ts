import * as dotenv from 'dotenv';
import * as path from 'path';

dotenv.config({ path: path.resolve(process.cwd(), '.env.production') });
import { getDb } from '../src/lib/db';

async function verify() {
  const db = getDb();
  const products = await db.product.findMany({
    take: 5,
    include: { baseUnit: true, saleUnits: { include: { unit: true } } },
  });
  console.log('✅ Successfully executed prisma.product.findMany() on remote production database!');
  console.log('Total products retrieved:', products.length);
  if (products.length > 0) {
    console.log('Sample product:', {
      id: products[0].id,
      name: products[0].name,
      mfgDate: products[0].mfgDate,
      expiryDate: products[0].expiryDate,
    });
  }
}

verify().catch((err) => {
  console.error('❌ Remote query error:', err);
  process.exit(1);
});
