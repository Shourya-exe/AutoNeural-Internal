import 'reflect-metadata';
import * as dotenv from 'dotenv';
dotenv.config();

import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import helmet from 'helmet';
import { AppModule } from './app.module';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const app = await NestFactory.create(AppModule);

  const configService = app.get(ConfigService);
  const port = configService.get<number>('PORT') || 3001;

  // Security Headers
  app.use(
    helmet({
      crossOriginResourcePolicy: false,
    }),
  );

  // CORS Configuration
  const allowedOriginsRaw = configService.get<string>('FRONTEND_URL') || 'http://localhost:3000,http://localhost:3100';
  const allowedOrigins = allowedOriginsRaw.split(',').map((url) => url.trim());

  app.enableCors({
    origin: (origin, callback) => {
      // Allow requests with no origin (like mobile apps, curl, Postman)
      if (!origin || allowedOrigins.includes(origin) || origin.startsWith('http://localhost:')) {
        callback(null, true);
      } else {
        callback(null, true); // Permissive in dev, or set false if strict
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

  // Swagger / OpenAPI Setup
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

  await app.listen(port);
  logger.log(`AutoNeural Backend running at http://localhost:${port}/api/v1`);
  logger.log(`Swagger OpenAPI documentation available at http://localhost:${port}/api/docs`);
}

bootstrap();
