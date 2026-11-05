# Diagrams

[PR Lens](https://www.npmjs.com/package/@coldtea/pr-lens-renderer) diagrams of the current architecture, rendered from [graph.json](graph.json). The SVGs in [out/](out/) are canonical; the PNGs are static copies.

| View | Shows |
|---|---|
| `overview` | Components, Cloudflare bindings and Origins |
| `public-miss-view` | An unsigned public request that misses the cache and reads from R2 |
| `private-presign-view` | A presigned request for a private prefix; never cached by the Worker |

## Regenerate

```sh
cd docs/diagrams
npm ci
rm -rf out && npm run render
for f in out/*.svg; do rsvg-convert -o "${f%.svg}.png" "$f"; done
```

`render.mjs` validates the graph and refuses to overwrite existing SVGs, so remove `out/` first. Update `provenance` in `graph.json` to the commit the diagrams describe.

`npm run render` also runs [colorize.mjs](colorize.mjs), which colors each lane, because PR Lens only colors by change. It maps cards to lanes by node label, and lane boxes, lifelines and badges by position. WordPress is blue, the Worker orange, Cloudflare bindings amber and the HTTP Origin rose, matching the [Tachyon R2 diagrams](https://github.com/soderlind/tachyon-r2/tree/main/docs/diagrams). Change colors in `LANE_COLORS`.

## Source map

| Element | Evidence |
|---|---|
| Lanes, nodes and dependency edges | [architecture.md](../architecture.md) "Major components" and "Cloudflare resources"; `src/worker.ts`, `src/contract.ts`, `src/sigv4.ts`, `src/origin.ts`, `src/probe.ts`, `src/geometry.ts`; [wrangler.jsonc](../../wrangler.jsonc) |
| Plugin → browser → Worker, `X-WebP` set in front | [ADR 0006](../adr/0006-compatibility-target-is-the-wordpress-plugin.md); README "WordPress" |
| `geometry.ts` "oracle-tested" badge | [ADR 0011](../adr/0011-geometry-oracle-and-remote-smoke-tests.md); `tests/test-geometry-oracle.ts` |
| R2 or HTTP Origin | [ADR 0008](../adr/0008-r2-binding-and-http-origins.md); `fetchOriginal` |
| Cache match/put, `waitUntil`, `max-age=31536000` | [ADR 0010](../adr/0010-cache-api-for-unsigned-variants.md); architecture.md flow steps 3, 4 and 10 |
| Public flow order, 20 MB and 9413 passthrough notes | architecture.md flow steps 1–10 |
| Private flow, 404 on failed verification, remaining-validity `max-age` | [ADR 0009](../adr/0009-verify-presigns-for-private-prefixes.md); architecture.md flow step 3 and "Failure behavior" |
