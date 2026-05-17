# Frontend

Next.js App Router frontend for PixlVault.

## Current responsibilities

- Firebase Auth sign-in.
- Telegram linking UI.
- Media upload UI.
- Gallery UI backed by backend metadata.

## Run locally

```bash
cd frontend
npm install
copy .env.example .env.local
npm run dev
```

## Deployment

PixlVault's frontend is a dynamic Next.js App Router app intended for Vercel deployment.

- Set `NEXT_PUBLIC_API_BASE_URL` to the AWS-hosted FastAPI backend.
- Configure Firebase client config and any other public runtime env vars in Vercel project settings.
- Do not deploy this frontend as a static export.

See [../DEPLOYMENT.md](../DEPLOYMENT.md) for the exact Vercel CLI flow, preview deployment setup, and production env checklist.
