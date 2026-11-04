# Tachyon Edge

Tachyon Edge is an image service for the Tachyon WordPress plugin. It runs on Cloudflare Workers and the Images binding.

## Language

**Plugin Contract**:
The URLs, arguments, output geometry and format, status codes and headers that the Tachyon WordPress plugin and the sites using it depend on. This is what "compatible" means (ADR 0006).
_Avoid_: parity, byte-compatibility

**Reference Tachyon**:
Human Made Tachyon v3.0.8. Its Sharp pipeline is the oracle for output geometry.
_Avoid_: original, upstream

**Release Quirk**:
A behavior of Reference Tachyon that differs from its documentation and is kept for compatibility, for example a `px` suffix in `resize` dropping that dimension.
_Avoid_: bug, defect

**Deviation**:
A documented, accepted difference from Reference Tachyon that does not break the Plugin Contract (ADR 0006).

**Original**:
The unmodified image stored in an Origin.
_Avoid_: source file, master

**Origin**:
Where Originals are read from: the R2 binding or an HTTP base URL (ADR 0008).
_Avoid_: backend

**Object Key**:
The Origin path of an Original. It is derived from the request path as Tachyon derives it, with `TACHYON_KEY_PREFIX` prepended.

**Variant**:
An image produced from an Original for a particular request.
_Avoid_: thumbnail, rendition

**Plan**:
The output size, format, quality and ordered Images binding operations that `geometry.ts` computes for a Variant.

**Processing Version**:
An identifier for the image-processing behavior. It is part of the cache key, and bumping it invalidates cached Variants.

**Private Prefix**:
An Object Key prefix whose Originals are served only with a verified presign (ADR 0009).

**Presign**:
The AWS SigV4 query signature WordPress adds to private image URLs, either as `presign=` or as raw `X-Amz-*` parameters.
