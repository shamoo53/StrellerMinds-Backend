import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';
import { ConfigModule } from '@nestjs/config';

import { BackupService } from './backup.service';
import { EnhancedBackupService } from './enhanced-backup.service';
import { DisasterRecoveryTestingService } from './disaster-recovery-testing.service';
import { RecoveryVerificationService } from './recovery-verification.service';
import { BackupGoogleCloudService } from './backup-google-cloud.service';
import { BackupSchedulerService } from './backup-scheduler.service';
import { BackupEncryptionService } from './backup-encryption.service';
import { BackupCloudStorageService } from './backup-cloud-storage.service';
import { BackupRecoveryService } from './backup-recovery.service';
import { BackupNotificationService } from './backup-notification.service';
import { BackupMetricsService } from './backup-metrics.service';
import { BackupMonitoringService } from './backup-monitoring.service';
import { BackupController } from './backup.controller';

import { BackupRecord, BackupSchedule, RecoveryTest } from './entities';

@Module({
  imports: [
    ConfigModule,
    HttpModule,
    TypeOrmModule.forFeature([BackupRecord, BackupSchedule, RecoveryTest]),
  ],
  controllers: [BackupController],
  providers: [
    BackupEncryptionService,
    BackupCloudStorageService,
    BackupMetricsService,
    BackupNotificationService,
    BackupService,
    BackupSchedulerService,
    BackupRecoveryService,
    EnhancedBackupService,
    DisasterRecoveryTestingService,
    RecoveryVerificationService,
    BackupGoogleCloudService,
  ],
  exports: [
    BackupService,
    BackupSchedulerService,
    BackupRecoveryService,
    BackupMetricsService,
    EnhancedBackupService,
    DisasterRecoveryTestingService,
    RecoveryVerificationService,
    BackupGoogleCloudService,
  ],
})
export class BackupModule {}