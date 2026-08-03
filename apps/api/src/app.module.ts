import { Module } from '@nestjs/common';
import { APP_GUARD, APP_INTERCEPTOR } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { HealthModule } from './health/health.module';
import { PrismaModule } from './prisma/prisma.module';
import { AuditModule } from './audit/audit.module';
import { TenancyModule } from './tenancy/tenancy.module';
import { IdentityModule } from './identity/identity.module';
import { CasesModule } from './cases/cases.module';
import { ConsentModule } from './consent/consent.module';
import { BootstrapModule } from './bootstrap/bootstrap.module';
import { SchedulingModule } from './scheduling/scheduling.module';
import { NotificationsModule } from './notifications/notifications.module';
import { PatientModule } from './patient/patient.module';
import { SessionModule } from './session/session.module';
import { StorageModule } from './storage/storage.module';
import { ConclusionModule } from './conclusion/conclusion.module';
import { MisModule } from './mis/mis.module';
import { DossierModule } from './dossier/dossier.module';
import { CatalogModule } from './catalog/catalog.module';
import { AdminModule } from './admin/admin.module';
import { FrontdeskModule } from './frontdesk/frontdesk.module';
import { AuthGuard } from './common/auth.guard';
import { RolesGuard } from './common/roles.guard';
import { PmdAccessAuditInterceptor } from './common/pmd-audit.interceptor';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    PrismaModule,
    HealthModule,
    AuditModule,
    TenancyModule,
    IdentityModule,
    CasesModule,
    ConsentModule,
    NotificationsModule,
    SchedulingModule,
    PatientModule,
    StorageModule,
    SessionModule,
    MisModule,
    ConclusionModule,
    DossierModule,
    CatalogModule,
    AdminModule,
    FrontdeskModule,
    BootstrapModule,
  ],
  providers: [
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: PmdAccessAuditInterceptor },
  ],
})
export class AppModule {}
