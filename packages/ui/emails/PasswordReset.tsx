import { Button, Text } from '@react-email/components';
import { EmailLayout } from './EmailLayout.js';

export interface PasswordResetEmailProps {
  resetUrl: string;
}

export const passwordResetSubject = 'Reset your Skarion password';
export const passwordResetPreheader = 'Use this link to reset your password.';

export function PasswordResetEmail({ resetUrl }: PasswordResetEmailProps) {
  return (
    <EmailLayout preheader={passwordResetPreheader}>
      <Text>We received a request to reset your Skarion password.</Text>
      <Button
        href={resetUrl}
        style={{
          backgroundColor: '#18181b',
          color: '#ffffff',
          padding: '12px 24px',
          borderRadius: '6px',
          fontSize: '15px',
          textDecoration: 'none',
        }}
      >
        Reset password
      </Button>
      <Text style={{ fontSize: '13px', color: '#71717a' }}>
        This link expires in 1 hour. If you didn't request this, you can safely ignore this email -
        your password won't be changed.
      </Text>
    </EmailLayout>
  );
}
