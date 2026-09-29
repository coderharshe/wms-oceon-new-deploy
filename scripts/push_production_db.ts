import { execSync } from 'child_process';
import * as dotenv from 'dotenv';
import * as path from 'path';

const prodEnvPath = path.resolve(process.cwd(), '.env.production');
const envConfig = dotenv.config({ path: prodEnvPath }).parsed;

if (!envConfig || !envConfig.DATABASE_URL) {
  console.error('Could not find DATABASE_URL in .env.production');
  process.exit(1);
}

console.log('Pushing Prisma schema to production remote database...');
console.log('Target host:', new URL(envConfig.DATABASE_URL).host);

try {
  const result = execSync('npx prisma db push --accept-data-loss', {
    env: {
      ...process.env,
      DATABASE_URL: envConfig.DATABASE_URL,
    },
    stdio: 'inherit',
  });
  console.log('✅ Remote production database schema successfully updated and synchronized!');
} catch (err) {
  console.error('❌ Failed to push schema to remote database:', err);
  process.exit(1);
}
