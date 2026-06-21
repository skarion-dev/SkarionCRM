# Document Converter Service

A standalone Python FastAPI service that converts uploaded documents (PDF, DOCX, PPTX, XLSX, CSV, TXT) to Markdown using [Microsoft MarkItDown](https://github.com/microsoft/markitdown). The CRM Worker calls this service before sending document text to Gemini for AI extraction.

## Why a separate service?

- MarkItDown is a Python library (not compatible with Cloudflare Workers' JavaScript runtime)
- Running it as a separate container keeps the Worker lightweight and fast
- The CRM Worker falls back to a basic PDF text extractor if the converter is unavailable, so deploys are not blocked

## Quick Start (Local)

```bash
cd apps/document-converter
python -m venv .venv
source .venv/bin/activate  # Windows: .venv\Scripts\activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

Test:
```bash
curl -X POST http://localhost:8000/health
```

## Docker

```bash
cd apps/document-converter
docker build -t skarion-document-converter .
docker run -p 8000:8000 -e DOCUMENT_CONVERTER_SECRET=your-secret skarion-document-converter
```

## Deployment Options

### Render
1. Create a new Web Service
2. Connect your GitHub repo, root directory: `apps/document-converter`
3. Build command: `pip install -r requirements.txt`
4. Start command: `uvicorn main:app --host 0.0.0.0 --port $PORT`
5. Environment: `DOCUMENT_CONVERTER_SECRET=your-secret`

### Fly.io
```bash
cd apps/document-converter
fly launch --dockerfile Dockerfile
fly secrets set DOCUMENT_CONVERTER_SECRET=your-secret
```

### Railway
1. Create project, connect repo
2. Set root directory: `apps/document-converter`
3. Add environment variable: `DOCUMENT_CONVERTER_SECRET=your-secret`

### Google Cloud Run
```bash
gcloud builds submit --tag gcr.io/your-project/skarion-document-converter
gcloud run deploy skarion-document-converter --image gcr.io/your-project/skarion-document-converter --set-env-vars DOCUMENT_CONVERTER_SECRET=your-secret
```

## API

### POST /convert

Convert an uploaded document to Markdown.

**Headers:**
- `X-Converter-Secret` (optional, required if `DOCUMENT_CONVERTER_SECRET` env is set)

**Form data:**
- `file` (required): The document file
- `mode` (optional): `lead`, `rfp`, `resume`, `general` (default: `general`)

**Response:**
```json
{
  "filename": "resume.pdf",
  "mimeType": "application/pdf",
  "sha256": "abc123...",
  "mode": "lead",
  "markdown": "# John Doe\n\nSoftware Engineer...",
  "markdownPreview": "# John Doe\n\nSoftware Engineer...",
  "charCount": 4521,
  "estimatedTokens": 1130,
  "warnings": []
}
```

## Security

- Shared-secret auth via `X-Converter-Secret` header
- Max file size: 10MB
- Allowed types: PDF, DOCX, PPTX, XLSX, CSV, TXT
- No URL fetching from user input
- Temp files cleaned immediately after conversion
- 30-second timeout on conversion
- Safe error messages (no filesystem paths leaked)

## CRM Integration

After deploying the converter, set these in the CRM Worker:

**Secret (via GitHub Actions / wrangler secret):**
```
DOCUMENT_CONVERTER_SECRET=your-secret
```

**Var (via wrangler.toml or GitHub Actions):**
```toml
[vars]
DOCUMENT_CONVERTER_URL = "https://your-converter-service.example.com"
DOCUMENT_AI_MAX_CHARS = "50000"
```

If `DOCUMENT_CONVERTER_URL` is not set, the CRM Worker falls back to the local PDF text extractor.

## License

MarkItDown is MIT licensed. See: https://github.com/microsoft/markitdown
