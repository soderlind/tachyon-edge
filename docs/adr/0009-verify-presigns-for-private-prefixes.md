---
Status: accepted
Supersedes: ADR 0003 (signed-only part)
---
# Verify presigns in the Worker for private prefixes

ADR 0003 made every R2 read require a signature. That broke the plugin, because the plugin requests public attachments without signatures. Public Originals are now served unsigned.

R2 has no per-object ACLs, so S3 Uploads' private ACL cannot be enforced by the Origin. Instead, every Object Key under a configured private prefix (`TACHYON_PRIVATE_PREFIXES`, comma-separated) requires a valid AWS Signature Version 4 query presign. The Worker verifies it with the same S3 access key that WordPress uses to sign:

- **Credentials:** `TACHYON_SIGNING_ACCESS_KEY_ID` is a variable and `TACHYON_SIGNING_SECRET_ACCESS_KEY` is a secret.
- **Canonical request:** it is rebuilt from the signing endpoint host and addressing style (`TACHYON_SIGNING_HOST` and `TACHYON_SIGNING_PATH_PREFIX`), the Object Key, and the `X-Amz-*` parameters. They may come from `presign` or arrive as raw query parameters.
- **Validity window:** the signature must be unexpired and dated no more than 15 minutes in the future. The comparison is constant-time.
- **Session-token presigns:** signatures that include `X-Amz-Security-Token` are rejected, because temporary credentials cannot be verified offline.

Any failure returns the same `404 File not found.` that Tachyon returns for an S3 `AccessDenied`.

A request outside a private prefix that carries a signature is verified when signing credentials are configured, so a tampered URL fails as it would on S3. When signing credentials are not configured, only the signature's expiry is enforced, as S3 would reject an expired URL. If private prefixes are configured without credentials, the Worker fails closed: every private request returns 404 and a configuration error is logged.
