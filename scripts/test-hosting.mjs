import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

const shell = await readFile(".output/public/_shell.html", "utf8");
for (const route of ["/", "/auth", "/buildings"]) {
  const response = await fetch(`http://127.0.0.1:5000${route}`);
  assert.equal(response.status, 200, route);
  assert.equal(await response.text(), shell, `${route} must serve the SPA shell`);
  console.log(`PASS ${route}: 200, SPA shell`);
}
const asset = /src="(\/assets\/[^\"]+\.js)"/.exec(shell)?.[1];
assert(asset);
const response = await fetch(`http://127.0.0.1:5000${asset}`);
assert.equal(response.status, 200);
assert.match(response.headers.get("content-type"), /javascript/);
console.log("PASS JavaScript asset: 200, JavaScript MIME type");
