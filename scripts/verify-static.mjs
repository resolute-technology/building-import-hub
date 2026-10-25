import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

const root = path.resolve(".output/public");
async function filesIn(dir) {
  const entries = await readdir(dir, { withFileTypes: true });
  return (
    await Promise.all(
      entries.map((e) =>
        e.isDirectory() ? filesIn(path.join(dir, e.name)) : path.join(dir, e.name),
      ),
    )
  ).flat();
}
const files = await filesIn(root);
const htmlFiles = files.filter((f) => f.endsWith(".html"));
assert.deepEqual(
  htmlFiles.map((f) => path.relative(root, f)).sort(),
  ["_shell.html"],
  "Unexpected HTML can override Firebase SPA rewrites",
);
const shell = await readFile(path.join(root, "_shell.html"), "utf8");
assert.match(shell, /<script[^>]+type="module"/);
assert.doesNotMatch(shell, /Welcome to Firebase|Firebase Hosting Setup Complete/);
for (const match of shell.matchAll(/(?:src|href)="(\/[^"?#]*)(?:[^"\s]*)?"/g)) {
  assert(files.includes(path.join(root, match[1])), `Missing shell asset: ${match[1]}`);
}
for (const file of files.filter((f) => /\.(js|html|json|map)$/.test(f))) {
  const content = await readFile(file, "utf8");
  assert.doesNotMatch(content, /sb_secret_[A-Za-z0-9_-]+/, "Secret API key found in static output");
  for (const token of content.matchAll(/eyJ[A-Za-z0-9_-]+\.([A-Za-z0-9_-]+)\.[A-Za-z0-9_-]+/g)) {
    let payload;
    try {
      payload = JSON.parse(Buffer.from(token[1], "base64url"));
    } catch {
      continue;
    }
    assert.notEqual(payload.role, "service_role", "Service-role JWT found in static output");
  }
}
const { hosting } = JSON.parse(await readFile("firebase.json", "utf8"));
assert.equal(hosting.public, ".output/public");
assert.deepEqual(hosting.rewrites, [{ source: "**", destination: "/_shell.html" }]);
assert(!hosting.functions && !hosting.run);
console.log(
  `Static output verified: ${files.length} files; HTML: _shell.html; shell assets present; no secret-key patterns detected.`,
);
