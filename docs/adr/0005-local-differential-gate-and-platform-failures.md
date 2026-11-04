---
Status: superseded by ADR 0011
---
# Require local differential evidence before deployment

The first deliverable is a local compatibility candidate, not a production-readiness claim. Deployment may be performed when needed, but known security and compatibility blockers must be resolved first. A Container/platform failure returns a controlled 503 and never an Original or approximate Variant. Unexpected application errors are logged without request secrets and return a sanitized 500; their exact Lambda Function URL equivalence remains unverified.
