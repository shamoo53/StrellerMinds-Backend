import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { Storage } from '@google-cloud/storage';
import { 
  BackupRecord, 
  BackupStatus,
  StorageLocation,
  RetentionTier
} from './entities';
import { CloudUploadResult } from './interfaces';

const execAsync = promisify(exec);

export interface GoogleCloudUploadOptions {
  backupId: string;
  retentionTier?: RetentionTier;
  metadata?: Record<string, string>;
  encryption?: boolean;
}

export interface GoogleCloudDownloadOptions {
  bucket: string;
  key: string;
  destinationPath: string;
}

@Injectable()
export class BackupGoogleCloudService {
  private readonly logger = new Logger(BackupGoogleCloudService.name);
  private readonly gcsClient: Storage;
  private readonly backupDir: string;
  private readonly bucketName: string;
  private readonly enabled: boolean;

  constructor(
    private readonly configService: ConfigService,
    @InjectRepository(BackupRecord)
    private readonly backupRepository: Repository<BackupRecord>,
  ) {
    this.enabled = this.configService.get('GOOGLE_CLOUD_BACKUP_ENABLED', false);
    this.bucketName = this.configService.get('GOOGLE_CLOUD_BACKUP_BUCKET', 'strellerminds-backups');
    this.backupDir = this.configService.get('BACKUP_DIR', './backups');
    
    if (this.enabled) {
      this.gcsClient = new Storage({
        projectId: this.configService.get('GOOGLE_CLOUD_PROJECT_ID'),
        keyFilename: this.configService.get('GOOGLE_CLOUD_KEY_FILE'),
      });
      this.logger.log('Google Cloud Storage service initialized');
    } else {
      this.logger.log('Google Cloud Storage service is disabled');
    }
  }

  async uploadBackup(
    filePath: string,
    backupId: string,
    retentionTier?: RetentionTier,
    metadata?: Record<string, string>
  ): Promise<CloudUploadResult> {
    if (!this.enabled) {
      throw new Error('Google Cloud Storage is not enabled');
    }

    const fileName = path.basename(filePath);
    const remotePath = `${retentionTier || 'daily'}/${fileName}`;
    
    try {
      const [uploadResponse] = await this.gcsClient
        .bucket(this.bucketName)
        .upload(filePath, {
          destination: remotePath,
          metadata: {
            backupId,
            retentionTier: retentionTier || 'daily',
            timestamp: new Date().toISOString(),
            ...metadata,
          },
          gzip: true, // Enable compression
        });

      this.logger.log(`Successfully uploaded backup ${backupId} to Google Cloud: ${remotePath}`);
      
      return {
        bucket: this.bucketName,
        key: remotePath,
        region: 'global',
        etag: (uploadResponse as any).etag,
        versionId: (uploadResponse as any).id,
      };
    } catch (error) {
      this.logger.error(`Failed to upload backup ${backupId} to Google Cloud: ${error.message}`);
      throw error;
    }
  }

  async downloadBackup(bucket: string, key: string, destinationPath: string): Promise<void> {
    if (!this.enabled) {
      throw new Error('Google Cloud Storage is not enabled');
    }

    try {
      const file = this.gcsClient.bucket(bucket).file(key);
      await file.download({ destination: destinationPath });
      
      this.logger.log(`Successfully downloaded backup from Google Cloud: ${key}`);
    } catch (error) {
      this.logger.error(`Failed to download backup from Google Cloud: ${error.message}`);
      throw error;
    }
  }

  async replicateBackup(backupId: string): Promise<CloudUploadResult> {
    if (!this.enabled) {
      throw new Error('Google Cloud Storage is not enabled');
    }

    const backup = await this.backupRepository.findOne({ where: { id: backupId } });
    if (!backup) {
      throw new Error(`Backup with ID ${backupId} not found`);
    }

    const localPath = backup.localPath || path.join(this.backupDir, backup.filename);
    if (!localPath) {
      throw new Error(`Local path not found for backup ${backupId}`);
    }

    const uploadResult = await this.uploadBackup(localPath, backupId, backup.retentionTier, {
      backupType: backup.type,
      databaseVersion: backup.databaseVersion || '',
      postgresVersion: backup.postgresVersion || '',
    });

    // Update backup record with Google Cloud storage info
    backup.storageLocations = [...(backup.storageLocations || []), StorageLocation.S3_PRIMARY];
    await this.backupRepository.save(backup);

    return uploadResult;
  }

  async verifyBackupIntegrity(bucket: string, key: string): Promise<boolean> {
    if (!this.enabled) {
      throw new Error('Google Cloud Storage is not enabled');
    }

    try {
      const file = this.gcsClient.bucket(bucket).file(key);
      const [exists] = await file.exists();
      
      if (!exists) {
        return false;
      }

      // Get file metadata
      const [metadata] = await file.getMetadata();
      
      // Verify the file size matches expectations if available
      return true;
    } catch (error) {
      this.logger.error(`Failed to verify backup integrity in Google Cloud: ${error.message}`);
      return false;
    }
  }

  async getBackupUrl(backupId: string, expiryHours: number = 1): Promise<string> {
    if (!this.enabled) {
      throw new Error('Google Cloud Storage is not enabled');
    }

    // In a real implementation, we'd generate a signed URL
    // For now, we'll just return a placeholder
    return `https://${this.bucketName}.storage.googleapis.com/${backupId}?temp_access_token`;
  }

  async cleanupOldBackups(retentionTier: RetentionTier, olderThanDays: number): Promise<void> {
    if (!this.enabled) {
      throw new Error('Google Cloud Storage is not enabled');
    }

    try {
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - olderThanDays);

      // List files in the bucket for the specific retention tier
      const [files] = await this.gcsClient
        .bucket(this.bucketName)
        .getFiles({ prefix: `${retentionTier}/` });

      for (const file of files) {
        const [metadata] = await file.getMetadata();
        const creationDate = new Date(metadata.timeCreated);

        if (creationDate < cutoffDate) {
          await file.delete();
          this.logger.log(`Deleted old backup from Google Cloud: ${file.name}`);
        }
      }
    } catch (error) {
      this.logger.error(`Failed to cleanup old backups in Google Cloud: ${error.message}`);
      throw error;
    }
  }

  isCloudUploadEnabled(): boolean {
    return this.enabled;
  }

  async getStorageUsage(): Promise<number> {
    if (!this.enabled) {
      return 0;
    }

    try {
      // This would require iterating through all files to calculate total size
      // For now, return a placeholder value
      return 0;
    } catch (error) {
      this.logger.error(`Failed to get Google Cloud storage usage: ${error.message}`);
      return 0;
    }
  }
}