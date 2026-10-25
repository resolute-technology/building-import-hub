<!-- LOVABLE:BEGIN -->

> [!IMPORTANT]
> This project is connected to [Lovable](https://lovable.dev). Avoid rewriting
> published git history — force pushing, or rebasing/amending/squashing commits
> that are already pushed — as it rewrites history on Lovable's side and the
> user will likely lose their project history.
>
> Commits you push to the connected branch sync back to Lovable and show up in
> the editor, so keep the branch in a working state.

<!-- LOVABLE:END -->

- SSR is disabled app-wide via `defaultSsr: false` in src/start.ts; the app is client-rendered only.
- Excel imports are processed by the Supabase Edge Function
  `supabase/functions/import-buildings/index.ts`.
- The React frontend invokes the function using
  `supabase.functions.invoke("import-buildings")`.
- The frontend is configured as a static SPA for Firebase Hosting.
- Authentication and database access use Supabase.
- Row Level Security (RLS) enforces per-user data isolation.
- SQL migrations are mirrored in supabase/migrations for reference.
- Keep `tanstackStart.spa.enabled` in `vite.config.ts`; the Lovable wrapper owns the plugins. Do not add duplicate React, TanStack, Tailwind, or Nitro plugins.
- Nitro/server output is a build artifact; Firebase deploys only `.output/public`, with `**` rewritten to `/_shell.html`. Do not add a Firebase welcome `public/index.html`.
- No app feature requires a TanStack server function. Do not introduce `createServerFn` for imports.
- The Edge Function verifies bearer JWTs with `auth.getUser()` before parsing or inserting. `verify_jwt = false` does not mean anonymous imports are permitted.
- Inserts must use a public API key and the caller JWT to preserve RLS; never use a service-role client for user imports.
- Build-time browser configuration requires `VITE_SUPABASE_URL` and `VITE_SUPABASE_PUBLISHABLE_KEY`. Never inject privileged credentials into `VITE_*` variables.
- Use Node 24 and `npm ci`; run lint, tests, build, and `npm run check:static`. Use the Firebase Hosting emulator to check direct paths. Deployment commands and environment details are documented in README.md.
- The historically tracked `.env` contains local changes; do not stage it without explicit review. Local overrides and installed agent skills are ignored. Keep npm's package-lock.json for CI and synchronize the retained bun.lock for Lovable when dependencies change.
- Remote deploys, schema changes, commits, pushes, and merges require explicit user approval for this audit.
