export type AppName = 'crm' | 'hr' | 'books';

/** Maps each app the user has an active membership in to their role in that app. */
export type AppMembershipsMap = Partial<Record<AppName, string>>;

export interface AccessTokenPayload {
  sub: string;
  email: string;
  apps: AppMembershipsMap;
  ver: number;
  iat: number;
  exp: number;
  // Hono's JWTPayload requires an index signature - this stays structurally
  // typed for the fields above via the explicit properties.
  [key: string]: unknown;
}
