import express from 'express';
import type { Server } from 'http';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import opsRoutes from '../../src/routes/ops';
import uploadRoutes from '../../src/routes/uploadRoutes';

describe('ops route isolation', () => {
  const originalOpsToken = process.env.OPS_METRICS_TOKEN;
  let server: Server;
  let baseUrl = '';

  const app = express();
  app.use(express.json());
  app.use('/api/ops', opsRoutes);
  app.use('/api', uploadRoutes);

  beforeAll(async () => {
    process.env.OPS_METRICS_TOKEN = 'phase0-test-token';

    server = app.listen(0);
    await new Promise<void>((resolve) => {
      server.once('listening', () => resolve());
    });

    const address = server.address();
    if (!address || typeof address === 'string') {
      throw new Error('failed to bind test server');
    }
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  afterAll(async () => {
    process.env.OPS_METRICS_TOKEN = originalOpsToken;
    if (!server) return;
    await new Promise<void>((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  });

  it('serves control-plane summary without leaking into upload auth middleware', async () => {
    const response = await fetch(`${baseUrl}/api/ops/control-plane/summary`, {
      headers: {
        'x-ops-token': 'phase0-test-token',
      },
    });

    expect(response.status).toBe(200);
    const payload = await response.json();
    expect(payload.success).toBe(true);
    expect(typeof payload.data.summary).toBe('string');
  });

  it('still protects upload routes with user auth', async () => {
    const response = await fetch(`${baseUrl}/api/uploads/demo.txt`);

    expect(response.status).toBe(401);
    const payload = await response.json();
    expect(payload.message).toBe('缺少访问令牌');
  });
});
