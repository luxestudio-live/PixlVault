# PixlVault

Private media gallery MVP where each user's own Telegram account is used as the storage backend.

## What PixlVault Does

PixlVault is a private media vault that lets users sign in with Firebase Auth, link their own Telegram account, and use Telegram as the storage backend for uploads, thumbnails, streaming, and gallery browsing.

## Features

- Firebase Auth sign-in and account linking.
- Telegram OTP linking with session recovery.
- Private per-user Telegram storage channel.
- Media upload queue with progress, cancel, and retry support.
- Gallery browsing with pagination and filters.
- Immersive media viewer with keyboard and swipe navigation.
- Server-side encrypted Telegram session storage in Firestore.
- Structured JSON logging and request tracing in the backend.
- Production readiness checks for frontend and backend deployment.

## Tech Stack

- Frontend: Next.js App Router, React 19, Tailwind, Framer Motion, Firebase client SDK.
- Backend: FastAPI, Telethon, Firestore, Firebase Admin, Python 3.12.
- Media transport: Telegram MTProto.
- Deployment: Vercel frontend, AWS App Runner backend.

## Repository Layout

- `backend`: FastAPI + Telethon + Firestore backend.
- `frontend`: Next.js App Router frontend with Firebase Auth and gallery UI.
- `ARCHITECTURE.md`: system diagram and request flow.
- `DEPLOYMENT.md`: Vercel and AWS deployment guide, env vars, and smoke tests.

## Local development

1. Copy `backend/.env.example` to `backend/.env`.
2. Fill in Firebase, Telegram, and encryption settings.
3. Run the backend locally with Uvicorn from the `backend` folder.
4. Copy `frontend/.env.example` to `frontend/.env.local` and fill in Firebase client config plus the backend URL.
5. Run the frontend locally from the `frontend` folder.

Example:

```bash
cd backend
uvicorn app.main:app --reload --port 8080
```

```bash
cd frontend
npm install
npm run dev
```

## Environment Files

- `backend/.env.example`: backend runtime variables for local development and deployment.
- `frontend/.env.example`: public frontend variables for local development and Vercel.

## Deployment

The production target is:

- Frontend: Vercel
- Backend: AWS App Runner or a similar lightweight container host

See [DEPLOYMENT.md](DEPLOYMENT.md) for the full deployment checklist, env var matrix, CLI flow, and smoke tests.

## Docker

Build and run the backend container:

```bash
docker compose up --build backend
```

## Production Notes

- The frontend is a dynamic Next.js app and should not be deployed as a static export.
- Keep `NEXT_PUBLIC_API_BASE_URL` pointed at the deployed AWS backend for preview and production.
- Store Firebase service account material and Telegram secrets in environment variables or secret managers, not in the repository.
- The backend exposes `/health` for liveness and `/ready` for readiness.

## Security note

Never commit API keys, Telegram secrets, or Firebase service account material into the repository. Use Vercel environment variables and AWS Secrets Manager or service-level env injection instead.
