// Runner: bun prisma/seed.ts
import { seedDemoData } from "../src/lib/surya/seed";

seedDemoData()
  .then(() => {
    console.log("✓ SuryaDesk demo seed complete");
    process.exit(0);
  })
  .catch((e) => {
    console.error("Seed failed:", e);
    process.exit(1);
  });
