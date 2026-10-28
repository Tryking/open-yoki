// LibTV adapter (Kling O3, OmniHuman ...) through LibTV's own command-line client.
// LibTV is a mainland-China service: proxy variables are stripped before calling it, otherwise
// background generation requests fail and the node is never created.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { libtvConfig } from "./env.mjs";

const ENV = Object.fromEntries(Object.entries(process.env).filter(([k]) => !/^(https?_proxy|all_proxy|no_proxy|NODE_USE_ENV_PROXY)$/i.test(k)));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

export function libtv(args) {
  const { bin, project } = libtvConfig();
  const r = spawnSync(bin, [...args, "-p", project], { encoding: "utf8", maxBuffer: 64 << 20, env: ENV });
  if (r.status) throw new Error(`libtv ${args[0]} ${args[1] || ""}: ${(r.stderr || r.stdout).slice(-400)}`);
  return r.stdout;
}

export function upload(file, name) {
  const out = libtv(["upload", name, "-f", file]);
  const m = out.match(/"cdnUrl"\s*:\s*"([^"]+)"/);
  if (!m) throw new Error(`LibTV upload of ${name} returned no URL: ${out.slice(-200)}`);
  return m[1];
}

function nodeState(name) {
  const d = JSON.parse(libtv(["node", name])).data;
  return { url: d.url?.[0], status: d.taskInfo?.status, pct: d.taskInfo?.progressPercent, why: d.taskInfo?.failedReason };
}

// Create a video node and poll it ourselves (the client's own wait mode hangs on a 503 now and then).
// sets: ["model=Kling O3", "modeType=mixed2video", ...]; lefts: names of uploaded inputs, in order.
export async function runNode(name, sets, lefts, prompt, { timeoutMin = 45, log = console.log } = {}) {
  const { bin, project } = libtvConfig();
  const args = ["node", "create", name, "-t", "video", ...sets.flatMap((s) => ["-s", s]), ...lefts.flatMap((l) => ["--left", l]), ...(prompt ? ["--prompt", prompt] : []), "-r"];
  const logFile = path.join(os.tmpdir(), `studio-libtv-${name}.log`);
  const q = (a) => `'${String(a).replace(/'/g, "'\\''")}'`;
  const child = spawnSync("bash", ["-c", `${q(bin)} ${args.map(q).join(" ")} -p ${q(project)} > ${q(logFile)} 2>&1 &`], { env: ENV });
  if (child.status) throw new Error("could not start the LibTV client");
  const t0 = Date.now(); let last = -1;
  await sleep(20000);
  while (Date.now() - t0 < timeoutMin * 60000) {
    let s; try { s = nodeState(name); } catch { s = {}; }
    if (s.status == null && Date.now() - t0 > 150000) throw new Error(`${name}: node was not created after 2.5 min, see ${logFile}`);
    if (s.url) return s.url;
    if (s.status === 3 || s.status === -1) { const e = new Error(`${name} failed: ${s.why || "no reason given"} (log ${logFile})`); e.genFailed = true; throw e; }
    if (s.pct !== last) { log(`  ${name} ${s.pct ?? "?"}%`); last = s.pct; }
    await sleep(30000);
  }
  throw new Error(`${name} not done after ${timeoutMin} min; it stays in your LibTV project, check later with: libtv node ${name}`);
}
