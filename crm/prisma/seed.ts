/* Production setup only: never insert fabricated business records. */
import { execFileSync } from "node:child_process";
execFileSync(process.execPath, ["scripts/bootstrap-production.mjs"], { stdio: "inherit" });
