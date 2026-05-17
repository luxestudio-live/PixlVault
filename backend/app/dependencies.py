from __future__ import annotations

from dataclasses import dataclass
import logging

from firebase_admin import auth as firebase_auth
from fastapi import Header, HTTPException, Request, status

from app.core.observability import log_event, set_request_context

logger = logging.getLogger(__name__)


@dataclass(slots=True)
class CurrentUser:
    uid: str
    email: str | None = None
    name: str | None = None
    picture: str | None = None


def get_services(request: Request):
    return request.app.state.services


async def get_current_user(request: Request, authorization: str | None = Header(default=None)) -> CurrentUser:
    if not authorization or not authorization.startswith("Bearer "):
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Missing Firebase bearer token.")

    token = authorization.removeprefix("Bearer ").strip()
    auth_service = request.app.state.firebase_auth
    firestore = request.app.state.firestore
    try:
        decoded = await auth_service.verify_id_token(token)
    except (
        firebase_auth.ExpiredIdTokenError,
        firebase_auth.InvalidIdTokenError,
        firebase_auth.RevokedIdTokenError,
        firebase_auth.CertificateFetchError,
        firebase_auth.UserDisabledError,
        firebase_auth.ConfigurationNotFoundError,
    ) as exc:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Invalid Firebase bearer token.") from exc
    except Exception as exc:
        logger.exception("Unexpected Firebase token verification failure")
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Unable to verify Firebase bearer token.") from exc
    set_request_context(uid=decoded["uid"])

    firebase_claims = decoded.get("firebase") or {}
    identities = firebase_claims.get("identities") or {}
    auth_providers = []

    sign_in_provider = firebase_claims.get("sign_in_provider")
    if sign_in_provider:
        auth_providers.append(sign_in_provider)

    for provider_id, values in identities.items():
        if values:
            auth_providers.append(provider_id)

    await firestore.ensure_canonical_user(
        decoded["uid"],
        {
            "uid": decoded["uid"],
            "primaryEmail": decoded.get("email"),
            "displayName": decoded.get("name"),
            "photoURL": decoded.get("picture"),
            "authProviders": auth_providers,
            "firebaseSignInProvider": sign_in_provider,
            "firebaseIdentities": identities,
            "lastLoginAt": decoded.get("auth_time"),
        },
    )

    log_event(
        logger,
        logging.INFO,
        "auth_verified",
        "Firebase token verified",
        route=str(request.url.path),
        method=request.method,
        status=200,
    )

    return CurrentUser(
        uid=decoded["uid"],
        email=decoded.get("email"),
        name=decoded.get("name"),
        picture=decoded.get("picture"),
    )
