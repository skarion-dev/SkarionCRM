import { Text } from '@react-email/components';
import { EmailLayout } from './EmailLayout.js';

export interface MfaEnrolledEmailProps {
  displayName: string;
}

export const mfaEnrolledSubject = 'Two-factor authentication enabled';
export const mfaEnrolledPreheader = 'MFA was just turned on for your Skarion account.';

export function MfaEnrolledEmail({ displayName }: MfaEnrolledEmailProps) {
  return (
    <EmailLayout preheader={mfaEnrolledPreheader}>
      <Text>Hi {displayName},</Text>
      <Text>
        Two-factor authentication was just enabled on your Skarion account. From now on, you'll need
        a code from your authenticator app to log in.
      </Text>
      <Text style={{ fontSize: '13px', color: '#71717a' }}>
        If you didn't make this change, contact your Skarion admin immediately - your account may be
        compromised.
      </Text>
    </EmailLayout>
  );
}
