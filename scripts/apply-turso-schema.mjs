import { createClient } from "@libsql/client";
import { readFile } from "node:fs/promises";

const url = process.env.DATABASE_URL;
const authToken = process.env.DATABASE_AUTH_TOKEN;
const sqlPath = process.argv[2];

if (!url?.startsWith("libsql://") || !authToken || !sqlPath) {
  throw new Error("Set DATABASE_URL (libsql://...), DATABASE_AUTH_TOKEN, and pass a SQL file path.");
}

const sql = await readFile(sqlPath, "utf8");
if (!sql.trim()) throw new Error("Generated schema SQL is empty.");

const client = createClient({ url, authToken });

try {
  const existing = await client.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  );

  if (existing.rows.length > 0) {
    const names = existing.rows.map((row) => String(row.name)).join(", ");
    throw new Error(
      `Refusing to apply a fresh schema because the Turso database already has tables: ${names}. No data was changed.`
    );
  }

  console.log("Applying Prisma-generated SQLite schema to the empty Turso database...");
  await client.executeMultiple(sql);

  const check = await client.execute(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
  );
  const names = new Set(check.rows.map((row) => String(row.name)));
  for (const required of ["Organization", "User", "Customer", "Installation", "ServiceJob"]) {
    if (!names.has(required)) {
      throw new Error(`Schema verification failed: missing table ${required}`);
    }
  }

  console.log(`Schema applied and verified. Tables created: ${check.rows.length}`);
} finally {
  client.close();
}
