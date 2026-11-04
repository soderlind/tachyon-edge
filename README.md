# Tachyon Edge

Tachyon Edge is an image service for the [Tachyon WordPress plugin](https://github.com/humanmade/tachyon-plugin). It runs as a single Cloudflare Worker, processes images with the [Cloudflare Images binding](https://developers.cloudflare.com/images/transform-images/bindings/), and reads Originals from R2 or over HTTP.

It is a drop-in replacement for [Human Made Tachyon](https://github.com/humanmade/tachyon) v3.0.8 as far as the plugin is concerned. URLs, arguments, output sizes, crops, formats, status codes and cache headers follow the Plugin Contract ([ADR 0006](docs/adr/0006-compatibility-target-is-the-wordpress-plugin.md)). Pixels and file sizes differ, because the encoder is Cloudflare's rather than Sharp's.

## Architecture

<a href="docs/diagrams/out/overview-light.png"><picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/diagrams/out/overview-dark.svg">
  <img alt="Tachyon Edge architecture: the Tachyon plugin writes URLs, the browser requests them from worker.ts, which uses contract.ts, sigv4.ts, probe.ts, geometry.ts and origin.ts, and the Cache API, R2 bucket, Images binding and optional HTTP Origin." src="docs/diagrams/out/overview-light.svg">
</picture></a>

A public request that misses the cache:

<a href="docs/diagrams/out/public-miss-view-light.png"><picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/diagrams/out/public-miss-view-dark.svg">
  <img alt="Sequence for an unsigned public request: parse the URL, cache miss, fetch the Original from R2, probe the header, plan the geometry, transform with the Images binding, respond, then store the Variant in the cache." src="docs/diagrams/out/public-miss-view-light.svg">
</picture></a>

The private, presigned flow and the diagram sources are in [docs/diagrams](docs/diagrams).

The Worker does not rely on Cloudflare's `fit` heuristics. `geometry.ts` reproduces the arithmetic of Tachyon's Sharp pipeline, including `withoutEnlargement` rounding, JPEG shrink-on-load, EXIF rotation, `zoom` and the `px` Release Quirks. It then sends the binding explicit pixel operations ([ADR 0007](docs/adr/0007-process-with-the-cloudflare-images-binding.md)). A test oracle runs Tachyon v3.0.8's own code to check that the dimensions match ([ADR 0011](docs/adr/0011-geometry-oracle-and-remote-smoke-tests.md)).

Components, request flow, invariants and where to make changes are described in [docs/architecture.md](docs/architecture.md). Decisions are recorded in [docs/adr](docs/adr). The project language is in [GLOSSARY.md](GLOSSARY.md).

## Deploy

You need a Cloudflare account with Images enabled; the binding is billed per unique transformation. You also need Node 24.

```sh
npm ci
npx wrangler login
npx wrangler r2 bucket create tachyon-uploads   # or change bucket_name in wrangler.jsonc
npx wrangler deploy
```

Then copy your uploads into the bucket so that the Object Keys match the path after the Worker host. For example, `uploads/2026/11/photo.jpg` is served at `https://<worker>/uploads/2026/11/photo.jpg`. [rclone](https://developers.cloudflare.com/r2/examples/rclone/) and R2 [Super Slurper](https://developers.cloudflare.com/r2/data-migration/super-slurper/) can copy an existing S3 bucket.

### Configuration

Set these variables in [wrangler.jsonc](wrangler.jsonc):

| Variable | Purpose |
|---|---|
| `TACHYON_ORIGIN` | `r2` (default) reads from the `BUCKET` binding. `http` fetches from `TACHYON_HTTP_ORIGIN`. |
| `TACHYON_HTTP_ORIGIN` | Base URL for the HTTP Origin, e.g. `https://example.com/wp-content/`. Upstream 403 and 404 become 404; other failures become 502. |
| `TACHYON_R2_BUCKET` | Name of the bucket bound as `BUCKET`. It separates cached Variants per bucket. `wrangler deploy` fails if it differs from `bucket_name`, and the Worker skips its cache if it is empty. |
| `TACHYON_KEY_PREFIX` | Prepended to every Object Key before the Origin lookup. |
| `TACHYON_PRIVATE_PREFIXES` | Comma-separated storage key prefixes (`TACHYON_KEY_PREFIX` + Object Key) that require a valid presign, e.g. `uploads/private/`. |
| `TACHYON_SIGNING_ACCESS_KEY_ID` | The access key ID WordPress signs private URLs with. |
| `TACHYON_SIGNING_HOST` | Host in the presigned URL, e.g. `<account>.r2.cloudflarestorage.com` or `bucket.s3.eu-west-1.amazonaws.com`. |
| `TACHYON_SIGNING_PATH_PREFIX` | Path before the key in the presigned URL, e.g. `/bucket` for path-style URLs. Leave it empty for virtual-hosted URLs. |

The matching secret is set with `npx wrangler secret put TACHYON_SIGNING_SECRET_ACCESS_KEY`. For local development, copy [.dev.vars.example](.dev.vars.example) to `.dev.vars`.

Private prefixes fail closed. If signing credentials are missing, every private request returns 404 and the Worker logs a configuration error ([ADR 0009](docs/adr/0009-verify-presigns-for-private-prefixes.md)).

### WordPress

Install the [Tachyon plugin](https://github.com/humanmade/tachyon-plugin) and point it at the Worker:

```php
define( 'TACHYON_URL', 'https://tachyon-edge.<subdomain>.workers.dev/uploads' );
define( 'TACHYON_SERVER_VERSION', '3.0.0' ); // presigned private images use `presign=`
```

To serve WebP to browsers that accept it, add a Transform Rule or another Worker in front that sets `X-WebP: 1` when `Accept` contains `image/webp`. The Worker caches WebP and non-WebP Variants separately.

## Differences from Tachyon v3.0.8

These are listed in [ADR 0006](docs/adr/0006-compatibility-target-is-the-wordpress-plugin.md):

- **Images:** Variants have the same dimensions, but the pixels and file sizes are not byte-identical. EXIF and ICC metadata are stripped, except copyright. PNGs are truecolor rather than palette, so they are larger.
- **Animation:** percentage crops and `entropy`/`attention` on animated images return an image instead of Tachyon's error.
- **`zoom`:** a fractional zoomed size is rounded instead of causing an error.
- **AVIF:** output is labelled `image/avif`, not `image/heif`, and is capped at 1,200 px. Cloudflare documents AVIF Originals as Enterprise-only, but they worked on a non-Enterprise account in testing ([ADR 0007](docs/adr/0007-process-with-the-cloudflare-images-binding.md)).
- **Size limits:** Originals over 20 MB, and animations whose frames total 100 megapixels or more, are served unmodified.

## Development

```sh
npm test              # geometry oracle, plugin contract, SigV4 and Worker tests
npm run lint
npm run check:worker  # type-check against @cloudflare/workers-types
npx wrangler deploy --dry-run
```

Sharp is a dev dependency only. It runs the Tachyon v3.0.8 oracle ([tests/oracle](tests/oracle)) and backs the fake Images binding ([tests/helpers/fake-images.ts](tests/helpers/fake-images.ts)). The `wrangler dev` Images simulation is low-fidelity. Before production traffic, run the remote smoke test against a deployed Worker ([ADR 0011](docs/adr/0011-geometry-oracle-and-remote-smoke-tests.md)). Deploy with `TACHYON_PRIVATE_PREFIXES=uploads/private/` and no signing credentials, then:

```sh
node tests/remote/prepare.mjs /tmp/tachyon-smoke tachyon-uploads
TACHYON_SMOKE_URL=https://<worker>/uploads/ TACHYON_SMOKE_FIXTURES=/tmp/tachyon-smoke npm run test:remote
```

## API reference

See [docs/using.md](docs/using.md).
