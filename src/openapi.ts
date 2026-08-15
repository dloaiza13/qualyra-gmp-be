import type { INestApplication } from '@nestjs/common';
import {
  DocumentBuilder,
  SwaggerModule,
  type OpenAPIObject,
} from '@nestjs/swagger';

export function createOpenApiDocument(app: INestApplication): OpenAPIObject {
  const configuration = new DocumentBuilder()
    .setTitle('Qualyra GMP API')
    .setDescription('Secure multi-tenant quality management API.')
    .setVersion('1.0.0')
    .addBearerAuth()
    .addCookieAuth('qualyra_refresh')
    .build();
  return SwaggerModule.createDocument(app, configuration);
}
