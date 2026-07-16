import React from 'react';
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
import {
  TaskDueReminderEmail,
  taskDueReminderPreheader,
  taskDueReminderSubject,
} from './TaskDueReminder.js';
import { LeadAssignedEmail, leadAssignedPreheader, leadAssignedSubject } from './LeadAssigned.js';
import {
  OpportunityStageChangedEmail,
  opportunityStageChangedPreheader,
  opportunityStageChangedSubject,
} from './OpportunityStageChanged.js';
import { LoginCodeEmail, loginCodePreheader, loginCodeSubject } from './LoginCode.js';

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

export async function renderTaskDueReminder(props: {
  assigneeName: string;
  taskTitle: string;
  dueDate: string;
  taskUrl: string;
}): Promise<RenderedEmail> {
  const { html, text } = await renderBoth(<TaskDueReminderEmail {...props} />);
  return {
    subject: taskDueReminderSubject(props.taskTitle),
    preheader: taskDueReminderPreheader,
    html,
    text,
  };
}

export async function renderLeadAssigned(props: {
  assigneeName: string;
  leadName: string;
  leadEmail: string;
  source: string;
  leadUrl: string;
}): Promise<RenderedEmail> {
  const { html, text } = await renderBoth(<LeadAssignedEmail {...props} />);
  return {
    subject: leadAssignedSubject(props.leadName),
    preheader: leadAssignedPreheader,
    html,
    text,
  };
}

export async function renderOpportunityStageChanged(props: {
  ownerName: string;
  opportunityName: string;
  oldStage: string;
  newStage: string;
  amount?: string;
  opportunityUrl: string;
}): Promise<RenderedEmail> {
  const { html, text } = await renderBoth(<OpportunityStageChangedEmail {...props} />);
  return {
    subject: opportunityStageChangedSubject(props.opportunityName, props.newStage),
    preheader: opportunityStageChangedPreheader,
    html,
    text,
  };
}

export async function renderLoginCodeEmail(props: {
  code: string;
  expiresInMinutes: number;
}): Promise<RenderedEmail> {
  const { html, text } = await renderBoth(<LoginCodeEmail {...props} />);
  return {
    subject: loginCodeSubject,
    preheader: loginCodePreheader,
    html,
    text,
  };
}

export { InvitationEmail, PasswordResetEmail, MfaEnrolledEmail, WelcomeAfterInviteEmail };
export { TaskDueReminderEmail, LeadAssignedEmail, OpportunityStageChangedEmail, LoginCodeEmail };
export { EmailLayout } from './EmailLayout.js';
