import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const source = path.join(root, "node_modules", "pdfjs-dist");
const target = path.join(root, "public", "pdfjs");

// PDF.js fetches CMaps, standard fonts and WASM helpers at runtime. Keeping
// these assets local is what makes the tool fully offline.
const directories = ["cmaps", "standard_fonts", "wasm", "iccs"];

fs.mkdirSync(target, { recursive: true });

for (const directory of directories) {
  const from = path.join(source, directory);
  const to = path.join(target, directory);
  if (!fs.existsSync(from)) {
    throw new Error(`Missing PDF.js asset directory: ${from}`);
  }
  fs.cpSync(from, to, { recursive: true, force: true });
}

console.log(`Prepared offline PDF.js assets in ${path.relative(root, target)}`);
