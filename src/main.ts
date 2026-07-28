import { ClassSerializerInterceptor, ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory, Reflector } from '@nestjs/core';
import { NestExpressApplication } from '@nestjs/platform-express';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { json, urlencoded } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import {
  assertProductionSecrets,
  buildHelmetOptions,
  parseCorsOrigins,
} from './common/security/security-config';

async function bootstrap() {
  // rawBody: true — requis pour vérifier la signature du webhook Stripe
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });
  const configService = app.get(ConfigService);
  const nodeEnv = configService.get<string>('NODE_ENV', 'development');
  const port = Number(configService.get<string>('PORT', '8989'));

  // 0. Garde-fous production (secrets / CORS) avant d’écouter
  assertProductionSecrets({
    NODE_ENV: nodeEnv,
    JWT_SECRET: configService.get<string>('JWT_SECRET'),
    JWT_REFRESH_SECRET: configService.get<string>('JWT_REFRESH_SECRET'),
    CORS_ORIGINS: configService.get<string>('CORS_ORIGINS'),
  });

  // 1. Ne pas exposer Express / Nest dans les headers
  app.disable('x-powered-by');

  // 2. Helmet (CSP, frameguard, nosniff, HSTS en prod…)
  app.use(helmet(buildHelmetOptions(nodeEnv)));

  // 3. Limiter la taille des body JSON (auth / API) — uploads binaires = routes dédiées plus tard
  app.use(json({ limit: '100kb' }));
  app.use(urlencoded({ extended: false, limit: '100kb' }));

  // 4. Validation stricte des DTOs
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  // 5. Sérialisation sortante
  app.useGlobalInterceptors(new ClassSerializerInterceptor(app.get(Reflector)));

  // 6. CORS explicite (jamais * en production — contrôlé ci-dessus)
  const origins = parseCorsOrigins(configService.get<string>('CORS_ORIGINS'));
  app.enableCors({
    origin: origins.length > 0 ? origins : false,
    credentials: false,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Authorization', 'Content-Type', 'Accept'],
  });

  // 7. Swagger uniquement hors production
  if (nodeEnv !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('Himba API')
      .setDescription('API streaming musical Himba (MVP)')
      .setVersion('0.1')
      .addBearerAuth()
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('docs', app, document);
  }

  await app.listen(port, () => {
    console.log(`Server is running on port ${port}`);
  });
}
bootstrap();
