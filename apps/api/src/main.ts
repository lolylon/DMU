import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');

  // NFR 4.6 — baseline HTTP hardening
  app.use(
    helmet({
      contentSecurityPolicy: false, // APIs; frontends set their own CSP
      crossOriginResourcePolicy: { policy: 'same-site' },
    }),
  );

  const origins = (process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://localhost:5174,http://localhost:5175')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
  app.enableCors({
    origin: origins,
    credentials: true,
  });

  // Auth / SMS abuse protection (NFR 4.6)
  app.use(
    '/api/auth/login',
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 30,
      standardHeaders: true,
      legacyHeaders: false,
      message: { statusCode: 429, message: 'Too many login attempts' },
    }),
  );
  app.use(
    '/api/patient/auth',
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 40,
      standardHeaders: true,
      legacyHeaders: false,
      message: { statusCode: 429, message: 'Too many auth attempts' },
    }),
  );
  app.use(
    '/api/bootstrap',
    rateLimit({
      windowMs: 60 * 60 * 1000,
      limit: 10,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );

  if (process.env.NODE_ENV === 'production' && process.env.ALLOW_BOOTSTRAP === 'true') {
    // eslint-disable-next-line no-console
    console.error('FATAL: ALLOW_BOOTSTRAP must not be true in production');
    process.exit(1);
  }

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
    }),
  );

  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
  // eslint-disable-next-line no-console
  console.log(`Miru API listening on :${port}`);
}

void bootstrap();
