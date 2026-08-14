import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from './../src/app.module.js';

describe('HealthController (e2e)', () => {
  let app: INestApplication;

  beforeEach(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
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

  afterEach(async () => {
    await app.close();
  });
});
