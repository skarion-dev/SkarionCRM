// packages/auth-client/src/email.ts
// Resend HTTP API sender - plain fetch, no SDK dependency, guaranteed
// Workers-compatible. Callers pass already-rendered {subject, html, text}
// (see @skarion/ui/emails) so this module stays render-agnostic.

export interface SendEmailParams {
  to: string;
  subject: string;
  html: string;
  text: string;
  from?: string;
}

export interface SendEmailResult {
  id: string;
}

const DEFAULT_FROM = 'Skarion <noreply@notify.skarion.com>';

export async function sendEmail(apiKey: string, params: SendEmailParams): Promise<SendEmailResult> {
  if (!apiKey) {
    throw new Error('RESEND_API_KEY is not configured.');
  }

  const response = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      from: params.from ?? DEFAULT_FROM,
      to: [params.to],
      subject: params.subject,
      html: params.html,
      text: params.text,
    }),
  });

  if (!response.ok) {
    const body = await response.text().catch(() => '');
    // Never include the API key in error messages/logs.
    throw new Error(`Resend API error (${response.status}): ${body.slice(0, 500)}`);
  }

  const data = (await response.json()) as { id: string };
  return { id: data.id };
}
