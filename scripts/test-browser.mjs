import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

// Optional local smoke check using an installed Chrome, without test credentials.
for (const route of ["/auth", "/buildings"]) {
  const profile = await mkdtemp(path.join(os.tmpdir(), "building-browser-"));
  try {
    const { stdout } = await promisify(execFile)(
      process.env.CHROME_EXECUTABLE || "google-chrome-stable",
      [
        "--headless",
        "--no-sandbox",
        "--disable-gpu",
        "--disable-dev-shm-usage",
        `--user-data-dir=${profile}`,
        "--dump-dom",
        "--virtual-time-budget=8000",
        `http://127.0.0.1:5000${route}`,
      ],
      { timeout: 30000, maxBuffer: 2 * 1024 * 1024 },
    );
    assert.match(stdout, /<h1[^>]*>Sign in<\/h1>/, `${route}: sign-in form should render`);
    assert.match(stdout, /id="email"/);
    assert.match(stdout, /id="password"/);
    console.log(`PASS Chrome ${route}: sign-in form rendered for a signed-out visitor`);
  } finally {
    await rm(profile, { recursive: true, force: true });
  }
}
