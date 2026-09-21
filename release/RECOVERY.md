# Verified source recovery

The complete 149-file prepared archive was recovered and committed on GitHub as
`f42fa06a16e555c560cfd36773dedde5c4cd161a` on September 21, 2026.
All 58 binary blocks and the complete archive checksum were verified before
extraction. Client, server, reusable libraries, media, tests and documentation
are retained, together with the later publisher and deployment fixes.

The original local Git bundle is a historical recovery snapshot, not a
replacement for remote history. No force push is required.

Run `node scripts/publish-github.mjs --check` to validate the source inventory
and local tests. See `docs/GITHUB-PAGES.md` for deployment instructions.
The Pages workflow checks both the built application and the actual public
site; use the successful workflow and matching deployment.json as evidence.
Pages stores projects and media in browser-local IndexedDB. Server-backed
collaboration requires the separately deployed backend.
