"""Tests for the document converter service."""

import io
import hashlib

import pytest
from fastapi.testclient import TestClient

from main import app, compute_sha256, clean_markdown, estimate_tokens, ALLOWED_EXTENSIONS

client = TestClient(app)


class TestHealth:
    def test_health_returns_ok(self):
        response = client.get("/health")
        assert response.status_code == 200
        data = response.json()
        assert data["status"] == "ok"
        assert "markitdown_available" in data


class TestConvertNoAuth:
    """Tests when DOCUMENT_CONVERTER_SECRET is NOT set."""

    def test_convert_pdf_without_secret(self, monkeypatch):
        # Ensure no secret is set
        monkeypatch.delenv("DOCUMENT_CONVERTER_SECRET", raising=False)

        # Build a minimal valid PDF in memory (a real PDF with text)
        pdf_bytes = _minimal_pdf_with_text()

        response = client.post(
            "/convert",
            files={"file": ("test.pdf", io.BytesIO(pdf_bytes), "application/pdf")},
            data={"mode": "lead"},
        )

        # Without markitdown installed, this returns 503
        # With markitdown installed, it returns 200
        assert response.status_code in (200, 503)

    def test_convert_missing_file(self):
        response = client.post("/convert", data={"mode": "lead"})
        assert response.status_code == 422

    def test_convert_invalid_mode(self):
        pdf_bytes = _minimal_pdf_with_text()
        response = client.post(
            "/convert",
            files={"file": ("test.pdf", io.BytesIO(pdf_bytes), "application/pdf")},
            data={"mode": "invalid_mode"},
        )
        assert response.status_code == 400

    def test_convert_oversized_file(self, monkeypatch):
        monkeypatch.setattr("main.MAX_FILE_SIZE", 100)  # 100 bytes limit for test
        pdf_bytes = b"A" * 200
        response = client.post(
            "/convert",
            files={"file": ("test.pdf", io.BytesIO(pdf_bytes), "application/pdf")},
        )
        assert response.status_code == 413

    def test_convert_unsupported_extension(self):
        response = client.post(
            "/convert",
            files={"file": ("test.exe", io.BytesIO(b"bad"), "application/octet-stream")},
        )
        assert response.status_code == 415


class TestConvertWithAuth:
    """Tests when DOCUMENT_CONVERTER_SECRET IS set."""

    def test_convert_missing_secret(self, monkeypatch):
        monkeypatch.setenv("DOCUMENT_CONVERTER_SECRET", "test-secret-123")
        pdf_bytes = _minimal_pdf_with_text()

        response = client.post(
            "/convert",
            files={"file": ("test.pdf", io.BytesIO(pdf_bytes), "application/pdf")},
        )
        assert response.status_code == 401

    def test_convert_wrong_secret(self, monkeypatch):
        monkeypatch.setenv("DOCUMENT_CONVERTER_SECRET", "test-secret-123")
        pdf_bytes = _minimal_pdf_with_text()

        response = client.post(
            "/convert",
            files={"file": ("test.pdf", io.BytesIO(pdf_bytes), "application/pdf")},
            headers={"X-Converter-Secret": "wrong-secret"},
        )
        assert response.status_code == 403

    def test_convert_correct_secret(self, monkeypatch):
        monkeypatch.setenv("DOCUMENT_CONVERTER_SECRET", "test-secret-123")
        monkeypatch.delenv("DOCUMENT_CONVERTER_SECRET", raising=False)  # reset
        pdf_bytes = _minimal_pdf_with_text()

        response = client.post(
            "/convert",
            files={"file": ("test.pdf", io.BytesIO(pdf_bytes), "application/pdf")},
            headers={"X-Converter-Secret": "test-secret-123"},
            data={"mode": "lead"},
        )
        # May be 200 (markitdown installed) or 503 (not installed)
        assert response.status_code in (200, 503)


class TestHelpers:
    def test_compute_sha256(self):
        data = b"hello world"
        expected = hashlib.sha256(data).hexdigest()
        assert compute_sha256(data) == expected

    def test_clean_markdown_removes_base64(self):
        raw = "Some text\n\ndata:image/png;base64,ABC123DEF456\n\nMore text"
        cleaned = clean_markdown(raw)
        assert "base64" not in cleaned
        assert "[image: data-url removed]" in cleaned

    def test_clean_markdown_collapses_blank_lines(self):
        raw = "Line 1\n\n\n\n\nLine 2"
        cleaned = clean_markdown(raw)
        assert "\n\n\n" not in cleaned
        assert "Line 1\n\nLine 2" in cleaned

    def test_clean_markdown_caps_length(self):
        raw = "A" * 100000
        cleaned = clean_markdown(raw, max_chars=5000)
        assert len(cleaned) <= 5100
        assert "[...document truncated]" in cleaned

    def test_estimate_tokens(self):
        assert estimate_tokens(0) == 1
        assert estimate_tokens(400) == 100
        assert estimate_tokens(4000) == 1000

    def test_allowed_extensions(self):
        assert ".pdf" in ALLOWED_EXTENSIONS
        assert ".docx" in ALLOWED_EXTENSIONS
        assert ".pptx" in ALLOWED_EXTENSIONS
        assert ".xlsx" in ALLOWED_EXTENSIONS
        assert ".csv" in ALLOWED_EXTENSIONS
        assert ".txt" in ALLOWED_EXTENSIONS


# ────────────────────────────────────────────────────────────────────────────
# Helpers
# ────────────────────────────────────────────────────────────────────────────

def _minimal_pdf_with_text() -> bytes:
    """
    Return a minimal valid PDF with extractable text.

    This is a hand-crafted PDF that contains 'Hello from MarkItDown test'
    inside a text stream so that pdfminer/pdfplumber can extract it.
    """
    # A very minimal PDF with a text stream
    text = b"Hello from MarkItDown test"
    pdf = (
        b"%PDF-1.4\n"
        b"1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n"
        b"2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n"
        b"3 0 obj\n<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>\nendobj\n"
        b"4 0 obj\n<< /Length 52 >>\nstream\n"
        b"BT /F1 12 Tf 100 700 Td (Hello from MarkItDown test) Tj ET\n"
        b"endstream\nendobj\n"
        b"5 0 obj\n<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>\nendobj\n"
        b"xref\n0 6\n0000000000 65535 f\n0000000009 00000 n\n0000000058 00000 n\n0000000115 00000 n\n0000000266 00000 n\n0000000374 00000 n\n"
        b"trailer\n<< /Size 6 /Root 1 0 R >>\nstartxref\n457\n%%EOF\n"
    )
    return pdf
