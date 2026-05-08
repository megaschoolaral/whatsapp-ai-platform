import express, { type Express } from 'express';
import http from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import cors from 'cors';
import helmet from 'helmet';
import { Server as SocketServer } from 'socket.io';

import { env } from './env.js';
import { logger } from './logger.js';
import { prisma } from './prisma.js';
import { bootstrapSuperAdmin } from './bootstrap/superAdmin.js';
import { startWorkers } from './queues/workers.js';
import { setIo } from './services/realtime/socketRooms.js';
import { connectTenant } from './services/whatsapp/connect.js';
import { verifyToken } from './auth/jwt.js';

import { healthRouter } from './routes/health.js';
import { authRouter } from './routes/auth.js';
import { adminTenantsRouter } from './routes/admin/tenants.js';
import { adminTenantKeysRouter } from './routes/admin/tenantKeys.js';
import { adminTenantModelsRouter } from './routes/admin/tenantModels.js';
import { adminTenantPersonaRouter } from './routes/admin/tenantPersona.js';
import { adminTenantWhatsappRouter } from './routes/admin/tenantWhatsapp.js';
import { adminTenantKnowledgeRouter } from './routes/admin/tenantKnowledge.js';
import { adminUsageRouter } from './routes/admin/usage.js';
import { tenantInboxRouter } from './routes/tenant/inbox.js';
import { tenantSettingsRouter } from './routes/tenant/settings.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function buildApp(): Express {
  const app = express();
  app.use(helmet({ contentSecurityPolicy: false }));
  app.use(cors({ origin: true, credentials: true }));
  app.use(express.json({ limit: '5mb' }));

  app.use('/api', healthRouter);
  app.use('/api/auth', authRouter);

  app.use('/api/admin/tenants', adminTenantsRouter);
  app.use('/api/admin/tenants/:tenantId/keys', adminTenantKeysRouter);
  app.use('/api/admin/tenants/:tenantId/models', adminTenantModelsRouter);
  app.use('/api/admin/tenants/:tenantId/persona', adminTenantPersonaRouter);
  app.use('/api/admin/tenants/:tenantId/whatsapp', adminTenantWhatsappRouter);
  app.use('/api/admin/tenants/:tenantId/knowledge', adminTenantKnowledgeRouter);
  app.use('/api/admin/usage', adminUsageRouter);

  app.use('/api/tenant', tenantInboxRouter);
  app.use('/api/tenant', tenantSettingsRouter);

  // Static frontend build (production)
  const frontendDist = path.resolve(__dirname, '../../frontend/dist');
  app.use(express.static(frontendDist));
  app.get(/^\/(?!api).*/, (_req, res) => {
    res.sendFile(path.join(frontendDist, 'index.html'));
  });

  app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
    logger.error({ err }, '[express] error');
    res.status(500).json({ error: 'Internal server error' });
  });

  return app;
}

async function main() {
  const app = buildApp();
  const server = http.createServer(app);

  const io = new SocketServer(server, {
    cors: { origin: true, credentials: true },
  });
  io.use((socket, next) => {
    try {
      const token = (socket.handshake.auth?.token as string | undefined) ?? '';
      if (!token) return next(new Error('Unauthorized'));
      const payload = verifyToken(token);
      const tenantId = payload.tenantId ?? (socket.handshake.query.tenantId as string | undefined);
      if (payload.role === 'tenant_admin' && tenantId) socket.join(`tenant-${tenantId}`);
      if (payload.role === 'super_admin') {
        const queryTenant = socket.handshake.query.tenantId as string | undefined;
        if (queryTenant) socket.join(`tenant-${queryTenant}`);
      }
      next();
    } catch (err) {
      next(err as Error);
    }
  });
  io.on('connection', (socket) => {
    socket.on('subscribe:tenant', (tenantId: string) => {
      // super-admin only — controlled client-side; rooms broadcast tenant data
      socket.join(`tenant-${tenantId}`);
    });
  });
  setIo(io);

  await bootstrapSuperAdmin();
  startWorkers();

  // Reconnect any tenants that were active before restart
  const activeTenants = await prisma.tenant.findMany({
    where: { status: 'active' },
    include: { whatsappSession: true },
  });
  for (const t of activeTenants) {
    if (t.whatsappSession?.encryptedCreds) {
      connectTenant(t.id).catch((err) => logger.error({ err, tenantId: t.id }, 'auto-reconnect failed'));
    }
  }

  server.listen(env.PORT, () => {
    logger.info({ port: env.PORT, env: env.NODE_ENV }, '[server] listening');
  });

  const shutdown = async () => {
    logger.info('[server] shutting down');
    server.close();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[server] fatal:', err);
  process.exit(1);
});
