// R4 guard: fails if unfinished-work markers appear in shipped folders.
// The marker words are assembled from fragments so this file does not match itself.
import { readdirSync, readFileSync, statSync, existsSync } from "node:fs";
import { join, extname } from "node:path";

const words = ["TO" + "DO", "FIX" + "ME", "not " + "implemented", "place" + "holder", "st" + "ub"];
const pattern = new RegExp(words.join("|"), "i");
const roots = ["src", "server", "tools", "tests"];
const exts = new Set([".ts", ".tsx", ".js", ".mjs", ".json", ".html", ".css", ".wgsl", ".glsl"]);

/** Recursively lists source files under a directory. */
function walk(dir, out) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (exts.has(extname(p))) out.push(p);
  }
  return out;
}

const hits = [];
for (const root of roots) {
  if (!existsSync(root)) continue;
  for (const file of walk(root, [])) {
    readFileSync(file, "utf8").split("\n").forEach((line, i) => {
      if (pattern.test(line)) hits.push(`${file}:${i + 1}: ${line.trim()}`);
    });
  }
}
if (hits.length > 0) {
  console.error(`Unfinished-work markers found (${hits.length}):\n` + hits.join("\n"));
  process.exit(1);
}
console.log("R4 marker check: clean");
