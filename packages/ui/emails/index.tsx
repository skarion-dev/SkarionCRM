// packages/ui/emails/index.tsx
// Renders each transactional email to {subject, preheader, html, text}.
// Plain-text fallbacks are generated automatically by @react-email/render -
// no need to hand-write a text version per template. render()'s package
// exports map auto-selects the Workers-safe "edge" build when bundled by
// wrangler (workerd export condition), so this is safe to call from the
// identity Worker directly.

import { render } from '@react-email/render';
import { InvitationEmail, invitationPreheader, invitationSubject } from './Invitation.js';
import {
  PasswordResetEmail,
  passwordResetPreheader,
  passwordResetSubject,
} from './PasswordReset.js';
import { MfaEnrolledEmail, mfaEnrolledPreheader, mfaEnrolledSubject } from './MfaEnrolled.js';
import {
  WelcomeAfterInviteEmail,
  welcomeAfterInvitePreheader,
  welcomeAfterInviteSubject,
} from './WelcomeAfterInvite.js';

export interface RenderedEmail {
  subject: string;
  preheader: string;
  html: string;
  text: string;
}

async function renderBoth(element: React.ReactElement): Promise<{ html: string; text: string }> {
  const [html, text] = await Promise.all([render(element), render(element, { plainText: true })]);
  return { html, text };
}

export async function renderInvitationEmail(props: {
  inviterName: string;
  appLabel: string;
  acceptUrl: string;
}): Promise<RenderedEmail> {
  const { html, text } = await renderBoth(<InvitationEmail {...props} />);
  return {
    subject: invitationSubject(props.appLabel),
    preheader: invitationPreheader(props.inviterName),
    html,
    text,
  };
}

export async function renderPasswordResetEmail(props: {
  resetUrl: string;
}): Promise<RenderedEmail> {
  const { html, text } = await renderBoth(<PasswordResetEmail {...props} />);
  return { subject: passwordResetSubject, preheader: passwordResetPreheader, html, text };
}

export async function renderMfaEnrolledEmail(props: {
  displayName: string;
}): Promise<RenderedEmail> {
  const { html, text } = await renderBoth(<MfaEnrolledEmail {...props} />);
  return { subject: mfaEnrolledSubject, preheader: mfaEnrolledPreheader, html, text };
}

export async function renderWelcomeAfterInviteEmail(props: {
  displayName: string;
  appLabel: string;
  appUrl: string;
}): Promise<RenderedEmail> {
  const { html, text } = await renderBoth(<WelcomeAfterInviteEmail {...props} />);
  return {
    subject: welcomeAfterInviteSubject(props.appLabel),
    preheader: welcomeAfterInvitePreheader,
    html,
    text,
  };
}

export { InvitationEmail, PasswordResetEmail, MfaEnrolledEmail, WelcomeAfterInviteEmail };
export { EmailLayout } from './EmailLayout.js';
