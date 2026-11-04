---
Status: accepted
Supersedes: ADR 0003 (origin part)
---
# R2 binding and HTTP origins

Originals are read from one of two Origins, selected by `TACHYON_ORIGIN`:

- **`r2` (default):** an R2 bucket bound as `BUCKET`. The Worker needs no credentials. A missing object returns Tachyon's `404 File not found.`
- **`http`:** a base URL (`TACHYON_HTTP_ORIGIN`), such as `https://example.com/wp-content`. Use it for sites that keep uploads on the web server. Upstream 403 and 404 responses become Tachyon's 404. Other upstream failures become a sanitized 502.

The Object Key is derived exactly as Tachyon does it: the URL path is percent-decoded, the leading slash is removed, and the first `/tachyon/` is replaced with `/`. An optional `TACHYON_KEY_PREFIX` is prepended when uploads are stored below a prefix in the bucket. The result is the storage key.

The R2 binding cannot report which bucket it is bound to, so `TACHYON_R2_BUCKET` names it. It is part of the Origin identity in the cache key (ADR 0010) and must match `bucket_name` in `wrangler.jsonc`.

Direct AWS S3 Origins are dropped. Existing S3 buckets can be copied to R2 or served through the HTTP Origin. The Worker no longer forwards `Referer` to the Origin, because R2 bindings do not evaluate bucket policies.
