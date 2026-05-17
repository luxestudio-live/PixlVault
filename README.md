# PixlVault

Private media gallery MVP where each user's own Telegram account is used as the storage backend.

## What this repo contains

- `backend`: FastAPI + Telethon + Firestore backend.
- `frontend`: Next.js App Router frontend with Firebase Auth and gallery UI.
- `ARCHITECTURE.md`: system diagram and request flow.

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

## Docker

Build and run the backend container:

```bash
docker compose up --build backend
```

## Deployment

See [DEPLOYMENT.md](DEPLOYMENT.md) for the production-ready Vercel and AWS App Runner setup, env var checklists, CLI commands, and smoke tests.

## Security note

Never commit API keys, Telegram secrets, or Firebase service account material into the repository. Use Vercel environment variables and AWS Secrets Manager or service-level env injection instead.
