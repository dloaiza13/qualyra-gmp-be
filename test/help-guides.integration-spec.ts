import 'dotenv/config';
import { type INestApplication } from '@nestjs/common';
import { Test, type TestingModule } from '@nestjs/testing';
import request, { type Response } from 'supertest';
import { AppModule } from '../src/app.module.js';
import { configureApplication } from '../src/bootstrap.js';

const runDatabaseIntegration = process.env.RUN_DATABASE_INTEGRATION === 'true';
const describeDatabase = runDatabaseIntegration ? describe : describe.skip;

interface AuthenticationBody {
  accessToken: string;
}

interface PublishedGuideBody {
  key: string;
  source: 'SYSTEM' | 'TENANT';
  version: number;
  titleEs: string;
  viewerFeedback: boolean | null;
}

interface RevisionBody {
  version: number;
  status: 'DRAFT' | 'PUBLISHED' | 'RETIRED';
  titleEs: string;
}

interface ManagedGuideBody {
  id: string;
  key: string;
  draft: RevisionBody | null;
  published: RevisionBody | null;
  history: RevisionBody[];
  archivedAt: string | null;
}

describeDatabase('Contextual help guides', () => {
  let app: INestApplication;
  const suffix = `${Date.now()}-${Math.floor(Math.random() * 1_000_000)}`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();
    app = moduleFixture.createNestApplication({ bodyParser: false });
    app.useLogger(false);
    configureApplication(app);
    await app.init();
  });

  afterAll(async () => app.close());

  it('keeps published help available while a new draft is prepared', async () => {
    const server = app.getHttpServer() as Parameters<typeof request>[0];
    const authentication = await registerCompany(server, `help-${suffix}`);
    const authorization = bearer(authentication.accessToken);

    const initial = bodyAs<PublishedGuideBody[]>(
      await request(server)
        .get('/api/v1/help-guides/context/DOCUMENTS')
        .set(authorization)
        .expect(200),
    );
    expect(initial).toHaveLength(1);
    expect(initial[0]).toMatchObject({
      key: 'system:documents',
      source: 'SYSTEM',
      version: 1,
    });

    const created = bodyAs<ManagedGuideBody>(
      await request(server)
        .post('/api/v1/help-guides')
        .set(authorization)
        .send(guideInput('Manual documental del sitio'))
        .expect(201),
    );
    expect(created.draft).toMatchObject({
      version: 1,
      status: 'DRAFT',
      titleEs: 'Manual documental del sitio',
    });
    expect(created.published).toBeNull();

    const published = bodyAs<ManagedGuideBody>(
      await request(server)
        .post(`/api/v1/help-guides/${created.id}/publish`)
        .set(authorization)
        .expect(200),
    );
    expect(published.draft).toBeNull();
    expect(published.published).toMatchObject({
      version: 1,
      status: 'PUBLISHED',
    });

    const contextual = bodyAs<PublishedGuideBody[]>(
      await request(server)
        .get('/api/v1/help-guides/context/DOCUMENTS')
        .set(authorization)
        .expect(200),
    );
    expect(contextual.map(({ source }) => source)).toEqual([
      'TENANT',
      'SYSTEM',
    ]);
    expect(contextual[0]).toMatchObject({
      key: created.key,
      version: 1,
      titleEs: 'Manual documental del sitio',
      viewerFeedback: null,
    });

    await request(server)
      .post(`/api/v1/help-guides/${encodeURIComponent(created.key)}/feedback`)
      .set(authorization)
      .send({ helpful: true })
      .expect(200, { accepted: true, helpful: true });

    const withFeedback = bodyAs<PublishedGuideBody[]>(
      await request(server)
        .get('/api/v1/help-guides/context/DOCUMENTS')
        .set(authorization)
        .expect(200),
    );
    expect(withFeedback[0]?.viewerFeedback).toBe(true);

    const edited = bodyAs<ManagedGuideBody>(
      await request(server)
        .patch(`/api/v1/help-guides/${created.id}`)
        .set(authorization)
        .send({
          titleEs: 'Manual documental actualizado',
          titleEn: 'Updated document manual',
        })
        .expect(200),
    );
    expect(edited.published).toMatchObject({
      version: 1,
      titleEs: 'Manual documental del sitio',
    });
    expect(edited.draft).toMatchObject({
      version: 2,
      titleEs: 'Manual documental actualizado',
    });

    const whileDrafting = bodyAs<PublishedGuideBody[]>(
      await request(server)
        .get('/api/v1/help-guides/context/DOCUMENTS')
        .set(authorization)
        .expect(200),
    );
    expect(whileDrafting[0]).toMatchObject({
      version: 1,
      titleEs: 'Manual documental del sitio',
    });

    const versionTwo = bodyAs<ManagedGuideBody>(
      await request(server)
        .post(`/api/v1/help-guides/${created.id}/publish`)
        .set(authorization)
        .expect(200),
    );
    expect(versionTwo.published).toMatchObject({
      version: 2,
      titleEs: 'Manual documental actualizado',
    });
    expect(versionTwo.history).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ version: 2, status: 'PUBLISHED' }),
        expect.objectContaining({ version: 1, status: 'RETIRED' }),
      ]),
    );

    const archived = bodyAs<ManagedGuideBody>(
      await request(server)
        .post(`/api/v1/help-guides/${created.id}/archive`)
        .set(authorization)
        .expect(200),
    );
    expect(archived.archivedAt).not.toBeNull();
    expect(archived.published).toBeNull();

    const afterArchive = bodyAs<PublishedGuideBody[]>(
      await request(server)
        .get('/api/v1/help-guides/context/DOCUMENTS')
        .set(authorization)
        .expect(200),
    );
    expect(afterArchive.map(({ key }) => key)).toEqual(['system:documents']);
  }, 60_000);
});

function guideInput(titleEs: string) {
  return {
    context: 'DOCUMENTS',
    slug: `manual-documental-${Date.now()}`,
    sortOrder: 10,
    titleEs,
    titleEn: 'Site document manual',
    summaryEs:
      'Instrucciones específicas para administrar documentos en este sitio.',
    summaryEn: 'Site-specific instructions for managing controlled documents.',
    stepsEs: [
      'Crear el documento.',
      'Solicitar revisión.',
      'Publicar la versión.',
    ],
    stepsEn: [
      'Create the document.',
      'Request review.',
      'Publish the version.',
    ],
    mediaUrl: null,
    videoUrl: null,
    resourceLabelEs: null,
    resourceLabelEn: null,
    resourceUrl: null,
  };
}

async function registerCompany(
  server: Parameters<typeof request>[0],
  slug: string,
): Promise<AuthenticationBody> {
  return bodyAs<AuthenticationBody>(
    await request(server)
      .post('/api/v1/auth/register-company')
      .send({
        tenantName: `Company ${slug}`,
        tenantSlug: slug,
        adminName: 'Tenant Administrator',
        email: `admin-${slug}@example.test`,
        password: 'Administration passphrase! 2026',
      })
      .expect(201),
  );
}

function bearer(accessToken: string): Record<string, string> {
  return { Authorization: `Bearer ${accessToken}` };
}

function bodyAs<T>(response: Response): T {
  return response.body as T;
}
