// Tiny flag parser: positional args + --flag value / --flag (boolean). Repeated flags become arrays.
export function parseArgs(argv = process.argv.slice(2)) {
  const pos = [], flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const k = a.slice(2), nx = argv[i + 1];
      const v = nx == null || nx.startsWith("--") ? true : (i++, nx);
      flags[k] = k in flags ? [].concat(flags[k], v) : v;
    } else pos.push(a);
  }
  return { pos, flags, list: (k) => (k in flags ? [].concat(flags[k]) : []) };
}
