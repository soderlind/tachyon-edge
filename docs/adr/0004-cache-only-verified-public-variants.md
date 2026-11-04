---
Status: superseded by ADR 0010
---
# Cache only verified unsigned GET Variants

The Worker Cache API stores only successful unsigned S3-origin GET responses with a positive response `max-age`; R2 requests, signed requests, errors and other methods bypass shared caching. Cache keys include the full request URL/query, S3 origin identity, `Referer`, effective `X-WebP` selection and Processing Version, and `Last-Modified` is refreshed on each hit; the Cache API is local and ephemeral per Cloudflare data center.

An unsigned S3 Variant may remain cached until its `max-age` expires even if the Original or Origin access policy changes. Reference Tachyon sets that `max-age` to one year for unsigned responses, though the edge cache may evict entries sooner. This is a deliberate caching trade-off, not proof of immediate equivalence to an uncached Reference Tachyon request.
