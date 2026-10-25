# Building Import Hub

A private buildings registry built with React 19, TanStack Router/Start, and Supabase. Built with [Lovable](https://lovable.dev/projects/36dc03b3-1ed5-4a95-b0cf-54b271c1411b).

## Architecture

Firebase **Hosting** serves a static SPA from `.output/public`. All application pages render in the browser (`defaultSsr: false` in `src/start.ts`); `spa.enabled` in `vite.config.ts` generates `.output/public/_shell.html`. Firebase rewrites unmatched paths to `/_shell.html`, so direct visits and refreshes at `/auth` and `/buildings` work. Keep `public/index.html` absent: exact static files take precedence over rewrites.

The Lovable Vite wrapper supplies React, TanStack, Tailwind, path aliases, and Nitro. Do not add duplicate plugins. Nitro still creates `.output/server` and renders the shell during the build; the deployed client does not need that server bundle. Only `.output/public` is deployed. Firebase Cloud Functions, App Hosting, and paid SSR infrastructure are unnecessary for this architecture; service quotas still apply.

The browser uses Supabase Auth with persistent sessions (localStorage on Firebase; the existing storage broker in Lovable previews). Protected routes verify the user. Building queries use the user's session and database RLS, with a separate query-cache key per user. Authentication changes invalidate routes and sign-out clears cached data.

Excel upload flow: browser reads a file → `supabase.functions.invoke("import-buildings")` sends base64 JSON and the session JWT → the Edge Function verifies the JWT with `auth.getUser()` → parses the first sheet → inserts rows using a public API key plus that same JWT. The function supplies `user_id` from the verified user, so RLS remains active. No TanStack server function participates.

`supabase/migrations/20261021132000_create_buildings.sql` records the expected table, index, grants, and per-user SELECT/INSERT/UPDATE/DELETE policies. Supabase Auth and PostgreSQL are the backend; Firebase provides hosting only. The legacy `drizzle/` scaffold is retained for Lovable compatibility; use the Supabase migrations for this backend.

## Local development

Use Node **24 LTS** (also used in GitHub Actions; `.nvmrc` provided) and npm. Node 26 is outside Firebase's current emulator dependency engine range.

```sh
nvm use
npm ci
# Only for a fresh checkout without .env; do not overwrite existing local settings:
cp .env.example .env
# Set the two required VITE_* values in .env or .env.local
npm run dev
```

`VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY` are required at **build time**. Use a publishable key (`sb_publishable_…`) or a legacy JWT with role `anon`. Public keys are expected in the bundle; authorization is enforced by Auth and RLS. Never expose a secret/service-role key, database password, or Firebase service-account credential to Vite. The build rejects missing or privileged keys. `VITE_SUPABASE_PROJECT_ID` is optional metadata. No server-side Supabase environment variables are needed by the SPA.

The repository historically tracks `.env`; this audit preserves its existing local changes. `.gitignore` does not untrack it. CI explicitly supplies public values, so removing `.env` from the Git index in a reviewed follow-up is possible after contributors adopt `.env.example`. Avoid staging `.env` in this deployment commit. Use `.env.local` for personal overrides.

```sh
npm run lint
npm test
npx tsc --noEmit
npm run build
npm run check:static
npx firebase emulators:exec --only hosting --project demo-building-import-hub 'node scripts/test-hosting.mjs'
```

The emulator check verifies HTTP fallback and assets. With Chrome installed, run the same emulator command with `node scripts/test-browser.mjs` to check sign-in rendering and signed-out route redirects. Neither check exercises a real login. `npm run preview` runs the framework preview; use the Hosting emulator above to verify the exact Firebase rules. Lint currently has existing React Fast Refresh warnings. npm 12 environments that restrict remote tarballs may require explicitly permitting the pinned `cdn.sheetjs.com` package for installation. CI uses the npm version bundled with Node 24.

## Spreadsheet contract

The template columns remain `name`, `address`, `city`, `country`, `floors`, `year_built`, including the example building. Supported formats: `.xlsx`, `.xls`, `.csv`. Only the first worksheet is imported. Headers are trimmed, lowercased, and spaces become underscores. The `name` header is required. Unnamed data rows are skipped; completely empty rows are ignored. Duplicate imports insert duplicates, as before. Finite numeric values are truncated to integers; blank or nonnumeric values become null.

Limits: **10 MiB** decoded file, **1,000 data rows**, 64 columns, 2,000 characters per text cell, PostgreSQL integer bounds. Oversized input is rejected before insertion; the request stream is bounded before JSON parsing and worksheet rows are bounded during parsing. Worksheet ranges with more than 1,000 data row positions are rejected, including oversized formatted ranges. Compressed spreadsheets still consume parser memory; limits do not guarantee resistance to every malicious archive. Formulas/macros/external links are not executed. A single database insert is atomic and success returns `{ inserted, skipped }`; retries after a network timeout can duplicate rows because no idempotency key is implemented.

The browser and Deno function use official SheetJS 0.20.3 (the npm registry `xlsx@0.18.5` is outdated). Keep the npm tarball and Deno import-map version aligned.

## Supabase operations (manual, only after review)

Target project: `etwvrqdhzocgtjrzqhxn`. Source and deployment config are under `supabase/`. Commands below change remote state; they were **not run** during the audit.

```sh
npx supabase login
npx supabase link --project-ref etwvrqdhzocgtjrzqhxn
# Inspect remote migration history first; the table may already exist:
npx supabase migration list
npx supabase db push --dry-run
# Apply only after checking the remote schema and migration history:
npx supabase db push
npx supabase functions deploy import-buildings --project-ref etwvrqdhzocgtjrzqhxn
```

The function uses runtime-provided `SUPABASE_URL` and `SUPABASE_PUBLISHABLE_KEYS.default`, falling back to `SUPABASE_PUBLISHABLE_KEY` or `SUPABASE_ANON_KEY`. It never uses a service-role key. `verify_jwt = false` intentionally delegates user verification to the handler's online `getUser(token)` call before parsing or writing; do not remove that check. CORS permits bearer-authenticated calls from Firebase previews and Lovable origins without cookie credentials.

For local Edge Function development (requires Docker): `npx supabase start`, then `npx supabase functions serve import-buildings`. To type-check with Deno 2: `deno check --allow-import=cdn.sheetjs.com,registry.npmjs.org --config supabase/functions/import-buildings/deno.json supabase/functions/import-buildings/index.ts`.

Before production approval, test two real accounts against the deployed database: cross-user SELECT/UPDATE/DELETE must affect no rows; INSERT or ownership-changing UPDATE with another user's ID must fail. Verify policies and RLS are actually enabled remotely. Test expired/missing JWT rejection, a real template upload, counts, and refresh/session persistence. Unit tests mock Auth/database and cannot establish deployed isolation.

## Firebase deployment and GitHub Actions

`.firebaserc` selects `building-import-hub-rcg`. Live site: https://building-import-hub-rcg.web.app/.

After review and explicit deployment approval:

```sh
npm ci
npm run build
npm run check:static
npx firebase deploy --only hosting --project building-import-hub-rcg
```

Both workflows use `npm ci`, Node 24, lint/tests, build, and static-output verification, then `FirebaseExtended/action-hosting-deploy` reads `firebase.json` and deploys `.output/public`.

Configure these GitHub **Actions repository variables** manually:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_PUBLISHABLE_KEY` (public key only)

Configure Actions **secret** `FIREBASE_SERVICE_ACCOUNT_BUILDING_IMPORT_HUB_RCG` with the appropriate Firebase service-account JSON. Its existence, project, and IAM access require manual verification. Do not add database or Supabase privileged keys to these workflows.

Same-repository PRs get expiring preview deployments; fork PR deployments are intentionally skipped to avoid exposing credentials. `push` to `main` deploys the live channel. PR permissions allow checks/comments and read-only source access; production requires only source read access. Check Supabase Auth site/redirect URLs for the live domain, localhost, and intended preview domains, especially signup confirmation redirects.

Generated output, deployment caches, local overrides, and locally installed `.agents/` skills/`skills-lock.json` are ignored. Keep `package-lock.json` as the npm/CI lockfile. The existing `bun.lock` is also synchronized for Lovable compatibility; use npm for local checks and CI, and keep both lockfiles aligned when dependencies change. Do not rewrite published Git history.

See [the production-readiness audit](docs/production-readiness-audit.md) for validation results and remaining steps.
