#!/usr/bin/env node
// Offline check of a character folder: fields, files, image sizes. Free, no network.
// Usage: node character/validate.mjs <character folder> [--strict]   (--strict: warnings also fail)
import path from "node:path";
import { validateCharacter } from "../lib/character.mjs";
import { parseArgs } from "../lib/args.mjs";

const { pos, flags } = parseArgs();
if (!pos[0]) { console.log("Usage: node character/validate.mjs <character folder> [--strict]"); process.exit(1); }
const { errors, warnings, c } = validateCharacter(pos[0]);
console.log(`${c?.name || path.basename(path.resolve(pos[0]))}: ${errors.length} error(s), ${warnings.length} warning(s)`);
for (const e of errors) console.log("  ✗ " + e);
for (const w of warnings) console.log("  ! " + w);
if (c && !errors.length) {
  console.log(`  looks: ${Object.keys(c.looks || {}).join(", ") || "-"} · aspect ${c.aspect || "16:9"} · calib ${c.calib.bad.length} bad / ${c.calib.good.length} good`);
}
process.exit(errors.length || (flags.strict && warnings.length) ? 1 : 0);
