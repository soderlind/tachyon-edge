---
Status: superseded by ADR 0007
---
# Preserve the processing core in Cloudflare Containers

Workers route requests and manage edge caching; a Container runs the existing Node, Sharp/libvips and smartcrop processing path, with a Durable Object limited to Container lifecycle and routing. Cloudflare Images and Worker/WASM transforms are not presumed byte-equivalent, and the Container must use a supported Node LTS that passes differential verification before it can be considered compatible.
