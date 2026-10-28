#!/usr/bin/env node
// Voice lines with Doubao TTS (Volcengine). ~CNY 3 per 10,000 characters for stock voices at the time of writing.
//   node mv/voice.mjs tts   <out.wav> "<text>" [--speaker id] [--char dir] [--rate 0] [--tone "happy, teasing"] [--dry-run]
//   node mv/voice.mjs batch <lines.jsonl> <outdir> [--speaker id] [--char dir] [--conc 4]
//      lines.jsonl: one {"id":"l01","text":"...","tone":"...","rate":0,"speaker":"..."} per line; existing files are skipped
// Speaker: --speaker, else character.json voice.doubao_speaker (with --char), else DOUBAO_SPEAKER in .env.
// --tone is a plain-language acting note ("whispering, a bit shy"); --rate -50..100 (0 = normal).
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "../lib/args.mjs";
import { get } from "../lib/env.mjs";
import { tts } from "../lib/doubao.mjs";
import { loadCharacter } from "../lib/character.mjs";

const { pos, flags } = parseArgs();
const [cmd, a1, a2] = pos;
const speaker = flags.speaker || (flags.char ? loadCharacter(flags.char).voice?.doubao_speaker : "") || get("DOUBAO_SPEAKER");

async function main() {
  if (cmd === "tts" && a1 && a2) {
    console.log(`Doubao TTS · speaker ${speaker ? "set" : "(none)"} · ${[...a2].length} chars · tone "${flags.tone || ""}"`);
    if (flags["dry-run"]) return console.log("(dry run: nothing sent)");
    const r = await tts({ out: path.resolve(a1), text: a2, speaker, rate: flags.rate || 0, tone: flags.tone || "" });
    console.log(`✓ ${a1} ${r.seconds.toFixed(2)} s`);
  } else if (cmd === "batch" && a1 && a2) {
    const jobs = fs.readFileSync(a1, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l));
    fs.mkdirSync(a2, { recursive: true });
    const q = [...jobs]; let done = 0, chars = 0, fail = 0;
    console.log(`${jobs.length} line(s), ${jobs.reduce((s, j) => s + [...j.text].length, 0)} chars`);
    if (flags["dry-run"]) return console.log("(dry run: nothing sent)");
    await Promise.all(Array.from({ length: +(flags.conc || 4) }, async () => {
      while (q.length) {
        const j = q.shift(), out = path.join(a2, `${j.id}.wav`);
        if (fs.existsSync(out)) continue;
        try { await tts({ out, text: j.text, speaker: j.speaker || speaker, rate: j.rate ?? flags.rate ?? 0, tone: j.tone || flags.tone || "", pitch: j.pitch }); done++; chars += [...j.text].length; }
        catch (e) { fail++; console.error(`✗ ${j.id}: ${e.message.slice(0, 160)}`); }
      }
    }));
    console.log(`done ${done}, failed ${fail}, ${chars} chars`);
  } else { console.log(fs.readFileSync(new URL(import.meta.url), "utf8").split("\n").filter((x) => x.startsWith("//")).join("\n")); process.exit(1); }
}
main().catch((e) => { console.error("✗ " + e.message); process.exit(1); });
