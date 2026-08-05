# HiveMind

HiveMind is a real-time team collaboration app built with [Next.js](https://nextjs.org) (App Router)
and Firebase. It combines chat "Honeycombs", threaded discussions, an AI assistant (Google Gemini),
and a collaborative in-browser developer **sandbox** (Monaco editor + live terminal via `node-pty`).

- **Frontend / SSR:** Next.js 16, React 19
- **Auth & data:** Firebase Auth (Google sign-in), Realtime Database, Firestore
- **AI:** Google Gemini (`@google/genai`), with a quota-free demo mode
- **Sandbox:** Monaco editor, Yjs collaboration, xterm.js terminal

---

## Prerequisites

- **Node.js 20+** and npm (Node 20 is what the Docker image uses)
- A **Firebase project** with Authentication (Google provider), Realtime Database, and Firestore enabled
- A **Google Gemini API key** (from [Google AI Studio](https://aistudio.google.com/apikey)) — optional if you only run in demo mode
- A Firebase **service account** (for server-side Admin SDK features like seeding) — optional

---

## 1. Install

```bash
git clone <your-repo-url>
cd HiveMindApp
npm install
```

> Native modules (`node-pty` for the terminal) may need build tools. On Windows this is handled by
> the standard Node toolchain; on Linux/macOS ensure `python3`, `make`, and a C++ compiler are present.

## 2. Configure environment

Create a `.env.local` file in the project root. **This file is gitignored — never commit it.**
Copy the template below and fill in your own values:

```bash
# --- Firebase Web config (safe to be public; identifies the project) ---
NEXT_PUBLIC_FIREBASE_API_KEY=your_web_api_key
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=your-project-id
NEXT_PUBLIC_FIREBASE_DATABASE_URL=https://your-project-default-rtdb.firebaseio.com
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your-project.firebasestorage.app
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=000000000000
NEXT_PUBLIC_FIREBASE_APP_ID=1:000000000000:web:xxxxxxxxxxxx

# --- AI (Google Gemini) ---
GENAI_API_KEY=your_gemini_api_key          # server-side; keep secret
GEMINI_MODEL=gemini-2.5-flash

# --- Firebase Admin SDK (server-side; keep SECRET) ---
FIREBASE_PROJECT_ID=your-project-id
FIREBASE_CLIENT_EMAIL=firebase-adminsdk-xxxxx@your-project.iam.gserviceaccount.com
FIREBASE_PRIVATE_KEY="-----BEGIN PRIVATE KEY-----\n...\n-----END PRIVATE KEY-----\n"

# --- Local dev toggles (optional) ---
NEXT_PUBLIC_AI_DEMO=false      # set true to return canned AI replies (no quota used)
NEXT_PUBLIC_DEV_SEED=1         # enables the /api/dev/seed sample-data endpoint
```

### Environment variable reference

| Variable | Required | Secret? | Purpose |
|---|---|---|---|
| `NEXT_PUBLIC_FIREBASE_*` | Yes | No (public by design) | Firebase Web client config |
| `GENAI_API_KEY` | For real AI | **Yes** | Google Gemini API key (server-side) |
| `GEMINI_MODEL` | No | No | Gemini model id (default `gemini-2.5-flash`) |
| `FIREBASE_PROJECT_ID` / `FIREBASE_CLIENT_EMAIL` / `FIREBASE_PRIVATE_KEY` | For Admin features (seeding) | **Yes** | Firebase Admin SDK service account |
| `NEXT_PUBLIC_AI_DEMO` | No | No | `true` returns demo AI replies without calling Gemini |
| `NEXT_PUBLIC_DEV_SEED` | No | No | `1` enables the dev seed endpoint |
| `NEXT_PUBLIC_CAPTION_API_BASE` | No | No | Base URL of the optional image-caption service |
| `NEXT_PUBLIC_MASTER_HIVE_KEY` | No | No | Optional master key for hive encryption |

> **Firebase Web keys are not secrets.** They identify the project in client code; access is enforced by
> Firebase Security Rules ([`database.rules.json`](database.rules.json), [`firestore.rules`](firestore.rules)).
> The genuinely sensitive values are `GENAI_API_KEY` and the `FIREBASE_PRIVATE_KEY` service account — keep
> those only in `.env.local` (never commit them).

## 3. Run the dev server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) and sign in with Google.

## 4. (Optional) Seed sample data

With `NEXT_PUBLIC_DEV_SEED=1` set, POST to the seed endpoint to create a demo hive:

```bash
curl -X POST http://localhost:3000/api/dev/seed
```

PowerShell:

```powershell
Invoke-WebRequest -Uri "http://localhost:3000/api/dev/seed" -Method POST `
  -Headers @{ "Content-Type" = "application/json" } | Select-Object -ExpandProperty Content
```

This creates a hive called `demo-hive` with a `general` Honeycomb, sample messages, a thread, and an
AI summary. Then navigate to `/hive/demo-hive/honeycomb/general` to explore. With `NEXT_PUBLIC_AI_DEMO=true`
the "Ask AI" button returns deterministic demo replies without consuming Gemini quota.

---

## Run with Docker (optional)

The compose stack also starts monitoring services (cAdvisor, Prometheus, Grafana).
Run from the project root and make sure `.env.local` is present (compose reads it via `env_file`):

```bash
docker compose up --build
```

| Service | URL |
|---|---|
| HiveMind app | http://localhost:3000 |
| cAdvisor | http://localhost:8080 |
| Prometheus | http://localhost:9090 |
| Grafana | http://localhost:3001 (admin / admin — change this) |

To build just the app image:

```bash
docker build -t hivemind .
```

---

## Useful scripts

| Command | Description |
|---|---|
| `npm run dev` | Start the dev server (Turbopack) |
| `npm run build` | Production build |
| `npm start` | Serve the production build |
| `npm run lint` | ESLint over `src` |
| `npm run test:hardening` | Run security/hardening checks |
| `npm run verify:production` | Hardening checks + lint |
| `npm run deploy` | Build and `firebase deploy` |

---

## Further documentation

- [ARCHITECTURE.md](ARCHITECTURE.md) — system design
- [DEPLOYMENT.md](DEPLOYMENT.md) — deployment guide
- [RISKS_AND_FUTURE_WORK.md](RISKS_AND_FUTURE_WORK.md) — known limitations
- [docs/](docs/) — additional notes
</content>
</invoke>
