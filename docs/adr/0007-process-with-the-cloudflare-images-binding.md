---
Status: accepted
Supersedes: ADR 0002
---
# Process with the Cloudflare Images binding

Tachyon Edge is a single Worker. The Images binding (`env.IMAGES`) is its only image engine. Tachyon Edge does not use Containers, Durable Objects, Sharp, or libvips in production. This removes the libvips advisory that blocked the Container build and the single-instance scaling limit. The Images binding also bills each unique transformation once per month.

## Explicit geometry, not Cloudflare `fit` heuristics

Cloudflare's `fit` modes do not match Sharp's `withoutEnlargement` behavior in every edge case. The Worker therefore computes the output geometry exactly as Tachyon would and sends the binding explicit operations:

- `crop` maps to `trim` in pixels.
- Proportional resizes (`w`, `h`, `fit`, and `lb` inner box) map to `squeeze` with exact dimensions.
- Cover crops (`resize`) map to `cover` at the final size, so they are never enlarged, with Tachyon's compass `gravity` translated to `{x, y}`.
- `crop_strategy` maps to `gravity: "auto"`.
- The `lb` letterbox maps to a `border` in the `background` color, defaulting to black.

The Worker reads Original dimensions and the EXIF orientation from the image header. It uses `IMAGES.info()` only for formats it cannot parse.

The output format follows the Original, unless `webp` or `X-WebP` selects WebP. JPEG and WebP use Tachyon's quality: 82 by default, reduced logarithmically by `zoom`. The binding ignores `quality` for PNG and always encodes truecolor PNG, while Tachyon produced palette PNGs, so the Worker sends no PNG quality. This is a deviation listed in ADR 0006. `anim: true` is sent only for GIF and WebP output, because the binding rejects it for other formats with error 9401. The binding applies JPEG EXIF orientation before the planned operations, so the planner works in display coordinates. It ignores orientation stored in PNG `eXIf` and WebP `EXIF` chunks, which Tachyon's `rotate()` honours. For those Originals the Worker reads the orientation from the chunk and sends explicit `rotate` and `flip` operations before the plan. The binding has no metadata option, so Variants keep at most the copyright EXIF field. Tachyon kept metadata (`withMetadata()`), so this is a deviation listed in ADR 0006.

## Limits accepted

Platform limits replace Sharp's limits:

- Originals passed to the binding may be up to 20 MB. Larger Originals are served unmodified, without being resized, rather than failing (ADR 0006).
- Cloudflare documents AVIF Originals as Enterprise-only. The binding decoded them on a non-Enterprise account in November 2026 (remote smoke test). Accounts where it does not can set `TACHYON_SMOKE_SKIP_AVIF=1`, and AVIF Originals then return a 500.
- Cloudflare documents that animations over 50 megapixels (total area of all frames) are returned untransformed. The binding instead transforms them up to 100 megapixels and fails with error 9413 at or above it. The Worker serves those Originals unmodified (ADR 0006), and the remote smoke test checks both sides of the limit.
- AVIF output is limited to 1,200 px on each side.

`wrangler dev` provides only a low-fidelity offline Images implementation. Local tests use a Sharp-backed fake binding (ADR 0011).
