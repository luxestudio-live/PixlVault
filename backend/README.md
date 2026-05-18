# Backend

FastAPI backend for PixlVault.

## Current responsibilities

- Verify Firebase ID tokens.
- Handle Telegram OTP requests and verification through MTProto.
- Encrypt and store Telegram sessions server-side.
- Create one private Telegram channel per user.
- Upload media to the user's private Telegram channel.
- Store metadata in Firestore.

## Run locally

```bash
cd backend
copy .env.example .env
uvicorn app.main:app --reload --port 8080
```

For local development, set `FIREBASE_SERVICE_ACCOUNT_PATH=./firebase-service-account.json` in `backend/.env` and keep the JSON file in the backend folder.

For Elastic Beanstalk production deployments, use `FIREBASE_SERVICE_ACCOUNT_PATH` only. Do not inject the JSON as an environment variable.

## Deployment

See [../DEPLOYMENT.md](../DEPLOYMENT.md) for the Elastic Beanstalk source-deployment flow, required backend env vars, health/readiness endpoints, and production checklist.
