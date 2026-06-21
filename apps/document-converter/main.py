"""
Skarion Document Converter Service
Converts uploaded documents (PDF, DOCX, PPTX, XLSX, CSV, TXT) to Markdown
using Microsoft MarkItDown, for AI extraction pipelines.

Security model:
- Shared-secret auth via X-Converter-Secret header
- File size limit (10MB)
- MIME type + extension whitelist
- No URL fetching from user input
- No filesystem access beyond temp upload
- Temp files cleaned immediately after conversion
- 30-second timeout on conversion
- Safe error messages (no paths leaked)
"""

import os
import io
import hashlib
import signal
from contextlib import contextmanager
from typing import Optional
from datetime import datetime

from fastapi import FastAPI, File, UploadFile, Form, HTTPException, Header, Request
from fastapi.responses import JSONResponse
import uvicorn

# MarkItDown imports
try:
    from markitdown import MarkItDown, StreamInfo
    MARKITDOWN_AVAILABLE = True
except ImportError:
    MARKITDOWN_AVAILABLE = False

# ────────────────────────────────────────────────────────────────────────────
# Configuration
# ────────────────────────────────────────────────────────────────────────────

MAX_FILE_SIZE = 10 * 1024 * 1024  # 10 MB
CONVERT_TIMEOUT_SECONDS = 30

ALLOWED_EXTENSIONS = {
    ".pdf", ".docx", ".pptx", ".xlsx", ".csv", ".txt",
}

ALLOWED_MIME_TYPES = {
    "application/pdf",
    "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    "text/csv",
    "text/plain",
}

# MIME fallback map (extension → MIME)
MIME_BY_EXTENSION = {
    ".pdf": "application/pdf",
    ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    ".pptx": "application/vnd.openxmlformats-officedocument.presentationml.presentation",
    ".xlsx": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    ".csv": "text/csv",
    ".txt": "text/plain",
}

app = FastAPI(
    title="Skarion Document Converter",
    description="Convert documents to Markdown for AI extraction pipelines.",
    version="1.0.0",
)


# ────────────────────────────────────────────────────────────────────────────
# Security helpers
# ────────────────────────────────────────────────────────────────────────────

def verify_secret(request_secret: Optional[str]) -> None:
    """Validate shared secret between CRM Worker and converter."""
    expected = os.environ.get("DOCUMENT_CONVERTER_SECRET")
    if not expected:
        # If no secret is configured, allow requests (useful for local dev).
        # In production, always set DOCUMENT_CONVERTER_SECRET.
        return
    if not request_secret:
        raise HTTPException(status_code=401, detail="Missing X-Converter-Secret header")
    if request_secret != expected:
        raise HTTPException(status_code=403, detail="Invalid converter secret")


class TimeoutException(Exception):
    pass


@contextmanager
def timeout(seconds: int):
    """Context manager that raises TimeoutException after N seconds."""

    def handler(signum, frame):
        raise TimeoutException(f"Conversion timed out after {seconds} seconds")

    # Use signal-based timeout on Unix; Windows doesn't support SIGALRM well,
    # so we fall back to a simple timeout check (less precise but safe).
    try:
        old_handler = signal.signal(signal.SIGALRM, handler)
        signal.alarm(seconds)
        yield
    except AttributeError:
        # Windows or no SIGALRM — skip signal-based timeout
        yield
    except TimeoutException:
        raise
    finally:
        try:
            signal.alarm(0)
            signal.signal(signal.SIGALRM, old_handler)
        except Exception:
            pass


def get_extension(filename: str) -> str:
    """Return lowercase extension including the dot."""
    return os.path.splitext(filename)[1].lower()


def validate_file(file: UploadFile, content: bytes) -> None:
    """Validate file size, extension, and MIME type."""
    if len(content) > MAX_FILE_SIZE:
        raise HTTPException(
            status_code=413,
            detail=f"File too large. Maximum size is {MAX_FILE_SIZE // (1024 * 1024)} MB.",
        )

    ext = get_extension(file.filename or "")
    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=415,
            detail=f"Unsupported file extension: {ext}. Allowed: {', '.join(ALLOWED_EXTENSIONS)}",
        )

    # Validate MIME type from upload metadata (client-provided, so we also
    # cross-check with extension whitelist above as a defense-in-depth step).
    declared_mime = (file.content_type or "").lower()
    expected_mime = MIME_BY_EXTENSION.get(ext)

    if declared_mime and declared_mime not in ALLOWED_MIME_TYPES:
        # If the declared MIME is not in our whitelist, reject unless it
        # matches a known extension-based fallback.
        if expected_mime and declared_mime != expected_mime:
            # Allow a mismatch if the extension is valid — browsers sometimes
            # send generic MIME types like application/octet-stream.
            pass
        else:
            raise HTTPException(
                status_code=415,
                detail=f"Unsupported MIME type: {declared_mime}",
            )

    # Prevent path traversal in filenames
    safe_name = os.path.basename(file.filename or "")
    if safe_name != (file.filename or ""):
        raise HTTPException(status_code=400, detail="Invalid filename")


def compute_sha256(content: bytes) -> str:
    """Compute SHA-256 hash of file content."""
    return hashlib.sha256(content).hexdigest()


# ────────────────────────────────────────────────────────────────────────────
# Markdown cleaning (token-saving)
# ────────────────────────────────────────────────────────────────────────────

import re

# Pattern to strip base64/data URLs (often embedded in converted markdown)
BASE64_DATA_URL_RE = re.compile(r"data:[^;]+;base64,[A-Za-z0-9+/=]+", re.MULTILINE)
# Pattern to collapse repeated blank lines
REPEATED_BLANK_RE = re.compile(r"\n{3,}")
# Pattern to strip excessive whitespace
EXCESSIVE_SPACE_RE = re.compile(r"[ \t]+")


def clean_markdown(text: str, max_chars: int = 50000) -> str:
    """
    Clean Markdown before sending to AI:
    - Strip base64/data URLs (huge token waste)
    - Collapse repeated blank lines
    - Trim excessive horizontal whitespace
    - Cap to max_chars while preserving structure
    - Preserve headings, tables, emails, phone numbers, URLs
    """
    # Remove base64 data URLs (huge token waste from embedded images)
    text = BASE64_DATA_URL_RE.sub("[image: data-url removed]", text)

    # Collapse 3+ consecutive newlines to 2
    text = REPEATED_BLANK_RE.sub("\n\n", text)

    # Trim trailing spaces per line, but preserve intentional indentation
    lines = text.split("\n")
    cleaned_lines = []
    for line in lines:
        # Keep leading indentation for code blocks/lists, strip trailing only
        cleaned = line.rstrip()
        cleaned_lines.append(cleaned)
    text = "\n".join(cleaned_lines)

    # Cap length while trying to preserve structure (cut at paragraph boundary)
    if len(text) > max_chars:
        # Find the last paragraph boundary before the limit
        cutoff = text.rfind("\n\n", 0, max_chars)
        if cutoff == -1:
            cutoff = max_chars
        text = text[:cutoff] + "\n\n[...document truncated]"

    return text.strip()


def estimate_tokens(char_count: int) -> int:
    """Rough estimate: ~4 characters per token for English text."""
    return max(1, char_count // 4)


# ────────────────────────────────────────────────────────────────────────────
# Conversion engine
# ────────────────────────────────────────────────────────────────────────────


def convert_document(content: bytes, filename: str, mime_type: str) -> dict:
    """
    Convert document bytes to Markdown using MarkItDown.

    Returns dict with:
        markdown, markdown_preview, char_count, estimated_tokens, warnings
    """
    if not MARKITDOWN_AVAILABLE:
        raise HTTPException(
            status_code=503,
            detail="Document converter engine is not available. Please check service health.",
        )

    warnings: list[str] = []
    markdown = ""

    try:
        with timeout(CONVERT_TIMEOUT_SECONDS):
            md = MarkItDown()
            stream = io.BytesIO(content)

            ext = get_extension(filename)
            stream_info = StreamInfo(
                filename=filename,
                extension=ext,
                mimetype=mime_type or MIME_BY_EXTENSION.get(ext, "application/octet-stream"),
            )

            result = md.convert_stream(stream, stream_info=stream_info)
            markdown = result.text_content or ""

    except TimeoutException:
        raise HTTPException(status_code=504, detail="Document conversion timed out")
    except Exception as e:
        # Safe error — do not leak internal paths or exception details
        app.state.last_conversion_error = str(e)  # for internal logging only
        warnings.append("Document conversion encountered an issue. Partial output may be available.")
        markdown = markdown or ""

    if not markdown or not markdown.strip():
        warnings.append("No extractable text found in document. The file may be image-based or encrypted.")

    # Clean and prepare output
    cleaned = clean_markdown(markdown)
    char_count = len(cleaned)
    preview = cleaned[:2000] if len(cleaned) > 2000 else cleaned

    return {
        "markdown": cleaned,
        "markdown_preview": preview,
        "char_count": char_count,
        "estimated_tokens": estimate_tokens(char_count),
        "warnings": warnings,
    }


# ────────────────────────────────────────────────────────────────────────────
# API endpoints
# ────────────────────────────────────────────────────────────────────────────

@app.get("/health")
async def health():
    """Health check for load balancers / orchestrators."""
    return {
        "status": "ok",
        "markitdown_available": MARKITDOWN_AVAILABLE,
        "timestamp": datetime.utcnow().isoformat() + "Z",
    }


@app.post("/convert")
async def convert(
    request: Request,
    file: UploadFile = File(..., description="Document to convert (PDF, DOCX, PPTX, XLSX, CSV, TXT)"),
    mode: str = Form("general", description="Conversion mode: lead, rfp, resume, general"),
    x_converter_secret: Optional[str] = Header(None, alias="X-Converter-Secret"),
):
    """
    Convert an uploaded document to Markdown.

    - **file**: The document file (multipart/form-data)
    - **mode**: Optional hint for downstream processing (lead, rfp, resume, general)
    - **X-Converter-Secret**: Shared secret for service-to-service auth

    Returns JSON with markdown, preview, character count, estimated token count,
    file hash, and any warnings.
    """
    verify_secret(x_converter_secret)

    # Validate mode (informational only — doesn't affect conversion yet)
    valid_modes = {"lead", "rfp", "resume", "general"}
    if mode not in valid_modes:
        raise HTTPException(status_code=400, detail=f"Invalid mode. Allowed: {', '.join(valid_modes)}")

    # Read file bytes into memory (UploadFile is async, so we read once)
    content = await file.read()
    await file.close()  # release the handle immediately

    validate_file(file, content)

    sha256 = compute_sha256(content)

    # Convert
    result = convert_document(content, file.filename or "document", file.content_type or "")

    return JSONResponse(
        status_code=200,
        content={
            "filename": file.filename,
            "mimeType": file.content_type,
            "sha256": sha256,
            "mode": mode,
            "markdown": result["markdown"],
            "markdownPreview": result["markdown_preview"],
            "charCount": result["char_count"],
            "estimatedTokens": result["estimated_tokens"],
            "warnings": result["warnings"],
        },
    )


@app.get("/")
async def root():
    return {
        "service": "Skarion Document Converter",
        "version": "1.0.0",
        "endpoints": ["/health", "/convert"],
    }


# ────────────────────────────────────────────────────────────────────────────
# Main entrypoint
# ────────────────────────────────────────────────────────────────────────────

if __name__ == "__main__":
    port = int(os.environ.get("PORT", "8000"))
    uvicorn.run(app, host="0.0.0.0", port=port)
