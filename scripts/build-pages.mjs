import { cp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const repositoryRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const siteRoot = join(repositoryRoot, "site");
const labRoot = join(repositoryRoot, "examples", "card-engine-lab");

await rm(siteRoot, { recursive: true, force: true });
await mkdir(siteRoot, { recursive: true });
await cp(labRoot, siteRoot, { recursive: true });
await cp(
  join(repositoryRoot, "packages", "card-engine", "src"),
  join(siteRoot, "packages", "card-engine", "src"),
  { recursive: true },
);

const threeModule = "https://unpkg.com/three@0.186.0/build/three.module.js";
const threeAddons = "https://unpkg.com/three@0.186.0/examples/jsm/";
const replacements = {
  "index.html": [
    ["../../packages/card-engine/src/styles.css", "./packages/card-engine/src/styles.css"],
    ["/examples/card-engine-lab/lab-logo.png", "./lab-logo.png"],
    ["/examples/card-engine-lab/zones.html", "./zones.html"],
    ["/packages/card-engine/node_modules/three/build/three.module.js", threeModule],
    ["/packages/card-engine/node_modules/three/examples/jsm/", threeAddons],
    ["/examples/card-engine-lab/main.js", "./main.js"],
  ],
  "main.js": [
    ["../../packages/card-engine/src/index.js", "./packages/card-engine/src/index.js"],
    ["/examples/card-engine-lab/", "./"],
  ],
  "zones.html": [
    ["/packages/card-engine/src/styles.css", "./packages/card-engine/src/styles.css"],
    ["/packages/card-engine/node_modules/three/build/three.module.js", threeModule],
    ["/examples/card-engine-lab/zones.js", "./zones.js"],
    ["href=\"/\"", "href=\"./\""],
  ],
  "zones.js": [
    ["/packages/card-engine/src/index.js", "./packages/card-engine/src/index.js"],
  ],
};

for (const [relativeFile, fileReplacements] of Object.entries(replacements)) {
  const file = join(siteRoot, relativeFile);
  let source = await readFile(file, "utf8");
  for (const [from, to] of fileReplacements) source = source.replaceAll(from, to);
  await writeFile(file, source);
}

console.log(`Built GitHub Pages site at ${siteRoot}`);
