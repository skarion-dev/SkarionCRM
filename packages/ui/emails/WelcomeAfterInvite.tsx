import { Button, Text } from '@react-email/components';
import { EmailLayout } from './EmailLayout.js';

export interface WelcomeAfterInviteEmailProps {
  displayName: string;
  appLabel: string;
  appUrl: string;
}

export const welcomeAfterInviteSubject = (appLabel: string) => `Welcome to Skarion ${appLabel}`;
export const welcomeAfterInvitePreheader = "You're all set up - here's where to get started.";

export function WelcomeAfterInviteEmail({
  displayName,
  appLabel,
  appUrl,
}: WelcomeAfterInviteEmailProps) {
  return (
    <EmailLayout preheader={welcomeAfterInvitePreheader}>
      <Text>Welcome, {displayName}!</Text>
      <Text>
        Your Skarion {appLabel} account is ready. You can log in and get started right away.
      </Text>
      <Button
        href={appUrl}
        style={{
          backgroundColor: '#18181b',
          color: '#ffffff',
          padding: '12px 24px',
          borderRadius: '6px',
          fontSize: '15px',
          textDecoration: 'none',
        }}
      >
        Go to {appLabel}
      </Button>
    </EmailLayout>
  );
}
