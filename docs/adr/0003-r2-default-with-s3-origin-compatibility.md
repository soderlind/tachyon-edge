---
Status: superseded by ADR 0008 and 0009
---
# R2 default with configurable S3 origins

New deployments use a private R2 bucket by default while retaining configurable AWS/S3-compatible origins for existing stores. R2 requires a presigned GET for every image; unsigned requests are denied before cache lookup, and the Origin validates every signature. R2 API credentials are used by a separate signing service. They are not required by the Worker or passed to the Container.

An AWS S3 signature is not assumed to remain valid after moving the object to R2. R2 requests require signatures generated for the configured R2 endpoint and addressing style. Legacy S3 origins retain the reference's unsigned and presigned request behavior.
