import { NestFactory } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import { AppModule } from './app.module';
import { assertRuntimeSecrets } from './common/runtime-secrets';

async function bootstrap() {
  assertRuntimeSecrets();

  const app = await NestFactory.create(AppModule);
  app.setGlobalPrefix('api');

  // Behind Caddy/nginx — correct client IP + HTTPS scheme for rate limits / HSTS
  const expressApp = app.getHttpAdapter().getInstance() as {
    set: (k: string, v: unknown) => void;
  };
  expressApp.set('trust proxy', 1);

  // NFR 4.6 — baseline HTTP hardening
  app.use(
    helmet({
      contentSecurityPolicy: false, // APIs; frontends set their own CSP
      crossOriginResourcePolicy: { policy: 'same-site' },
      strictTransportSecurity: {
        maxAge: 31536000,
        includeSubDomains: true,
      },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );

  const origins = (process.env.CORS_ORIGINS ?? 'http://localhost:5173,http://localhost:5174,http://localhost:5175,http://localhost:5177')
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
    '/api/frontdesk/auth',
    rateLimit({
      windowMs: 15 * 60 * 1000,
      limit: 40,
      standardHeaders: true,
      legacyHeaders: false,
      message: { statusCode: 429, message: 'Too many kiosk auth attempts' },
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
