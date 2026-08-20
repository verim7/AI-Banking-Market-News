import type { UserContext } from './rbac.ts';

export interface Env {
  DB: D1Database;
  SESSION_SECRET: string;
  ASSETS: { fetch: (req: Request) => Promise<Response> };
}

export interface Vars {
  user: UserContext;
}

export type AppEnv = { Bindings: Env; Variables: Vars };
