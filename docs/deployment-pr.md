Firebase's generated welcome page could override the SPA at `/`, and CI did not supply Supabase build configuration. Serve the TanStack SPA shell from classic Firebase Hosting and send authenticated spreadsheet imports to Supabase Edge Functions, with bounded parsing, caller-scoped inserts, and user-specific query caches.

Includes patched SheetJS/Vite/Zod dependencies, explicit Node 24 CI setup and public build variables, static-output validation, environment documentation, and removal of unused server-auth helpers. No remote changes were performed.

Validation: clean npm installation under Node 24, lint (six existing warnings), 25 tests, TypeScript, production build, Deno type-check, static asset checks, and Firebase emulator/Chrome signed-out route checks passed. npm audit still reports nine moderate tooling advisories. Real authenticated imports, session persistence, two-user RLS isolation, and GitHub variables/service-account permissions require verification before release. See docs/production-readiness-audit.md.

Merging to main triggers production deployment; review the remaining release checks first.
