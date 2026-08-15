import { NestFactory } from '@nestjs/core';
import { writeFile } from 'node:fs/promises';
import { AppModule } from '../dist/app.module.js';
import { configureApplication } from '../dist/bootstrap.js';
import { createOpenApiDocument } from '../dist/openapi.js';

async function generate() {
  const app = await NestFactory.create(AppModule, {
    logger: ['error'],
    bodyParser: false,
    abortOnError: false,
  });
  configureApplication(app);
  const document = createOpenApiDocument(app);
  await writeFile('openapi.json', `${JSON.stringify(document, null, 2)}\n`);
  await app.close();
  process.stdout.write('Generated openapi.json.\n');
}

generate().catch((error) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack : 'OpenAPI generation failed.'}\n`,
  );
  process.exitCode = 1;
});
