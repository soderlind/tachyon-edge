---
Status: accepted
Supersedes: ADR 0001
---
# The compatibility target is the Tachyon WordPress plugin

"100% compatible" means that a WordPress site using the [Tachyon plugin](https://github.com/humanmade/tachyon-plugin) (0.11.1, commit `652ecd2`) works unchanged when `TACHYON_URL` points at Tachyon Edge. It does not mean byte-identical output from the Tachyon server.

The Plugin Contract covers:

- **URLs:** `TACHYON_URL` followed by the upload-relative path, including multisite `sites/N/` paths, a `urlencode`d basename, and the `/tachyon/` path segment.
- **Arguments:** the query arguments emitted by the plugin (`w`, `h`, `fit`, `resize`, and `gravity`) and the documented arguments that filters can add (`quality`, `crop`, `crop_strategy`, `zoom`, `webp`, `lb`, and `background`).
- **Duplicate parameters:** repeated query parameters are joined with commas, matching Lambda Function URLs.
- **Private-image signatures:** both forms of signed URL are accepted, either a `presign` parameter or raw `X-Amz-*` parameters.
- **WebP selection:** the `X-WebP` request header selects WebP output.
- **Response metadata:** the status codes, `Content-Type`, and `Cache-Control: max-age` behavior used by sites and CDNs, including the `File not found.` 404 and a `max-age` limited to when the signature expires.

Image geometry follows the Tachyon v3.0.8 Sharp pipeline (commit `6308671`), which is used as the test oracle. For the same Original, Tachyon Edge produces the same output width, height, crop region, gravity, letterbox and output format. Release Quirks that affect geometry are retained, for example a `px` suffix in `fit`, `resize`, or `lb` dropping that dimension. Pixels, encoder settings, file size, and metadata may differ.

## Deviations

These differences from Tachyon v3.0.8 are accepted. None of them changes a URL the plugin emits or an image size WordPress relies on.

- **Animated crops and smart strategies:** Tachyon fails on percentage `crop` for animations, because it uses the stacked height of all frames. It also fails on `crop_strategy=entropy|attention` ("Resize strategy is not supported for multi-page images"). Tachyon Edge plans these per frame and returns an image.
- **Non-integer zoomed sizes:** Tachyon throws when `zoom` produces a fractional `w` or `h`. Tachyon Edge rounds.
- **AVIF `Content-Type`:** Tachyon reports AVIF output as `image/heif`. Tachyon Edge sends `image/avif`.
- **Large Originals:** Originals over the Images binding's 20 MB input limit are served unmodified with the `Content-Type` of their extension (ADR 0007).
- **Large animations:** animations whose frames total 100 megapixels or more are served unmodified, because the binding rejects them with error 9413. Tachyon resized them (ADR 0007).
- **Metadata:** Tachyon calls Sharp's `withMetadata()`, so its Variants keep EXIF and ICC metadata. Variants from the Images binding keep at most the copyright field (ADR 0007). The plugin reads no Variant metadata, but EXIF such as camera details and GPS is no longer republished, and colours from wide-gamut Originals may render differently.
- **PNG encoding:** Tachyon encodes PNG Variants as palette PNGs. The Images binding writes truecolor PNGs, so PNG Variants are larger. Their dimensions and transparency are unchanged.
- **Unsupported Originals:** anything that is not GIF, JPEG, PNG, WebP or AVIF returns a sanitized 500, as Tachyon did for undecodable input.

## Consequences

The project can use a native Cloudflare image engine instead of a byte-identical Sharp build (ADR 0007). Tests assert the Plugin Contract and geometry rather than golden image bytes.
