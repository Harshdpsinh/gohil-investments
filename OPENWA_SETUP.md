# OpenWA (WhatsApp API Gateway) — Side-by-side setup

OpenWA was added as a **separate service** under `openwa/`.

**Nothing in your existing Gohil Investments app was modified**  
(`src/`, root `package.json`, Firebase config, routes, UI, etc. are unchanged).

| App | Folder | How to run | Ports |
|-----|--------|------------|-------|
| Gohil CRM (existing) | project root | `npm run dev` | Vite (usually `5173`) |
| OpenWA (new) | `openwa/` | `start-openwa.bat` or `cd openwa` then `npm run dev` | API `2785`, Dashboard `2886` |

## Requirements for OpenWA only

- **Node.js 22 LTS or newer** (OpenWA requirement)
- Optional: **Docker** if you prefer containers instead of local Node

## First-time setup

```bat
cd openwa
npm install
npm run dev
```

Or double-click:

```text
start-openwa.bat
```

Then open:

- Dashboard: http://localhost:2886  
- API: http://localhost:2785/api  
- Swagger: http://localhost:2785/api/docs  

## Docker alternative (optional)

```bat
cd openwa
docker compose -f docker-compose.dev.yml up -d
```

- Dashboard + API: http://localhost:2785  

## How this relates to Gohil CRM

Right now OpenWA runs **next to** the CRM, not inside it.

Later (only when you ask), you can connect the CRM to OpenWA over HTTP, for example:

- Create a WhatsApp session and scan QR in OpenWA dashboard  
- Send renewal / claim / proposal messages via OpenWA REST API  
- Use an API key from the OpenWA dashboard (`X-API-Key` header)

That integration would be a future, optional step and is **not** wired yet, so production/dev CRM behavior stays the same.

## Update OpenWA later

```bat
cd openwa
git pull
npm install
```

## Source

https://github.com/rmyndharis/OpenWA
