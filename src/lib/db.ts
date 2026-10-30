// SuryaDesk database client.
// Dual-mode:
//  - DATABASE_URL starts with "file:"    → local SQLite via plain PrismaClient (dev / self-hosted)
//  - DATABASE_URL starts with "libsql:"  → Turso / remote libSQL via Prisma's libSQL driver adapter
// The rest of the app always imports { db } from here and never cares about the driver.
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined;
};

function createPrisma(): PrismaClient {
  const url = process.env.DATABASE_URL ?? "";

  if (url.startsWith("libsql:")) {
    // Prisma ORM 6.6+ expects adapter connection options, not a pre-created libSQL client.
    // Lazy import keeps local SQLite installs independent of the Turso adapter at runtime.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { PrismaLibSQL } = require("@prisma/adapter-libsql");

    const adapter = new PrismaLibSQL({
      url,
      authToken: process.env.DATABASE_AUTH_TOKEN,
    });

    return new PrismaClient({ adapter } as never);
  }

  return new PrismaClient({ log: ["warn", "error"] });
}

export const db = globalForPrisma.prisma ?? createPrisma();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
