import { writeFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const out = resolve(__dirname, "dist", "index.cjs");

const cjs = `"use strict";
module.exports = (async () => {
  const esm = await import("./index.js");
  return esm;
})();
`;
writeFileSync(out, cjs, "utf8");
console.log("wrote", out);
