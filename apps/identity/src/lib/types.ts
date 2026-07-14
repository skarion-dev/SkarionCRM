export type { AppName, AppMembershipsMap } from '@skarion/auth-client';

export interface Env {
  DATABASE_URL: string;
  JWT_SECRET: string;
  RESEND_API_KEY: string;
  MFA_ENCRYPTION_KEY: string;
  INVITATION_TOKEN_PEPPER: string;
  APP_URL: string;
  /** Comma-separated list of email domains allowed for invitations (e.g. "skarion.com,skarionengineering.com"). */
  ALLOWED_INVITE_DOMAINS?: string;
  /** Git branch name, set by deploy workflow. Optional for debug endpoints. */
  GIT_BRANCH?: string;
  /** Git commit SHA, set by deploy workflow. Optional for debug endpoints. */
  GIT_COMMIT_SHA?: string;
}
