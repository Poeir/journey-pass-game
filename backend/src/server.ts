import Fastify from 'fastify';
import cors from '@fastify/cors';
import secureSession from '@fastify/secure-session';
import websocket from '@fastify/websocket';
import multipart from '@fastify/multipart';
import rateLimit from '@fastify/rate-limit';
import compress from '@fastify/compress';
import swagger from '@fastify/swagger';
import swaggerUi from '@fastify/swagger-ui';
import { env, isProd } from './config.js';
import { authRoutes } from './routes/auth.js';
import { devAuthRoutes } from './routes/devAuth.js';
import { missionRoutes } from './routes/missions.js';
import { scanRoutes } from './routes/scans.js';
import { penaltyRoutes } from './routes/penalty.js';
import { chatRoutes } from './routes/chat.js';
import { completionRoutes } from './routes/completion.js';
import { memoryRoutes } from './routes/memories.js';
import { photoPlaceRoutes } from './routes/photoPlaces.js';
import { adminAuthRoutes } from './routes/adminAuth.js';
import { adminRoutes } from './routes/admin.js';
import { pairSocketRoutes } from './ws/pair.js';
import { userSocketRoutes } from './ws/user.js';
import { startHeartbeat } from './ws/hub.js';


async function buildApp() {
  const app = Fastify({
    logger: isProd
      ? { level: 'info' }
      : {
          transport: {
            target: 'pino-pretty',
            options: {
              colorize: true,
              translateTime: 'HH:MM:ss.l',
              ignore: 'pid,hostname,reqId',
              singleLine: false,
            },
          },
        },
    disableRequestLogging: false,
    // Drop half-open / slow-loris connections so they don't pin sockets while
    // 200 users are connecting. Cloudinary uploads (penalty + memories) can
    // genuinely take ~10s on slow networks, so requestTimeout is generous.
    connectionTimeout: 30_000,
    keepAliveTimeout: 30_000,
    requestTimeout: 60_000,
  });

  const crossSiteCookie = env.FRONTEND_ORIGIN.startsWith('https://');

  await app.register(cors, {
    origin: env.FRONTEND_ORIGIN,
    credentials: true,
  });

  await app.register(secureSession, {
    key: Buffer.from(env.SESSION_SECRET, 'hex'),
    cookieName: 'jp_sess',
    cookie: {
      httpOnly: true,
      sameSite: crossSiteCookie ? 'none' : 'lax',
      secure: crossSiteCookie,
      path: '/',
      maxAge: 60 * 60 * 8,
    },
  });

  await app.register(websocket);

  await app.register(multipart, {
    limits: { fileSize: 8 * 1024 * 1024, files: 1 },
  });

  // gzip projector JSON (200-photo memory wall is the big one). Skip brotli
  // to keep CPU cost predictable on a 1-vCPU dyno; threshold 1024 bytes
  // avoids over-compressing tiny scan/auth responses.
  await app.register(compress, {
    threshold: 1024,
    encodings: ['gzip', 'deflate'],
    global: true,
  });

  // Global default cap to soak up runaway clients. Per-route limits below override
  // for hot paths. Skips the projector polling routes (cached, public).
  await app.register(rateLimit, {
    global: false,
    max: 300,
    timeWindow: '1 minute',
  });

  // Surface abnormal responses even when default request logging is off.
  // Keeps prod log volume low (warn+) but exposes 4xx/5xx and slow requests.
  app.addHook('onResponse', async (req, reply) => {
    const status = reply.statusCode;
    const ms = reply.elapsedTime;
    if (status >= 500) {
      req.log.error(
        { method: req.method, url: req.url, status, ms, ip: req.ip },
        'server error',
      );
    } else if (status >= 400) {
      req.log.warn(
        { method: req.method, url: req.url, status, ms, ip: req.ip },
        'client error',
      );
    } else if (ms > 2000) {
      req.log.warn(
        { method: req.method, url: req.url, status, ms },
        'slow request',
      );
    }
  });

  await app.register(swagger, {
    openapi: {
      info: {
        title: 'Journey Pass API',
        description:
          'Backend API for the Journey Pass game. Authentication uses a secure session cookie (`jp_sess`) issued after the Azure Entra ID OIDC flow at `GET /api/auth/azure/login` → `GET /api/auth/azure/callback`.',
        version: '0.1.0',
      },
      servers: [{ url: '/', description: 'Current host' }],
      tags: [
        { name: 'Auth', description: 'Login, logout, and current session info' },
        { name: 'Missions', description: 'Mission start endpoints' },
        { name: 'Scans', description: 'QR scan processing' },
        { name: 'Penalty', description: 'Trivia penalty confirmation' },
        { name: 'Chat', description: 'Pair chat messages' },
        { name: 'Completion', description: 'Player completion tracking' },
        { name: 'Memories', description: 'Memory photos taken on success' },
        { name: 'Admin', description: 'Admin portal endpoints (gate is currently a no-op placeholder)' },
        { name: 'WebSocket', description: 'Realtime channels (documented for reference; not invokable from Swagger UI)' },
        { name: 'System', description: 'Health and infra endpoints' },
      ],
      components: {
        securitySchemes: {
          sessionCookie: {
            type: 'apiKey',
            in: 'cookie',
            name: 'jp_sess',
            description: 'Secure session cookie set by the Azure SSO callback at GET /api/auth/azure/callback',
          },
        },
      },
    },
  });

  await app.register(swaggerUi, {
    routePrefix: '/docs',
    uiConfig: {
      docExpansion: 'list',
      deepLinking: true,
    },
  });

  await app.register(
    async (api) => {
      await api.register(authRoutes);
      // Dev-only login bypass. config.ts has already enforced that this flag
      // cannot be true in production, so no extra guard needed here.
      if (env.DEV_LOGIN_ENABLED) {
        await api.register(devAuthRoutes);
      }
      await api.register(missionRoutes);
      await api.register(scanRoutes);
      await api.register(penaltyRoutes);
      await api.register(chatRoutes);
      await api.register(completionRoutes);
      await api.register(memoryRoutes);
      await api.register(photoPlaceRoutes);
      // adminAuth must register BEFORE adminRoutes — adminRoutes wires
      // requireAdmin as a preHandler hook, which would otherwise gate the
      // login endpoint itself and lock everyone out.
      await api.register(adminAuthRoutes);
      await api.register(adminRoutes);
      await api.register(pairSocketRoutes);
      await api.register(userSocketRoutes);
    },
    { prefix: '/api' },
  );

  app.get(
    '/health',
    {
      schema: {
        tags: ['System'],
        summary: 'Liveness probe',
        response: {
          200: {
            type: 'object',
            properties: { ok: { type: 'boolean' } },
            required: ['ok'],
          },
        },
      },
    },
    async () => ({ ok: true }),
  );

  await app.ready();

  // Reap dead WS sockets every 30s — covers mobile users dropping off without
  // a clean close (NAT timeout, app backgrounded, wifi swap).
  startHeartbeat();

  return app;
}

buildApp()
  .then((app) => app.listen({ port: env.PORT, host: '0.0.0.0' }))
  .catch((err) => {
    console.error(err);
    process.exit(1);
  });
