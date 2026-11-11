import { spawnSync } from "node:child_process";

/** Runs every browser test file in turn and fails if any of them does. */
const files = ["core", "effects", "more", "edge", "react", "site", "portfolio", "lifecycle", "hunt-combos", "hunt-scroll", "hunt-interact", "hunt-conditions", "hunt-review", "hunt2-features", "hunt2-sites", "hunt2-code", "hunt3-shared", "hunt3-odometer", "reach", "hunt4-e2e"];
let failed = false;
for (const file of files) {
  console.log(`\n${file}`);
  const result = spawnSync("node", [`test/browser/${file}.test.mjs`, ...process.argv.slice(2)], { stdio: "inherit" });
  if (result.status !== 0) failed = true;
}
process.exit(failed ? 1 : 0);
