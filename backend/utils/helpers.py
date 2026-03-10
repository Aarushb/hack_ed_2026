"""Shared utility functions for the NorthStar backend.

HTML stripping, image compression, ID generation, and other helpers
used across multiple services.
"""

from __future__ import annotations

import base64
import io
import re
import uuid
from typing import Optional

# ---------------------------------------------------------------------------
# HTML tag stripping
# ---------------------------------------------------------------------------

_HTML_TAG_RE = re.compile(r"<[^>]+>")


def strip_html(text: str) -> str:
    """Remove HTML tags from a string.

    Used primarily to clean Directions API ``html_instructions``.

    Args:
        text: Raw HTML-containing string.

    Returns:
        Plain text with tags removed and extra whitespace collapsed.
    """
    cleaned = _HTML_TAG_RE.sub(" ", text)
    return " ".join(cleaned.split())


# ---------------------------------------------------------------------------
# Image compression
# ---------------------------------------------------------------------------

def compress_image(
    base64_data: str,
    max_size_bytes: int = 4_000_000,
    quality: int = 80,
) -> str:
    """Compress a base64-encoded image to fit within *max_size_bytes*.

    Uses Pillow to iteratively reduce JPEG quality until the image fits.
    If Pillow is not installed the data is returned unchanged (graceful
    degradation — the caller should handle a 413 from Gemini).

    Args:
        base64_data: Base64-encoded image bytes (no data-URI prefix).
        max_size_bytes: Maximum allowed size in bytes.
        quality: Starting JPEG quality (1–100).

    Returns:
        Base64-encoded JPEG that fits within the size limit.
    """
    try:
        from PIL import Image  # noqa: F811
    except ImportError:
        return base64_data

    raw = base64.b64decode(base64_data)
    if len(raw) <= max_size_bytes:
        return base64_data

    img = Image.open(io.BytesIO(raw))
    if img.mode == "RGBA":
        img = img.convert("RGB")

    while quality > 10:
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=quality)
        compressed = buf.getvalue()
        if len(compressed) <= max_size_bytes:
            return base64.b64encode(compressed).decode()
        quality -= 10

    # Last resort: resize to 50 %
    img = img.resize((img.width // 2, img.height // 2), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=60)
    return base64.b64encode(buf.getvalue()).decode()


# ---------------------------------------------------------------------------
# ID generation
# ---------------------------------------------------------------------------

def generate_id(prefix: str = "") -> str:
    """Generate a short unique identifier.

    Args:
        prefix: Optional string prepended to the ID (e.g. ``"wp"``).

    Returns:
        A string like ``"wp_a1b2c3d4"``.
    """
    short = uuid.uuid4().hex[:8]
    return f"{prefix}_{short}" if prefix else short


# ---------------------------------------------------------------------------
# Numeric utilities
# ---------------------------------------------------------------------------

def clamp(value: float, min_val: float, max_val: float) -> float:
    """Clamp *value* to the range [*min_val*, *max_val*].

    Args:
        value: The number to clamp.
        min_val: Lower bound.
        max_val: Upper bound.

    Returns:
        The clamped value.
    """
    return max(min_val, min(value, max_val))


# ---------------------------------------------------------------------------
# Base64 validation
# ---------------------------------------------------------------------------

def is_valid_base64(data: Optional[str]) -> bool:
    """Check whether *data* looks like a valid base64 string.

    Does not fully decode — just a fast sanity check.
    """
    if not data:
        return False
    try:
        base64.b64decode(data[:64], validate=True)
        return True
    except Exception:
        return False
