---
Status: accepted
Supersedes: ADR 0004
---
# Use the Cache API for unsigned Variants

Successful unsigned GET Variants are stored with the Workers Cache API (`caches.default`). Responses keep Tachyon's `Cache-Control: max-age=31536000` for downstream CDNs and browsers.

The cache key contains:

- the full request URL;
- the effective WebP selection, from `webp` or `X-WebP`;
- the Origin identity: the Origin type, `TACHYON_R2_BUCKET` or `TACHYON_HTTP_ORIGIN`, and `TACHYON_KEY_PREFIX`; and
- the Processing Version.

Signed requests, requests whose storage key is under a private prefix, errors, and non-GET requests bypass the cache. Cache hits receive a fresh `Last-Modified`, as Tachyon generates one for each response.

The R2 binding cannot report which bucket it is bound to, so `TACHYON_R2_BUCKET` must name it. Two safeguards keep the cache from mixing Variants from different buckets:

- With the R2 Origin and no `TACHYON_R2_BUCKET`, the Worker skips the cache and logs a configuration error.
- `scripts/check-config.mjs` runs as the Wrangler build command, before every `wrangler deploy` and `wrangler dev`, and in `npm test`. It fails when `TACHYON_R2_BUCKET` differs from the `bucket_name` bound as `BUCKET` in `wrangler.jsonc`, at the top level or in any environment. It cannot see a `--config` file other than `wrangler.jsonc` or `--var` overrides.

Workers Cache (`"cache": {"enabled": true}`) was rejected. It keys only on the path and query, so a WebP Variant generated for an `X-WebP` request would be served to clients that did not request WebP. That would break the Plugin Contract.

The Cache API is per data center and does not collapse concurrent misses. Repeated transformations are cheap because the Images binding bills each unique transformation once per month.
