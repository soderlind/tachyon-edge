# Contributing

Tachyon Edge is a TypeScript Cloudflare Worker. Its entry point is `src/worker.ts`, and the configuration is in `wrangler.jsonc`.

```sh
npm ci
npm test              # Jest: geometry oracle, plugin contract, SigV4, Worker end-to-end
npm run lint
npm run check:worker  # type-check against the Workers runtime types
npx wrangler dev      # local Worker; Images binding is low-fidelity offline
```

## Tests

Tests are files matching `tests/**/test-*.ts`. They run with `ts-jest`, so no build step is needed.

- `tests/oracle/tachyon-v3.0.8.ts` is Tachyon v3.0.8's Sharp pipeline, copied verbatim. Do not change it. Any change to `src/geometry.ts` must keep `tests/test-geometry-oracle.ts` passing.
- `tests/helpers/fake-images.ts` is a Sharp-backed stand-in for the Images binding. If you rely on new binding behavior, model it there and add it to the remote smoke checklist in ADR 0011.

Record significant decisions as a new ADR in `docs/adr`, and use the language in `GLOSSARY.md`.
