import { mkdirSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { setupAccounts } from "../src/lib/store";
const accounts = setupAccounts();
mkdirSync("output", { recursive: true });
const path = resolve("output/CRM-INITIAL-LOGINS.txt");
writeFileSync(
  path,
  [
    "AutoNeural CRM — private initial logins",
    "These are CRM passwords, not mailbox passwords. Each user must change their password at first login.",
    "Distribute each password privately to its owner. Delete this file after distribution.",
    "",
    ...accounts.map(
      (a) => `${a.email}\nRole: ${a.role}\nTemporary password: ${a.password}\n`,
    ),
  ].join("\n"),
  { mode: 0o600, flag: "wx" },
);
console.log(`Created five accounts. Private login details saved to ${path}`);
