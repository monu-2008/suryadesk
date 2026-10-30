import { createClient } from "@libsql/client";

const url = process.env.DATABASE_URL;
const authToken = process.env.DATABASE_AUTH_TOKEN;

if (!url?.startsWith("libsql://") || !authToken) {
  throw new Error("DATABASE_URL and DATABASE_AUTH_TOKEN are required.");
}

const client = createClient({ url, authToken });

try {
  const checks = [
    ["organizations", "Organization"],
    ["users", "User"],
    ["customers", "Customer"],
    ["installations", "Installation"],
    ["AMC contracts", "AmcContract"],
    ["service requests", "ServiceRequest"],
    ["service jobs", "ServiceJob"],
  ];

  let total = 0;
  for (const [label, table] of checks) {
    const result = await client.execute(`SELECT COUNT(*) AS count FROM "${table}"`);
    const count = Number(result.rows[0]?.count ?? 0);
    console.log(`${label}: ${count}`);
    total += count;
  }

  if (total === 0) {
    throw new Error("Seed verification failed: all checked tables are empty.");
  }

  console.log("Turso seed verification passed.");
} finally {
  client.close();
}
