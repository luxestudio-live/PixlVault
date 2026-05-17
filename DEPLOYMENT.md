# PixlVault Deployment Guide

## Deployment Model

- Frontend: Next.js App Router on Vercel.
- Backend: FastAPI on AWS Elastic Beanstalk using the Python platform and source-based deployment.
- Auth: Firebase Auth.
- Metadata: Firestore.
- Media storage: Telegram MTProto via the user's own linked Telegram account.

## Frontend Readiness

- App Router is already in use, including dynamic viewer routes.
- The frontend is treated as a dynamic app, not a static export.
- `NEXT_PUBLIC_API_BASE_URL` must point at the AWS backend in Vercel preview and production envs.
- Firebase public config must be provided in Vercel env vars.
- Missing required env vars now fail with clear startup/build-time errors.

### Vercel env vars

Required:

- `NEXT_PUBLIC_API_BASE_URL`
- `NEXT_PUBLIC_FIREBASE_API_KEY`
- `NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN`
- `NEXT_PUBLIC_FIREBASE_PROJECT_ID`
- `NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET`
- `NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID`
- `NEXT_PUBLIC_FIREBASE_APP_ID`

Optional:

- `NEXT_PUBLIC_FIREBASE_MEASUREMENT_ID`

### Vercel setup flow

1. Install the Vercel CLI: `npm install -g vercel`.
2. From the `frontend` folder, run `vercel login`.
3. Link the project with `vercel link`.
4. Pull preview env vars with `vercel env pull .env.local`.
5. Set production env vars in the Vercel project settings.
6. Test a preview deployment with `vercel deploy`.
7. Promote production with `vercel deploy --prod`.

### Vercel preview vs production

- Preview deployments should use the AWS staging backend URL and a matching preview Firebase config if you keep a separate Firebase project or auth domain.
- Production deployments should use the production AWS backend URL and production Firebase config.
- Keep the frontend env values aligned with the backend CORS allowlist for both preview and production domains.

## Backend Readiness

- The backend uses a Python `Procfile` with `gunicorn` and `uvicorn.workers.UvicornWorker`.
- The process binds to `0.0.0.0` and honors `PORT` with a default of `8000`.
- Backend startup now validates production-oriented env assumptions and creates cloud-safe temp storage.
- Logging is JSON structured and request-scoped.
- `/health` is a liveness check and `/ready` is a readiness check.

### AWS env vars

Required:

- `APP_ENV=production`
- `API_V1_PREFIX=/api/v1`
- `LOG_LEVEL=INFO`
- `CORS_ORIGINS=["https://pixlvault.theluxestudio.in"]`
- `TELEGRAM_API_ID`
- `TELEGRAM_API_HASH`
- `TELEGRAM_SESSION_ENCRYPTION_KEY`

Firebase / Firestore:

- `FIREBASE_PROJECT_ID`
- `FIREBASE_SERVICE_ACCOUNT_JSON` or `FIREBASE_SERVICE_ACCOUNT_PATH`

Optional but recommended:

- `MEDIA_STREAM_TOKEN_TTL_SECONDS=300`
- `FIRESTORE_COLLECTION_PREFIX=pixlvault`
- `UPLOAD_TEMP_DIR=/tmp/pixlvault`
- `MAINTENANCE_AUTH_TOKEN`

### Elastic Beanstalk setup flow

1. From `backend`, run `eb init -p python-3.12 pixlvault-backend`.
2. Create the environment with `eb create pixlvault-backend-prod`.
3. Set production env vars with `eb setenv ...`.
4. Deploy with `eb deploy`.
5. Confirm the environment URL can reach `/health` and `/ready`.
6. Point the Vercel frontend at the Elastic Beanstalk environment URL.

The backend bundle includes an EB health-check config that points the environment health check at `/health`.

### EB CLI commands

From the `backend` folder:

```bash
eb init -p python-3.12 pixlvault-backend
eb create pixlvault-backend-prod
eb setenv APP_ENV=production API_V1_PREFIX=/api/v1 LOG_LEVEL=INFO CORS_ORIGINS='["https://pixlvault.theluxestudio.in"]' TELEGRAM_API_ID=... TELEGRAM_API_HASH=... TELEGRAM_SESSION_ENCRYPTION_KEY=... FIREBASE_PROJECT_ID=... FIREBASE_SERVICE_ACCOUNT_JSON='...'
eb deploy
```

### Secret handling

- Prefer environment-injected secrets over checked-in files.
- If you use `FIREBASE_SERVICE_ACCOUNT_JSON`, store the full service-account JSON in AWS Secrets Manager or an encrypted environment value.
- Keep Telegram API credentials and encryption keys out of the repo and out of build logs.

### Port handling

- Elastic Beanstalk should launch the app through the `Procfile`.
- The backend binds to `PORT` when provided and falls back to `8000`.

### CORS setup

- Allow the exact Vercel production domain and any preview domains you actually use.
- Do not leave localhost origins in the production backend CORS list.

## Production Safety Checks

- Debug endpoints are disabled outside local/dev/test environments.
- Required production env vars now fail fast on startup.
- Frontend runtime config no longer silently assumes localhost in production.
- Temporary storage is initialized explicitly before media work begins.

## Deployment Order

1. Deploy the backend to AWS staging.
2. Confirm `/health` and `/ready` both behave as expected.
3. Configure Vercel preview env vars to point at the staging backend.
4. Run a full preview smoke test from the frontend.
5. Promote the backend to production.
6. Update Vercel production env vars.
7. Run production smoke tests.

## Smoke Tests

1. Load the frontend and confirm Firebase sign-in works.
2. Confirm the frontend can call the backend via `NEXT_PUBLIC_API_BASE_URL`.
3. Check Telegram linking, media upload, gallery listing, and viewer navigation.
4. Verify `/health` returns `{"status":"ok"}`.
5. Verify `/ready` returns `{"status":"ready"}` in the deployed environment.
6. Confirm the debug endpoint returns 404 in production.

## Remaining Operational Risks

- Stream tokens are still scoped to the current user library for their TTL.
- Firestore writes still occur on authenticated requests to keep the canonical profile fresh.
- Provider-link state still uses browser storage and should be treated as XSS-sensitive.