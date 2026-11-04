# Hints and Tips

## Placement

Workers run in every Cloudflare data center, so there is no region to choose. With the R2 Origin, set a [location hint](https://developers.cloudflare.com/r2/reference/data-location/) on the bucket close to your editors. With the HTTP Origin, consider [Smart Placement](https://developers.cloudflare.com/workers/configuration/smart-placement/) if the upload server is far from most visitors.

## Caching

Variants are cached per data center with the Cache API. Put the Worker on a custom domain behind Cloudflare so that `Cache-Control: max-age=31536000` is also honoured by browsers and any downstream CDN. Bump `PROCESSING_VERSION` in `src/worker.ts` when a change alters output for existing URLs.
