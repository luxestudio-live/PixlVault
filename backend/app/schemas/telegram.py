from pydantic import BaseModel, Field


class TelegramOtpRequest(BaseModel):
    phone_number: str = Field(min_length=7, max_length=32)
    force_resend: bool = False
    channel_name: str | None = Field(default=None, min_length=1, max_length=80)


class TelegramOtpRequestResponse(BaseModel):
    challenge_id: str
    phone_number: str
    expires_in_seconds: int


class TelegramOtpVerifyRequest(BaseModel):
    challenge_id: str
    otp_code: str = Field(min_length=3, max_length=12)
    two_factor_password: str | None = Field(default=None, max_length=128)


class TelegramLinkResponse(BaseModel):
    linked: bool
    channel_id: int | None = None
    telegram_user_id: int | None = None
    username: str | None = None


class TelegramStatusResponse(BaseModel):
    linked: bool
    channel_id: int | None = None
    telegram_username: str | None = None
    reconnect_required: bool = False
    reason: str | None = None
