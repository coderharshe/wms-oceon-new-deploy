import { defineConfig } from "drizzle-kit";

// Only used for `drizzle-kit introspect` to pull the schema that Prisma
// Migrate already created — Prisma stays the migration tool (schema.prisma
// is still the source of truth for DDL); Drizzle is a second, Workers-safe
// query layer read against the same database.
export default defineConfig({
  dialect: "postgresql",
  schema: "./src/generated/drizzle/schema.ts",
  out: "./src/generated/drizzle",
  dbCredentials: {
    url: process.env.DATABASE_URL!,
  },
});
