class PixlVaultError(Exception):
    status_code = 400
    code = "bad_request"
    retryable = False

    def __init__(self, message: str, *, code: str | None = None, status_code: int | None = None, retryable: bool | None = None) -> None:
        super().__init__(message)
        self.message = message
        if code is not None:
            self.code = code
        if status_code is not None:
            self.status_code = status_code
        if retryable is not None:
            self.retryable = retryable


class TelegramNotLinkedError(PixlVaultError):
    status_code = 409
    code = "telegram_not_linked"


class TelegramTwoFactorRequiredError(PixlVaultError):
    status_code = 401
    code = "telegram_two_factor_required"


class TelegramFloodWaitError(PixlVaultError):
    status_code = 429
    code = "telegram_flood_wait"
    retryable = True

    def __init__(self, message: str, retry_after_seconds: int) -> None:
        super().__init__(message, code=self.code, status_code=self.status_code)
        self.retry_after_seconds = retry_after_seconds


class TelegramSessionMissingError(PixlVaultError):
    status_code = 404
    code = "telegram_session_missing"


class TelegramStorageChannelMissingError(PixlVaultError):
    status_code = 409
    code = "telegram_storage_channel_missing"


class TelegramSessionInvalidError(PixlVaultError):
    status_code = 409
    code = "telegram_session_invalid"


class MediaStreamExpiredError(PixlVaultError):
    status_code = 401
    code = "media_stream_expired"
    retryable = True


class MediaRangeNotSatisfiableError(PixlVaultError):
    status_code = 416
    code = "media_range_not_satisfiable"

