// SuryaDesk database client.
// Dual-mode:
//  - DATABASE_URL starts with "file:"    → local SQLite via plain PrismaClient (dev / self-hosted)
//  - DATABASE_URL starts with "libsql:"  → Turso / remote libSQL via driver adapter (Vercel / serverless)
// The rest of the app always imports { db } from here and never cares about the driver.
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrisma(): PrismaClient {
  const url = process.env.DATABASE_URL ?? "";
  if (url.startsWith("libsql:")) {
    // Lazy-imported so local installs never need the libsql packages at runtime.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { createClient } = require("@libsql/client");
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PrismaLibSQL } = require("@prisma/adapter-libsql");
    const libsql = createClient({
      url,
      authToken: process.env.DATABASE_AUTH_TOKEN,
    });
    return new PrismaClient({ adapter: new PrismaLibSQL(libsql) } as never);
  }
  return new PrismaClient({ log: ["warn", "error"] });
}

export const db = globalForPrisma.prisma ?? createPrisma();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
