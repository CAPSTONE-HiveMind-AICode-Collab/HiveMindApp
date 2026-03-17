This is a [Next.js](https://nextjs.org) project bootstrapped with [`create-next-app`](https://github.com/vercel/next.js/tree/canary/packages/create-next-app).

## Getting Started

First, run the development server:

```bash
npm run dev
# or
yarn dev
# or
pnpm dev
# or
bun dev
```

Open [http://localhost:3000](http://localhost:3000) with your browser to see the result.

You can start editing the page by modifying `app/page.js`. The page auto-updates as you edit the file.

This project uses [`next/font`](https://nextjs.org/docs/app/building-your-application/optimizing/fonts) to automatically optimize and load [Geist](https://vercel.com/font), a new font family for Vercel.

## Learn More

To learn more about Next.js, take a look at the following resources:

- [Next.js Documentation](https://nextjs.org/docs) - learn about Next.js features and API.
- [Learn Next.js](https://nextjs.org/learn) - an interactive Next.js tutorial.

You can check out [the Next.js GitHub repository](https://github.com/vercel/next.js) - your feedback and contributions are welcome!

## Deploy on Vercel

The easiest way to deploy your Next.js app is to use the [Vercel Platform](https://vercel.com/new?utm_medium=default-template&filter=next.js&utm_source=create-next-app&utm_campaign=create-next-app-readme) from the creators of Next.js.

Check out our [Next.js deployment documentation](https://nextjs.org/docs/app/building-your-application/deploying) for more details.

---

## Local dev: demo AI and quick run

If you want to run the app locally and demo the UI without consuming AI quota, use the `NEXT_PUBLIC_AI_DEMO` toggle.

1) Install

```powershell
cd C:\2023sheridan\HiveMindApp
npm install
```

2) Add Firebase env values in `.env.local` (same folder)

```
NEXT_PUBLIC_FIREBASE_API_KEY=YOUR_API_KEY
NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=YOUR_PROJECT.firebaseapp.com
NEXT_PUBLIC_FIREBASE_PROJECT_ID=YOUR_PROJECT_ID
NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=YOUR_PROJECT.appspot.com
NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=1234567890
NEXT_PUBLIC_FIREBASE_APP_ID=1:1234567890:web:abcdef
NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID=G-XXXXXXX
```

3) Optional: enable demo AI mode (recommended for demos)

Add to `.env.local`:

```
NEXT_PUBLIC_AI_DEMO=true
```

This causes the server route `/api/ai` to return a canned demo reply instead of calling the real AI model. Useful if you don't have AI quota or want faster deterministic responses during demos.

4) Start dev server

```powershell
npm run dev
Start-Process "http://localhost:3000"
```

5) Seed sample data (optional, but recommended for quick demo)

Enable the dev seed endpoint by adding to `.env.local`:

```
NEXT_PUBLIC_DEV_SEED=1
```

Then in PowerShell, call the seed endpoint:

```powershell
$headers = @{ "Content-Type" = "application/json" }
Invoke-WebRequest -Uri "http://localhost:3000/api/dev/seed" -Method POST -Headers $headers | Select-Object -ExpandProperty Content
```

Or in a browser, open:
```
http://localhost:3000/api/dev/seed
```
(click POST in Postman or similar, or use curl)

The endpoint creates a sample Hive called "demo-hive" with a Honeycomb "general" and sample messages. It also creates a demo thread + AI summary so you can see the "Completed subtasks" panel.

6) Demo flow

- Sign in with Google (Firebase Auth).
- After seeding, navigate to `/hive/demo-hive/honeycomb/general`.
- You'll see sample messages, threads, and a completed subtask summary.
- Click "Ask AI" — you'll get demo replies without consuming quota.
- Click "Open thread" on a summary to jump back to the original discussion.

---



DOCKER INSTRICTIONS *WIP*(Make sure to run it from where you have the project files!):
## Remove this later just for quicker testing!!!: C:\Users\Peter\Desktop\hivemind 
docker build -t hivemind-test .

docker-compose up --build







