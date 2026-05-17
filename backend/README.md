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

If Firestore startup fails with missing credentials, set `FIREBASE_SERVICE_ACCOUNT_PATH` in `backend/.env` to the absolute path of a Firebase service-account JSON file, or use Google ADC locally before starting Uvicorn.

## Deployment

See [../DEPLOYMENT.md](../DEPLOYMENT.md) for the Elastic Beanstalk source-deployment flow, required backend env vars, health/readiness endpoints, and production checklist.
