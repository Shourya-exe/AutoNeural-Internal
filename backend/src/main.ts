import 'reflect-metadata';
import * as dotenv from 'dotenv';
// Same files and precedence as ConfigModule (.env first).
dotenv.config({ path: ['.env', '.env.local'] });

import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { assertAuthConfig } from './common/config/secrets';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  // Fail fast on unsafe auth configuration, before anything listens.
  assertAuthConfig({ get: (key: string) => process.env[key] });

  const app = await NestFactory.create(AppModule);
  // Run onModuleDestroy (Prisma disconnect) on SIGTERM/SIGINT.
  app.enableShutdownHooks();

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT') || 3001;
  const production = process.env.NODE_ENV === 'production';

  // Security Headers
  app.use(
    helmet({
      crossOriginResourcePolicy: false,
    }),
  );

  // CORS: only the configured frontends (FRONTEND_URL, comma separated). Requests without an
  // Origin header (server-to-server, e.g. the web app's backend proxy) are not browser requests.
  const allowedOrigins = (configService.get<string>('FRONTEND_URL') || 'http://localhost:3000,http://localhost:3002')
    .split(',')
    .map((url) => url.trim().replace(/\/+$/, ''))
    .filter(Boolean);
  app.enableCors({
    origin: (origin, callback) => {
      if (!origin || allowedOrigins.includes(origin) || (!production && /^http:\/\/localhost:\d+$/.test(origin))) {
        callback(null, true);
      } else {
        callback(null, false);
      }
    },
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Requested-With'],
  });

  // Global Prefix
  app.setGlobalPrefix('api/v1');

  // Request Validation & Sanitization
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Interactive API docs: always in development, in production only when ENABLE_SWAGGER=true.
  const swagger = !production || configService.get<string>('ENABLE_SWAGGER') === 'true';
  if (swagger) {
    const config = new DocumentBuilder()
      .setTitle('AutoNeural Task Management API')
      .setDescription(
        'Enterprise RESTful API for task management, employee orchestration, audit trails, and multi-tenant organization workspaces.',
      )
      .setVersion('1.0.0')
      .addBearerAuth(
        {
          type: 'http',
          scheme: 'bearer',
          bearerFormat: 'JWT',
          name: 'JWT',
          description: 'Enter JWT Access Token',
          in: 'header',
        },
        'access-token',
      )
      .addTag('Authentication', 'User login, token refresh, registration, and password management')
      .addTag('Employees', 'Admin employee management, deactivation, and performance metrics')
      .addTag('Tasks', 'Task creation, multi-employee assignment, status transitions, and progress tracking')
      .addTag('Task Activities', 'Audit trails and historical timeline of task changes')
      .addTag('Comments', 'Discussion threads between admins and assignees')
      .addTag('Notifications', 'In-app notification system')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup('api/docs', app, document, {
      customSiteTitle: 'AutoNeural CRM API Docs',
    });
  }

  await app.listen(port);
  logger.log(`AutoNeural Backend running at http://localhost:${port}/api/v1`);
  if (swagger) logger.log(`Swagger OpenAPI documentation available at http://localhost:${port}/api/docs`);
}

bootstrap().catch((err) => {
  new Logger('Bootstrap').error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
