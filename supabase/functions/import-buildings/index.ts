import { createImportHandler } from "./handler.ts";

Deno.serve(createImportHandler((name) => Deno.env.get(name)));
