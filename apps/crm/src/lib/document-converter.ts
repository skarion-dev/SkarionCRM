/**
 * CRM Document Converter Client
 *
 * Calls the external MarkItDown-based document converter service.
 * Falls back to local PDF text extraction if the converter is unavailable.
 *
 * Security:
 * - Shared-secret auth via X-Converter-Secret header
 * - No URL fetching — only multipart file uploads
 * - 30-second timeout
 */

interface ConverterEnv {
  DOCUMENT_CONVERTER_URL?: string;
  DOCUMENT_CONVERTER_SECRET?: string;
  DOCUMENT_AI_MAX_CHARS?: string;
}
export interface ConverterResult {
  filename: string;
  mimeType: string;
  sha256: string;
  mode: string;
  markdown: string;
  markdownPreview: string;
  charCount: number;
  estimatedTokens: number;
  warnings: string[];
}

export interface ConversionFailure {
  usedFallback: true;
  fallbackReason: string;
  rawText: string;
  rawTextPreview: string;
}

export type ConvertDocumentResult = ConverterResult | ConversionFailure;

/**
 * Send a file to the document converter service and return Markdown.
 * Falls back to the local PDF text extractor if the converter fails
 * or is not configured.
 */
export async function convertDocument(
  fileBytes: Uint8Array,
  filename: string,
  mimeType: string,
  env: ConverterEnv,
  mode: string = "general"
): Promise<ConvertDocumentResult> {
  const url = env.DOCUMENT_CONVERTER_URL;
  const secret = env.DOCUMENT_CONVERTER_SECRET;

  // If converter is not configured, fall back immediately
  if (!url) {
    return {
      usedFallback: true,
      fallbackReason: "DOCUMENT_CONVERTER_URL not configured",
      rawText: "",
      rawTextPreview: "",
    };
  }

  try {
    const form = new FormData();
    form.append("file", new Blob([fileBytes], { type: mimeType }), filename);
    form.append("mode", mode);

    const headers: Record<string, string> = {};
    if (secret) {
      headers["X-Converter-Secret"] = secret;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30_000); // 30s

    const response = await fetch(`${url}/convert`, {
      method: "POST",
      body: form,
      headers,
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      const body = (await response.json().catch(() => ({ error: response.statusText }))) as { error?: string; detail?: string };
      console.error(`[DocumentConverter] HTTP ${response.status}:`, body.error || body.detail || response.statusText);
      return {
        usedFallback: true,
        fallbackReason: `Converter returned ${response.status}: ${body.error || body.detail || response.statusText}`,
        rawText: "",
        rawTextPreview: "",
      };
    }

    const result = (await response.json()) as ConverterResult;

    // Validate result shape
    if (typeof result.markdown !== "string") {
      return {
        usedFallback: true,
        fallbackReason: "Converter returned invalid response (missing markdown)",
        rawText: "",
        rawTextPreview: "",
      };
    }

    return result;
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    console.error("[DocumentConverter] Error:", reason);
    return {
      usedFallback: true,
      fallbackReason: `Converter error: ${reason}`,
      rawText: "",
      rawTextPreview: "",
    };
  }
}
