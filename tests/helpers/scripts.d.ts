/**
 * The database CLI helpers are plain ESM (`.mjs`) shared with `scripts/db.mjs`.
 * They are intentionally untyped JavaScript, so the test setup declares the
 * surface it uses rather than annotating the scripts themselves.
 */
declare module '*/scripts/lib/env.mjs' {
  export type DatabaseSettings = {
    host: string;
    port: number;
    name: string;
    testName: string;
    superuser: string;
    superuserPassword: string;
    appUser: string;
    appPassword: string;
    adminUrl: string;
    appUrl: string;
  };

  export function loadEnvFile(path?: string): void;
  export function databaseSettings(): DatabaseSettings;
}

declare module '*/scripts/lib/postgres.mjs' {
  import type { Client } from 'pg';
  import type { DatabaseSettings } from '*/scripts/lib/env.mjs';

  export function resolvePostgresBinDir(): string;
  export function isInitialised(settings?: DatabaseSettings): boolean;
  export function isRunning(settings?: DatabaseSettings): boolean;
  export function initialise(settings?: DatabaseSettings): void;
  export function start(settings?: DatabaseSettings): Promise<boolean>;
  export function stop(settings?: DatabaseSettings): void;
  export function ensureDatabaseAndRoles(
    client: Client,
    settings?: DatabaseSettings
  ): Promise<void>;
  export function migrate(client: Client, settings?: DatabaseSettings): Promise<string[]>;
  export function assertAdminCanBypassRls(client: Client): Promise<void>;
}
