import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module.js';
import { configureApplication } from './bootstrap.js';
import type { Environment } from './common/config/environment.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, {
    bufferLogs: true,
    bodyParser: false,
  });
  app.useLogger(app.get(Logger));
  configureApplication(app);
  const config = app.get(ConfigService<Environment, true>);
  await app.listen(config.getOrThrow('PORT', { infer: true }));
}

bootstrap().catch((error: unknown) => {
  process.stderr.write(
    `${error instanceof Error ? error.stack : 'Application failed to start.'}\n`,
  );
  process.exitCode = 1;
});
