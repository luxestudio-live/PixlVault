from __future__ import annotations

import asyncio
import os
import shutil
import subprocess
import tempfile
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont, ImageOps


class ThumbnailService:
    async def build_thumbnail(self, source_path: str, filename: str, mime_type: str | None) -> tuple[str, str]:
        return await asyncio.to_thread(self._build_thumbnail_sync, source_path, filename, mime_type)

    async def build_placeholder_thumbnail(self, filename: str) -> tuple[str, str]:
        return await asyncio.to_thread(self._build_placeholder_thumbnail_tempfile, filename)

    def _build_thumbnail_sync(self, source_path: str, filename: str, mime_type: str | None) -> tuple[str, str]:
        suffix = Path(filename).suffix.lower()
        temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".jpg")
        temp_file.close()
        thumbnail_path = temp_file.name

        if (mime_type or "").startswith("image/") or suffix in {".jpg", ".jpeg", ".png", ".webp", ".gif"}:
            self._build_image_thumbnail(source_path, thumbnail_path)
            return thumbnail_path, "image/jpeg"

        if (mime_type or "").startswith("video/") or suffix in {".mp4", ".mov", ".mkv", ".webm"}:
            if self._build_video_thumbnail(source_path, thumbnail_path):
                return thumbnail_path, "image/jpeg"

        self._build_placeholder_thumbnail(filename, thumbnail_path)
        return thumbnail_path, "image/jpeg"

    def _build_image_thumbnail(self, source_path: str, thumbnail_path: str) -> None:
        with Image.open(source_path) as image:
            image = ImageOps.exif_transpose(image)
            image.thumbnail((512, 512))
            canvas = Image.new("RGB", image.size, (18, 18, 22))
            canvas.paste(image.convert("RGB"), (0, 0))
            canvas.save(thumbnail_path, format="JPEG", quality=85, optimize=True)

    def _build_video_thumbnail(self, source_path: str, thumbnail_path: str) -> bool:
        ffmpeg = shutil.which("ffmpeg")
        if not ffmpeg:
            return False

        command = [
            ffmpeg,
            "-y",
            "-ss",
            "00:00:01",
            "-i",
            source_path,
            "-frames:v",
            "1",
            "-vf",
            "scale=512:-1",
            thumbnail_path,
        ]

        completed = subprocess.run(command, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, check=False)
        return completed.returncode == 0 and os.path.exists(thumbnail_path)

    def _build_placeholder_thumbnail(self, filename: str, thumbnail_path: str) -> None:
        image = Image.new("RGB", (512, 512), (27, 33, 40))
        draw = ImageDraw.Draw(image)
        extension = Path(filename).suffix.upper().lstrip(".") or "FILE"
        font = ImageFont.load_default()
        draw.rounded_rectangle((32, 32, 480, 480), radius=36, outline=(95, 160, 255), width=4)
        draw.text((72, 190), extension[:12], fill=(233, 238, 243), font=font)
        draw.text((72, 250), "PixlVault", fill=(95, 160, 255), font=font)
        image.save(thumbnail_path, format="JPEG", quality=85, optimize=True)

    def _build_placeholder_thumbnail_tempfile(self, filename: str) -> tuple[str, str]:
        temp_file = tempfile.NamedTemporaryFile(delete=False, suffix=".jpg")
        temp_file.close()
        self._build_placeholder_thumbnail(filename, temp_file.name)
        return temp_file.name, "image/jpeg"
