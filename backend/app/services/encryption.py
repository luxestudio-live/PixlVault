import base64
import os

from cryptography.hazmat.primitives.ciphers.aead import AESGCM


class SessionEncryptionError(RuntimeError):
    pass


def _normalize_key(secret: str) -> bytes:
    try:
        key = base64.urlsafe_b64decode(secret + "==")
    except Exception as exc:  # pragma: no cover - defensive parsing
        raise SessionEncryptionError("telegram session encryption key must be base64 urlsafe encoded") from exc

    if len(key) != 32:
        raise SessionEncryptionError("telegram session encryption key must decode to 32 bytes")
    return key


class SessionCryptographer:
    def __init__(self, secret: str) -> None:
        self._key = _normalize_key(secret)

    def encrypt(self, plaintext: str) -> str:
        nonce = os.urandom(12)
        aesgcm = AESGCM(self._key)
        ciphertext = aesgcm.encrypt(nonce, plaintext.encode("utf-8"), None)
        return base64.urlsafe_b64encode(nonce + ciphertext).decode("utf-8")

    def decrypt(self, token: str) -> str:
        raw = base64.urlsafe_b64decode(token.encode("utf-8"))
        nonce = raw[:12]
        ciphertext = raw[12:]
        aesgcm = AESGCM(self._key)
        plaintext = aesgcm.decrypt(nonce, ciphertext, None)
        return plaintext.decode("utf-8")
