---
Status: superseded by ADR 0006
---
# Pin Reference Tachyon to v3.0.8

The Compatibility Contract is measured against Tachyon v3.0.8 at commit `6308671ef62998bbdfec29991b6ebdead57d3944`; the observed release behavior wins over documentation when they disagree. “Exact” means identical image body bytes, HTTP status, application-controlled headers and ordinary application errors, excluding transport/platform metadata and timing, and no compatibility claim is made before differential tests pass.
