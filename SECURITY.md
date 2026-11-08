# Security Policy

## Reporting a Vulnerability

Email per [at] soderlind.no

## Known development dependency advisory

As of 2026-11-08, npm reports [GHSA-gcqx-w48m-w2h4](https://github.com/advisories/GHSA-gcqx-w48m-w2h4) for `deepmerge`, a Jest dependency with no patched upstream release. It is not deployed with the Worker, and this project's Jest configuration does not use the affected preset-globals merge. The associated [CVE-2026-93753](https://www.cve.org/CVERecord?id=CVE-2026-93753) was rejected by its issuer because it does not describe a security vulnerability; the GitHub advisory remains open.
