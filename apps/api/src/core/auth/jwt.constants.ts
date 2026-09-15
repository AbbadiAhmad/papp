import { Logger } from '@nestjs/common';

const logger = new Logger('JwtConfig');
let warned = false;

/**
 * There is no ConfigModule wired up yet (out of Phase 1 scope), so this
 * reads `JWT_SECRET` from the environment directly, the same way
 * `DATABASE_URL` is read elsewhere in this codebase (main.ts,
 * MigrationRunnerService, PrismaService). Falls back to a fixed,
 * clearly-labelled development secret so the app still boots locally/in
 * tests without extra setup — real deployments must set JWT_SECRET.
 */
export function getJwtSecret(): string {
  const secret = process.env.JWT_SECRET;
  if (secret && secret.length > 0) {
    return secret;
  }
  if (!warned) {
    logger.warn(
      'JWT_SECRET is not set in the environment — falling back to an insecure ' +
        'development default. Set JWT_SECRET before deploying anywhere real.',
    );
    warned = true;
  }
  return 'dev-insecure-jwt-secret-change-me';
}

export const REFRESH_TOKEN_COOKIE_NAME = 'papp_refresh_token';
