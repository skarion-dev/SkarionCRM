// packages/ui/emails/EmailLayout.tsx
// Shared chrome for every transactional email: logo header + footer.
// LOGO_URL should point at the real R2-hosted asset once R2 is provisioned;
// using a placeholder Cloudflare-style path now so it's a one-line swap later.

import {
  Body,
  Container,
  Head,
  Hr,
  Html,
  Img,
  Preview,
  Section,
  Text,
} from '@react-email/components';
import type { ReactNode } from 'react';

const LOGO_URL = 'https://assets.skarion.com/logo.png'; // TODO(ticket 1.8/R2): replace with real R2-hosted asset URL

export interface EmailLayoutProps {
  preheader: string;
  children: ReactNode;
}

export function EmailLayout({ preheader, children }: EmailLayoutProps) {
  return (
    <Html>
      <Head />
      <Preview>{preheader}</Preview>
      <Body style={styles.body}>
        <Container style={styles.container}>
          <Section style={styles.header}>
            <Img src={LOGO_URL} width="120" height="32" alt="Skarion" />
          </Section>
          <Section style={styles.content}>{children}</Section>
          <Hr style={styles.hr} />
          <Section>
            <Text style={styles.footer}>
              Skarion &middot; This is a transactional email related to your account activity.
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

const styles = {
  body: {
    backgroundColor: '#f4f4f5',
    fontFamily: 'Helvetica, Arial, sans-serif',
    padding: '24px 0',
  },
  container: {
    backgroundColor: '#ffffff',
    maxWidth: '480px',
    margin: '0 auto',
    borderRadius: '8px',
    padding: '32px',
  },
  header: { marginBottom: '24px' },
  content: { color: '#18181b', fontSize: '15px', lineHeight: '24px' },
  hr: { borderColor: '#e4e4e7', margin: '24px 0' },
  footer: { color: '#a1a1aa', fontSize: '12px', lineHeight: '18px' },
};
