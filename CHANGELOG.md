# Changelog

All notable changes to this project are documented here. The format follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project uses [Semantic Versioning](https://semver.org/).

## [0.1.0] - 2026-11-04

First release of Tachyon Edge: a rewrite of [Human Made Tachyon](https://github.com/humanmade/tachyon) v3.0.8 as a single Cloudflare Worker. It is compatible with the [Tachyon WordPress plugin](https://github.com/humanmade/tachyon-plugin) 0.11.1 (ADR 0006).

### Added

- A Cloudflare Worker (`src/worker.ts`) that processes images with the Cloudflare Images binding. It does not use Sharp, libvips, Containers or Lambda in production (ADR 0007).
- A geometry planner (`src/geometry.ts`) that reproduces Tachyon's Sharp output sizes. It covers `withoutEnlargement` rounding, JPEG shrink-on-load, EXIF orientation (JPEG, PNG `eXIf` and WebP `EXIF`; explicit `rotate`/`flip` for PNG and WebP, which the binding does not auto-orient), `zoom` and the `px` Release Quirks, and sends the binding explicit `trim`, `squeeze`, `cover` and `border` operations.
- Parsing of the plugin URL contract (`src/contract.ts`): `w`, `h`, `fit`, `resize`, `gravity`, `crop`, `crop_strategy`, `quality`, `zoom`, `webp`, `lb` and `background`. Repeated parameters are joined with commas. The `X-WebP` header is supported.
- Two Origins (ADR 0008):
  - the R2 binding (`BUCKET`);
  - an HTTP base URL (`TACHYON_HTTP_ORIGIN`), with protection against dot segments.
- `TACHYON_KEY_PREFIX` for buckets that store uploads under a prefix, and `TACHYON_R2_BUCKET` to name the bound bucket in the cache key.
- Private prefixes (`TACHYON_PRIVATE_PREFIXES`, matched against the storage key including `TACHYON_KEY_PREFIX`) that require an AWS SigV4 presign verified in the Worker. Both the `presign=` and the raw `X-Amz-*` forms are accepted, and private requests fail closed when signing credentials are missing (ADR 0009).
- Cache API storage for unsigned public Variants. The cache key includes the WebP choice, the Origin identity (including the R2 bucket) and `PROCESSING_VERSION` (ADR 0010).
- Originals without `Content-Length` are buffered only up to the 20 MB binding limit; larger ones stream through unmodified.
- Tests (788 in total, run by `npm test`):
  - a geometry oracle that runs Tachyon v3.0.8's own Sharp pipeline (690 cases, including JPEG, PNG and WebP EXIF rotation, animation and a seeded random-size sweep);
  - plugin contract and SigV4 tests;
  - Worker end-to-end tests against a Sharp-backed fake Images binding.
- A remote smoke suite against a deployed Worker (`npm run test:remote`, fixtures from `tests/remote/prepare.mjs`). The current deployment passes all 132 checks, including AVIF and every PNG/WebP EXIF orientation; `TACHYON_SMOKE_SKIP_AVIF=1` skips AVIF on accounts without support (ADR 0011).
- ADRs 0006–0011, `GLOSSARY.md` and `.dev.vars.example`.

### Changed

- Compatibility is now measured against the WordPress plugin's contract rather than byte-identical server output. Dimensions, crop, format, status codes and headers match; pixels and file sizes may differ (ADR 0006).
- `npm run build` now type-checks the Worker. CI runs the tests, lint, `check:worker` and `wrangler deploy --dry-run`.
- Sharp, smartcrop-sharp and the AWS SDK are dev dependencies only.
- Rewrote the README and the files in `docs/` for Cloudflare deployment.

### Removed

- The AWS Lambda handler, SAM template, local Node server, Docker image and the Container-based design from earlier ADRs 0001–0005, which are now superseded.
- Direct AWS S3 Origins. Copy uploads to R2 or use the HTTP Origin instead.
- Forwarding of `Referer` to the Origin.

### Known differences from Tachyon v3.0.8

See ADR 0006 for the full list.

- EXIF and ICC metadata are stripped, except copyright.
- PNG Variants are truecolor rather than palette, so they are larger.
- AVIF is served as `image/avif` instead of `image/heif`. AVIF Originals require an Enterprise plan, and AVIF output is limited to 1,200 px.
- Originals over 20 MB are served unmodified.
- Percentage crops and `entropy`/`attention` on animated images return an image instead of an error.
- Fractional zoomed sizes are rounded instead of raising an error.

[0.1.0]: https://github.com/soderlind/tachyon-edge/releases/tag/0.1.0
