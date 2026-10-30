import { createClient } from "@libsql/client";
import { readFile } from "node:fs/promises";

const url = process.env.DATABASE_URL;
const authToken = process.env.DATABASE_AUTH_TOKEN;
const sqlPath = process.argv[2];

if (!url || !url.startsWith("libsql://") || !authToken || !sqlPath) {
  throw new Error("Set DATABASE_URL (libsql://...), DATABASE_AUTH_TOKEN, and pass a SQL file path.");
}

const sql = await readFile(sqlPath, "utf8");
if (!sql.trim()) throw new Error("Generated schema SQL is empty.");

// Extract expected Prisma model table names from generated SQLite SQL.
const expectedTables = Array.from(
  sql.matchAll(/CREATE TABLE\s+(?:IF NOT EXISTS\s+)?["']?([A-Za-z0-9_]+)["']?\s*\(/gi),
  (match) => match[1]
);

if (expectedTables.length === 0) {
  throw new Error("Could not find CREATE TABLE statements in the generated Prisma SQL.");
}

const client = createClient({ url, authToken });

try {
  async function readTables() {
    const result = await client.execute(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
    );
    return new Set(result.rows.map((row) => String(row.name)));
  }

  const existing = await readTables();

  if (existing.size > 0) {
    const missing = expectedTables.filter((name) => !existing.has(name));
    if (missing.length > 0) {
      throw new Error(
        "Turso already contains tables but the schema is incomplete. Missing: " +
          missing.join(", ") +
          ". Refusing to modify existing data automatically."
      );
    }

    console.log(
      "Existing Turso schema verified (" +
        expectedTables.length +
        " expected tables). Skipping schema creation; no existing data was changed."
    );
  } else {
    console.log("Applying Prisma-generated SQLite schema to the empty Turso database...");
    await client.executeMultiple(sql);
  }

  const finalTables = await readTables();
  const missingAfterApply = expectedTables.filter((name) => !finalTables.has(name));

  if (missingAfterApply.length > 0) {
    throw new Error(
      "Schema verification failed. Missing tables: " + missingAfterApply.join(", ")
    );
  }

  console.log("Schema verified. Expected tables present: " + expectedTables.length);
} finally {
  client.close();
}
