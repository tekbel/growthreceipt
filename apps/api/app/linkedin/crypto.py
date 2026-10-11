import base64
import hashlib
import hmac
import json
import secrets
import time
from uuid import UUID

from cryptography.fernet import Fernet, InvalidToken

STATE_TTL_SECONDS = 600


def _b64(data: bytes) -> str:
    return base64.urlsafe_b64encode(data).rstrip(b"=").decode()


def _unb64(value: str) -> bytes:
    return base64.urlsafe_b64decode(value + "=" * (-len(value) % 4))


class TokenCipher:
    """Encrypts stored access tokens and signs the OAuth state with one secret key."""

    def __init__(self, key: str) -> None:
        self._fernet = Fernet(key.encode())
        self._signing_key = hashlib.sha256(b"linkedin-oauth-state:" + key.encode()).digest()

    def encrypt(self, value: str) -> str:
        return self._fernet.encrypt(value.encode()).decode()

    def decrypt(self, value: str) -> str | None:
        try:
            return self._fernet.decrypt(value.encode()).decode()
        except InvalidToken:
            return None

    def sign_state(self, workspace_id: UUID, *, now: float | None = None) -> str:
        issued = time.time() if now is None else now
        payload = {
            "workspace": str(workspace_id),
            "nonce": secrets.token_urlsafe(12),
            "expires": int(issued) + STATE_TTL_SECONDS,
        }
        body = _b64(json.dumps(payload, separators=(",", ":")).encode())
        return f"{body}.{self._signature(body)}"

    def state_matches(self, state: str, workspace_id: UUID, *, now: float | None = None) -> bool:
        """True only for an unexpired state this server issued for this same workspace."""
        body, _, signature = state.partition(".")
        if not signature or not hmac.compare_digest(signature, self._signature(body)):
            return False
        try:
            payload = json.loads(_unb64(body))
        except (ValueError, json.JSONDecodeError):
            return False
        current = time.time() if now is None else now
        return payload.get("workspace") == str(workspace_id) and payload.get("expires", 0) > current

    def _signature(self, body: str) -> str:
        return _b64(hmac.new(self._signing_key, body.encode(), hashlib.sha256).digest())
