import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';
import { configureApplication } from './../src/bootstrap.js';
import { RedisThrottlerStorage } from './../src/common/rate-limiting/redis-throttler.storage.js';
import { randomUUID } from 'node:crypto';

describe('HealthController (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication({ bodyParser: false });
    app.useLogger(false);
    configureApplication(app);
    await app.init();
  });

  it('/health/live (GET)', () => {
    return request(app.getHttpServer() as Parameters<typeof request>[0])
      .get('/health/live')
      .expect(200)
      .expect(({ body }: { body: { status?: string } }) => {
        expect(body.status).toBe('up');
      });
  });

  it('/health/ready (GET) probes critical dependencies', () => {
    return request(app.getHttpServer() as Parameters<typeof request>[0])
      .get('/health/ready')
      .expect(200)
      .expect(
        ({
          body,
        }: {
          body: {
            status?: string;
            checks?: { name: string; status: string }[];
          };
        }) => {
          expect(body.status).toBe('up');
          expect(body.checks).toEqual([
            expect.objectContaining({ name: 'database', status: 'up' }),
            expect.objectContaining({ name: 'redis', status: 'up' }),
            expect.objectContaining({ name: 'evidenceStorage', status: 'up' }),
            expect.objectContaining({ name: 'malwareScanner', status: 'up' }),
          ]);
        },
      );
  });

  it('protects and exposes Prometheus-compatible operational metrics', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];

    await request(server).get('/metrics').expect(401);
    const response = await request(server)
      .get('/metrics')
      .set('Authorization', 'Bearer qualyra_local_metrics_token')
      .expect('content-type', /text\/plain/)
      .expect(200);

    expect(response.text).toContain('qualyra_http_requests_total');
    expect(response.text).toContain(
      'qualyra_dependency_ready{dependency="redis"} 1',
    );
    expect(response.text).not.toContain('qualyra-demo');
  });

  it('enforces a shared rate-limit window atomically in Redis', async () => {
    const storage = app.get(RedisThrottlerStorage);
    const key = randomUUID();

    await expect(
      storage.increment(key, 60_000, 2, 30_000, 'e2e'),
    ).resolves.toMatchObject({
      totalHits: 1,
      isBlocked: false,
    });
    await expect(
      storage.increment(key, 60_000, 2, 30_000, 'e2e'),
    ).resolves.toMatchObject({
      totalHits: 2,
      isBlocked: false,
    });
    await expect(
      storage.increment(key, 60_000, 2, 30_000, 'e2e'),
    ).resolves.toMatchObject({
      totalHits: 3,
      isBlocked: true,
    });
  });

  it('publishes the safe onboarding policy', () => {
    return request(app.getHttpServer() as Parameters<typeof request>[0])
      .get('/api/v1/auth/registration-policy')
      .expect(200)
      .expect({
        publicCompanyRegistrationEnabled: true,
        existingOrganizationMembership: 'INVITATION_ONLY',
      });
  });

  it('sets browser hardening headers', async () => {
    const response = await request(
      app.getHttpServer() as Parameters<typeof request>[0],
    )
      .get('/health/live')
      .expect(200);

    expect(response.headers['content-security-policy']).toEqual(
      expect.any(String),
    );
    expect(response.headers['x-content-type-options']).toBe('nosniff');
    expect(response.headers['x-frame-options']).toBe('SAMEORIGIN');
  });

  it('allows only configured CORS origins', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];

    await request(server)
      .get('/health/live')
      .set('Origin', 'http://localhost:5173')
      .expect('access-control-allow-origin', 'http://localhost:5173')
      .expect(200);

    const rejected = await request(server)
      .get('/health/live')
      .set('Origin', 'https://malicious.example')
      .expect(200);
    expect(rejected.headers['access-control-allow-origin']).toBeUndefined();
  });

  it('returns generic errors without echoing credentials or stack traces', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];
    const validation = await request(server)
      .post('/api/v1/auth/login')
      .send({
        tenant: 'x',
        email: 'private-email-value',
        password: 'private-password-value',
        unexpected: 'private-extra-value',
      })
      .expect(400);

    expect(JSON.stringify(validation.body)).not.toMatch(
      /private-email-value|private-password-value|private-extra-value|stack/i,
    );

    const missing = await request(server).get('/not-a-route').expect(404);
    expect(missing.body).toMatchObject({
      statusCode: 404,
      code: 'NOT_FOUND',
      message: 'The requested resource was not found.',
    });
    expect(JSON.stringify(missing.body)).not.toMatch(/stack|exception/i);
  });

  afterEach(async () => {
    await app.close();
  });
});
