# Document Converter Pipeline Implementation Plan

## Stage 1: Document Converter Service (`apps/document-converter`)
- FastAPI app with `POST /convert` endpoint
- `markitdown[pdf,docx,pptx,xlsx]` dependency
- Shared-secret auth (`X-Converter-Secret` header)
- File validation: size ≤ 10MB, MIME whitelist, extension check
- `convert_stream()` with `io.BytesIO` — no filesystem access to user paths
- Temp file cleanup, timeout wrapper (30s)
- Return: filename, mimeType, sha256, markdown, preview, charCount, estimatedTokens, warnings
- Dockerfile (Python 3.11 slim)
- `requirements.txt` with pinned versions
- Unit tests with pytest + sample text PDF

## Stage 2: CRM Backend Updates
- Add `DOCUMENT_CONVERTER_URL` and `DOCUMENT_CONVERTER_SECRET` to wrangler.toml
- Add `document_imports` table to schema (file hash, filename, mime, preview, status, leadId)
- Create `convertDocument()` helper in `apps/crm/src/lib/document-converter.ts`
- Create `cleanMarkdownForAi()` helper (strip whitespace, remove base64/data URLs, cap to 50000 chars)
- Modify `/api/leads/import/pdf` → `/api/leads/import/document` (keep old route as alias)
- Route flow: validate file → call converter (if configured) → clean markdown → send to AI → merge results
- Fallback to `extractTextFromPdf()` if converter fails or not configured
- Add `DOCUMENT_AI_MAX_CHARS` env var (default 50000)
- Generate migration for `document_imports` table

## Stage 3: Frontend Updates
- Keep `PdfImportModal` component name but accept more file types
- Show conversion warnings and estimated token count in review step
- Show "Document converted to Markdown" status indicator
- Keep existing UI flow (upload → review → confirm)

## Stage 4: Tests
- Document converter: pytest tests with mock/stream conversion
- CRM backend: mock converter success/failure scenarios
- Update smoke test to check converter if URL configured

## Stage 5: Deployment Docs
- Docker build and run instructions
- Render/Fly/Railway/Cloud Run deployment notes
- GitHub workflow only if deployment target is chosen
- Add to `docs/DEPLOYMENT_STATUS.md`

## Stage 6: Verification
- `pnpm typecheck` across monorepo
- `pnpm build` for CRM web
- `python -m pytest` for document converter
- Confirm CRM deploy still passes (no regression)
