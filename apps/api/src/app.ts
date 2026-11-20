import cors from '@fastify/cors';
import Fastify, { type FastifyError, type FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import type { Db } from './db/client.js';
import { registerEntryRoutes } from './routes/entries.js';
import { registerHealthRoute } from './routes/health.js';

export interface BuildAppOptions {
  db: Db;
  /** Long-lived Cache-Control in production; no-cache otherwise. Defaults to false. */
  production?: boolean;
}

function errorShape(code: string, message: string): { error: { code: string; message: string } } {
  return { error: { code, message } };
}

/** Maps an HTTP status code to a stable error code for thrown errors. */
function codeForStatus(statusCode: number): string {
  if (statusCode === 400) return 'VALIDATION_ERROR';
  if (statusCode === 404) return 'NOT_FOUND';
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
    },
    { prefix: '/api' },
  );

  return app;
}
