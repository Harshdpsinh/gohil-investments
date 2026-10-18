# MCP

## Prompt

Do not add an MCP server to this repo.

## Why

The CRM is a Vite app plus a handful of Vercel functions. Staff do not connect a model context protocol to it. The secrets it holds (Firebase admin, WhatsApp, BHASH, Cloudinary) must not be exposed as tools.

Coding agents that work on this repo already have their own connectors (GitHub, Vercel, Gmail) outside the app. Those are not part of `gohil-investments` and must not be copied in.

## If someone asks for MCP anyway

Say no, and point them at the existing HTTP routes in [API.md](API.md). A new integration is a Vercel function with a staff token check, not a tool server.

Do not install an MCP package, do not add an `mcp.json`, and do not put a service-account JSON where a tool runner can read it.
