import cors from '@fastify/cors';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import type { Db } from './db/client.js';
import { registerAccountRoutes, type AccountRouteOptions } from './routes/account.js';
import { registerEntryRoutes } from './routes/entries.js';
import { registerHealthRoute } from './routes/health.js';

export interface BuildAppOptions {
  db: Db;
  /**
   * Long-lived Cache-Control on content and a Secure session cookie in
   * production; no-cache and a plain cookie otherwise. Defaults to false.
   */
  production?: boolean;
  /** Clock for the registration date check; injectable for tests. */
  now?: () => Date;
  /** Overrides for the global account rate limits; injectable for tests. */
  rateLimits?: AccountRouteOptions['rateLimits'];
}

function errorShape(code: string, message: string): { error: { code: string; message: string } } {
  return { error: { code, message } };
}

/** Maps an HTTP status code to a stable error code for thrown errors. */
function codeForStatus(statusCode: number): string {
  if (statusCode === 400) return 'VALIDATION_ERROR';
  if (statusCode === 401) return 'UNAUTHENTICATED';
  if (statusCode === 404) return 'NOT_FOUND';
  if (statusCode === 413) return 'PAYLOAD_TOO_LARGE';
  if (statusCode === 429) return 'RATE_LIMITED';
  if (statusCode === 409) return 'CONFLICT';
  if (statusCode >= 400 && statusCode < 500) return 'BAD_REQUEST';
  return 'INTERNAL_ERROR';
}

export async function buildApp(options: BuildAppOptions): Promise<FastifyInstance> {
  const app = Fastify({ logger: false });

  await app.register(cors, { origin: true });

  app.setNotFoundHandler((request, reply) => {
    reply
      .code(404)
      .send(errorShape('NOT_FOUND', `Route ${request.method}:${request.url} not found`));
  });

  app.setErrorHandler<FastifyError | ZodError>((err, _request, reply) => {
    if (err instanceof ZodError) {
      reply.code(400).send(errorShape('VALIDATION_ERROR', err.message));
      return;
    }
    const statusCode = err.statusCode ?? 500;
    reply.code(statusCode).send(errorShape(codeForStatus(statusCode), err.message));
  });

  await app.register(
    async (instance) => {
      await registerHealthRoute(instance);
      await registerEntryRoutes(instance, options.db, { production: options.production ?? false });
      // Its own plugin scope, so its no-store hook never touches the
      // cacheable content routes.
      await instance.register(async (account) => {
        await registerAccountRoutes(account, options.db, {
          production: options.production ?? false,
          ...(options.now && { now: options.now }),
          ...(options.rateLimits && { rateLimits: options.rateLimits }),
        });
      });
    },
    { prefix: '/api' },
  );

  return app;
}
