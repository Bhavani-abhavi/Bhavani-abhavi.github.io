# Bhavani Adula, evidence MCP server

Read-only access to the evidence database behind https://bhavani-abhavi.github.io

Run: `node server.mjs` (stdio JSON-RPC). Self-test: `node server.mjs --selftest`.

Ten read-only tools. Returns VERIFIED evidence as support; returns UNSUPPORTED and
self-reported material only in clearly separated, captioned fields. Rate limited to
60 calls/minute. No write path exists in the server.
