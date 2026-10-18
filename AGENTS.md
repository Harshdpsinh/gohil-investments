# AGENTS.md

You are editing the live Gohil Investments CRM. Staff in Bhavnagar use it every day for clients, policies, renewals, commission, and WhatsApp. A mistake here changes real premium and commission figures.

## Do not

- Do not rewrite stored client, policy, or commission rows unless the user asks for that exact change.
- Do not change due-date maths, financial-year maths, commission matching, or the WhatsApp reminder wording unless the user asks.
- Do not treat a client-name match as proof two records are the same person.
- Do not put Cloudinary upload presets or API secrets in the browser.
- Do not open `/api/bhash-webhook` without `BHASH_WEBHOOK_SECRET`.
- Do not commit `.env`, service-account JSON, or tokens.
- Do not commit directly to `main`. Branch first.

## Before you edit

1. Read the doc that matches the task. The index is [docs/README.md](docs/README.md).
2. [CLAUDE.md](CLAUDE.md) still holds the workflow (tests first, pure utils, insurer names, PDF extract). If it disagrees with `docs/` or this file, follow the newer rule.
3. Put new validation and money maths in `src/utils/`, not in a page and not back into `src/firebase/firestore.js`.
4. Write the unit test before the behaviour change. Tests must mock Firebase. They must never touch live data.
5. Say what you did not change.

## Where things live

| Question | File |
| --- | --- |
| What the product is | [docs/PRD.md](docs/PRD.md) |
| How a screen should look | [docs/DESIGN.md](docs/DESIGN.md) |
| How the app is built | [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) |
| Collections and fields | [docs/DATABASE.md](docs/DATABASE.md) |
| HTTP endpoints | [docs/API.md](docs/API.md) |
| How to land a change | [docs/IMPLEMENTATION.md](docs/IMPLEMENTATION.md) |
| Local and Vercel setup | [docs/SETUP.md](docs/SETUP.md) |
| Adding one feature | [docs/FEATURE.md](docs/FEATURE.md) |
| Auth and the locks | [docs/SECURITY.md](docs/SECURITY.md) |
| MCP | [docs/MCP.md](docs/MCP.md) |
| Outside services | [docs/INTEGRATIONS.md](docs/INTEGRATIONS.md) |
| Tests | [docs/TESTING.md](docs/TESTING.md) |
| When something is broken | [docs/DEBUGGING.md](docs/DEBUGGING.md) |
