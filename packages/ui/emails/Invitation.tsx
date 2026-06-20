import { Button, Text } from '@react-email/components';
import { EmailLayout } from './EmailLayout.js';

export interface InvitationEmailProps {
  inviterName: string;
  appLabel: string; // e.g. "CRM", "Employee Portal", "Books"
  acceptUrl: string;
}

export const invitationSubject = (appLabel: string) => `You're invited to Skarion ${appLabel}`;
export const invitationPreheader = (inviterName: string) =>
  `${inviterName} invited you to join Skarion.`;

export function InvitationEmail({ inviterName, appLabel, acceptUrl }: InvitationEmailProps) {
  return (
    <EmailLayout preheader={invitationPreheader(inviterName)}>
      <Text>Hi,</Text>
      <Text>
        <strong>{inviterName}</strong> has invited you to join <strong>Skarion {appLabel}</strong>.
      </Text>
      <Button
        href={acceptUrl}
        style={{
          backgroundColor: '#18181b',
          color: '#ffffff',
          padding: '12px 24px',
          borderRadius: '6px',
          fontSize: '15px',
          textDecoration: 'none',
        }}
      >
        Accept invitation
      </Button>
      <Text style={{ fontSize: '13px', color: '#71717a' }}>
        This invitation expires in 7 days. If you weren't expecting this, you can safely ignore it.
      </Text>
    </EmailLayout>
  );
}
