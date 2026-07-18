// One-shot local setup: creates .env with a strong AUTH_SECRET (if missing)
// and applies database migrations. Cross-platform (Windows/macOS/Linux).
// Usage: npm run setup

import { existsSync, writeFileSync } from "node:fs";
import { randomBytes } from "node:crypto";
import { execSync } from "node:child_process";

const [major] = process.versions.node.split(".").map(Number);
if (major < 20) {
  console.error(`\n✗ Node.js ${process.versions.node} detected — this app needs Node.js 20 or newer.`);
  console.error("  Install the LTS version from https://nodejs.org and run `npm run setup` again.\n");
  process.exit(1);
}

if (!existsSync(".env")) {
  const secret = randomBytes(32).toString("hex");
  writeFileSync(".env", `DATABASE_URL="file:./dev.db"\nAUTH_SECRET="${secret}"\n`);
  console.log("✓ Created .env with a generated AUTH_SECRET");
} else {
  console.log("✓ .env already exists — leaving it untouched");
}

console.log("→ Applying database migrations…");
execSync("npx prisma migrate deploy", { stdio: "inherit" });

console.log("\n✓ Setup complete. Next:\n  npm run build\n  npm start\n\nThen open http://localhost:3000");
