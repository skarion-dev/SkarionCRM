export type { AppName, AppMembershipsMap } from '@skarion/auth-client';

export interface Env {
  DATABASE_URL: string;
  JWT_SECRET: string;
  RESEND_API_KEY: string;
  MFA_ENCRYPTION_KEY: string;
  INVITATION_TOKEN_PEPPER: string;
  APP_URL: string;
}
