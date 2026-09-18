import type { UserContext } from './rbac.ts';

export interface Env {
  DB: D1Database;
  SESSION_SECRET: string;
  /**
   * Optional. Lets an operator read the full /api/health diagnosis before any
   * account exists — which is exactly the window where that diagnosis matters
   * most and no session can be produced. Unset means "session only", which is
   * the safe default.
   */
  SETUP_TOKEN?: string;
  ASSETS: { fetch: (req: Request) => Promise<Response> };
}

export interface Vars {
  user: UserContext;
}

export type AppEnv = { Bindings: Env; Variables: Vars };
