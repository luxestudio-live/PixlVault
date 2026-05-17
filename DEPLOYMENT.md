# PixlVault Deployment Guide

## Deployment Model

- Frontend: Next.js App Router on Vercel.
- Backend: FastAPI container on AWS App Runner, or an equivalent lightweight AWS container host.
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

- Docker image is built from `backend/Dockerfile`.
- The container listens on `0.0.0.0` and honors `PORT` with a default of `8080`.
- Backend startup now validates production-oriented env assumptions and creates cloud-safe temp storage.
- Logging is JSON structured and request-scoped.
- `/health` is a liveness check and `/ready` is a readiness check.

### AWS env vars

Required:

- `APP_ENV=production`
- `API_V1_PREFIX=/api/v1`
- `LOG_LEVEL=INFO`
- `CORS_ORIGINS=["https://<your-vercel-prod-domain>","https://<your-vercel-preview-domain>"]`
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

### AWS App Runner setup flow

1. Build the image locally with `docker build -t pixlvault-backend -f backend/Dockerfile .`.
2. Push the image to your registry of choice, such as Amazon ECR.
3. Create an App Runner service from that image.
4. Set the container port to `8080` unless you override `PORT`.
5. Inject secrets and env vars at the App Runner service level or through AWS Secrets Manager references.
6. Confirm the service can reach Firestore and Firebase Admin using the configured credentials.
7. Point the Vercel frontend at the App Runner service URL.

### Secret handling

- Prefer environment-injected secrets over checked-in files.
- If you use `FIREBASE_SERVICE_ACCOUNT_JSON`, store the full service-account JSON in AWS Secrets Manager or an encrypted environment value.
- Keep Telegram API credentials and encryption keys out of the repo and out of build logs.

### Port handling

- App Runner must expose the same port the container listens on.
- This repository defaults to `8080` and also respects the `PORT` env var.

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