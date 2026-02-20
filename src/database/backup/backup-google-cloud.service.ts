import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
<<<<<<< HEAD
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
=======
import { Storage, Bucket, File } from '@google-cloud/storage';
import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import { Readable } from 'stream';
import { pipeline } from 'stream/promises';
import { CloudUploadResult } from './interfaces';
import { RetentionTier } from './entities';
>>>>>>> 95a4953bf20bc5be8bab23a742a748db194a70b5

@Injectable()
export class BackupGoogleCloudService {
  private readonly logger = new Logger(BackupGoogleCloudService.name);
<<<<<<< HEAD
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
=======
  private readonly storage: Storage;
  private readonly primaryBucket: Bucket;
  private readonly replicaBucket: Bucket | null;
  private readonly cloudUploadEnabled: boolean;
  private readonly crossRegionEnabled: boolean;
  private readonly projectId: string;
  private readonly primaryLocation: string;
  private readonly replicaLocation: string;

  constructor(private readonly configService: ConfigService) {
    this.cloudUploadEnabled = this.configService.get<boolean>(
      'BACKUP_GOOGLE_CLOUD_UPLOAD_ENABLED',
      false,
    );
    this.crossRegionEnabled = this.configService.get<boolean>(
      'BACKUP_GOOGLE_CLOUD_CROSS_REGION_REPLICATION',
      false,
    );

    this.projectId = this.configService.get('GOOGLE_CLOUD_PROJECT_ID', '');
    this.primaryLocation = this.configService.get(
      'GOOGLE_CLOUD_BACKUP_LOCATION',
      'us-central1',
    );
    this.replicaLocation = this.configService.get(
      'GOOGLE_CLOUD_BACKUP_REPLICA_LOCATION',
      'us-west1',
    );

    // Initialize Google Cloud Storage client
    const credentialsPath = this.configService.get('GOOGLE_APPLICATION_CREDENTIALS');
    const credentials = credentialsPath ? require(credentialsPath) : undefined;

    this.storage = new Storage({
      projectId: this.projectId,
      credentials,
      keyFilename: credentialsPath,
    });

    // Initialize buckets
    const primaryBucketName = this.configService.get(
      'GOOGLE_CLOUD_BACKUP_BUCKET',
      'strellerminds-backups',
    );
    this.primaryBucket = this.storage.bucket(primaryBucketName);

    if (this.crossRegionEnabled) {
      const replicaBucketName = this.configService.get(
        'GOOGLE_CLOUD_BACKUP_REPLICA_BUCKET',
        'strellerminds-backups-replica',
      );
      this.replicaBucket = this.storage.bucket(replicaBucketName);
    } else {
      this.replicaBucket = null;
    }

    this.logger.log(
      `Google Cloud Storage initialized: primary=${this.primaryLocation}/${primaryBucketName}, ` +
        `replica=${this.crossRegionEnabled ? `${this.replicaLocation}/${this.replicaBucket?.name}` : 'disabled'}`,
    );
  }

  isCloudUploadEnabled(): boolean {
    return this.cloudUploadEnabled;
  }

  isCrossRegionEnabled(): boolean {
    return this.crossRegionEnabled && this.replicaBucket !== null;
>>>>>>> 95a4953bf20bc5be8bab23a742a748db194a70b5
  }

  async uploadBackup(
    filePath: string,
    backupId: string,
<<<<<<< HEAD
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
=======
    tier: RetentionTier = RetentionTier.DAILY,
    metadata?: Record<string, string>,
  ): Promise<CloudUploadResult> {
    const startTime = Date.now();
    const key = this.generateGCSKey(backupId, tier);

    this.logger.log(`Uploading backup to Google Cloud Storage: ${key}`);

    try {
      const [file] = await this.primaryBucket.upload(filePath, {
        destination: key,
        metadata: {
          contentType: 'application/octet-stream',
          metadata: {
            ...metadata,
            backupId,
            tier,
            uploadedAt: new Date().toISOString(),
          },
        },
        resumable: false,
        gzip: true,
      });

      const duration = Date.now() - startTime;
      this.logger.log(
        `Backup uploaded to Google Cloud Storage in ${duration}ms: ${this.primaryBucket.name}/${key}`,
      );

      return {
        bucket: this.primaryBucket.name,
        key,
        region: this.primaryLocation,
        etag: file.metadata.etag || '',
        versionId: file.metadata.generation?.toString(),
      };
    } catch (error) {
      this.logger.error(`Failed to upload backup to Google Cloud Storage: ${error.message}`);
>>>>>>> 95a4953bf20bc5be8bab23a742a748db194a70b5
      throw error;
    }
  }

<<<<<<< HEAD
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
=======
  async uploadBackupStream(
    stream: Readable,
    backupId: string,
    size: number,
    tier: RetentionTier = RetentionTier.DAILY,
    metadata?: Record<string, string>,
  ): Promise<CloudUploadResult> {
    const key = this.generateGCSKey(backupId, tier);

    this.logger.log(`Uploading backup stream to Google Cloud Storage: ${key}`);

    try {
      const file = this.primaryBucket.file(key);
      
      const writeStream = file.createWriteStream({
        metadata: {
          contentType: 'application/octet-stream',
          metadata: {
            ...metadata,
            backupId,
            tier,
            uploadedAt: new Date().toISOString(),
          },
        },
        resumable: false,
        gzip: true,
      });

      await pipeline(stream, writeStream);

      return {
        bucket: this.primaryBucket.name,
        key,
        region: this.primaryLocation,
        etag: file.metadata.etag || '',
        versionId: file.metadata.generation?.toString(),
      };
    } catch (error) {
      this.logger.error(`Failed to upload backup stream to Google Cloud Storage: ${error.message}`);
>>>>>>> 95a4953bf20bc5be8bab23a742a748db194a70b5
      throw error;
    }
  }

<<<<<<< HEAD
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
=======
  async downloadBackup(
    key: string,
    localPath: string,
    fromReplica: boolean = false,
  ): Promise<void> {
    const bucket = fromReplica && this.replicaBucket ? this.replicaBucket : this.primaryBucket;
    
    this.logger.log(`Downloading backup from Google Cloud Storage: ${key} to ${localPath}`);

    try {
      const file = bucket.file(key);
      const writeStream = fsSync.createWriteStream(localPath);
      
      await pipeline(
        file.createReadStream(),
        writeStream
      );

      this.logger.log(`Backup downloaded successfully: ${localPath}`);
    } catch (error) {
      this.logger.error(`Failed to download backup from Google Cloud Storage: ${error.message}`);
      throw error;
    }
  }

  async deleteBackup(key: string, fromReplica: boolean = false): Promise<void> {
    const bucket = fromReplica && this.replicaBucket ? this.replicaBucket : this.primaryBucket;
    
    this.logger.log(`Deleting backup from Google Cloud Storage: ${key}`);

    try {
      await bucket.file(key).delete();
      this.logger.log(`Backup deleted successfully: ${key}`);
    } catch (error) {
      this.logger.error(`Failed to delete backup from Google Cloud Storage: ${error.message}`);
      throw error;
    }
  }

  async getBackupMetadata(key: string, fromReplica: boolean = false): Promise<any> {
    const bucket = fromReplica && this.replicaBucket ? this.replicaBucket : this.primaryBucket;
    
    try {
      const [metadata] = await bucket.file(key).getMetadata();
      return metadata;
    } catch (error) {
      this.logger.error(`Failed to get backup metadata from Google Cloud Storage: ${error.message}`);
      throw error;
    }
  }

  async listBackups(
    prefix?: string,
    fromReplica: boolean = false,
  ): Promise<Array<{ key: string; size: number; modified: Date }>> {
    const bucket = fromReplica && this.replicaBucket ? this.replicaBucket : this.primaryBucket;
    
    try {
      const [files] = await bucket.getFiles({
        prefix,
      });

      return files.map((file: File) => ({
        key: file.name,
        size: Number(file.metadata.size || '0'),
        modified: new Date(file.metadata.updated || ''),
      }));
    } catch (error) {
      this.logger.error(`Failed to list backups from Google Cloud Storage: ${error.message}`);
      throw error;
    }
  }

  async replicateCrossRegion(sourceKey: string): Promise<CloudUploadResult> {
    if (!this.replicaBucket) {
      throw new Error('Cross-region replication is not enabled');
    }

    const startTime = Date.now();
    this.logger.log(`Replicating backup to cross-region: ${sourceKey}`);

    try {
      const sourceFile = this.primaryBucket.file(sourceKey);
      const destinationFile = this.replicaBucket.file(sourceKey);

      // Copy file from primary to replica bucket
      await sourceFile.copy(destinationFile);

      const duration = Date.now() - startTime;
      this.logger.log(
        `Backup replicated to cross-region in ${duration}ms: ${this.replicaBucket.name}/${sourceKey}`,
      );

      const [metadata] = await destinationFile.getMetadata();

      return {
        bucket: this.replicaBucket.name,
        key: sourceKey,
        region: this.replicaLocation,
        etag: metadata.etag || '',
        versionId: metadata.generation?.toString(),
      };
    } catch (error) {
      this.logger.error(`Failed to replicate backup to cross-region: ${error.message}`);
      throw error;
    }
  }

  async verifyBackupIntegrity(key: string, expectedChecksum: string): Promise<boolean> {
    try {
      const file = this.primaryBucket.file(key);
      const [metadata] = await file.getMetadata();
      
      // Compare with stored checksum
      const storedChecksum = metadata.metadata?.checksum;
      return storedChecksum === expectedChecksum;
    } catch (error) {
      this.logger.error(`Failed to verify backup integrity: ${error.message}`);
>>>>>>> 95a4953bf20bc5be8bab23a742a748db194a70b5
      return false;
    }
  }

<<<<<<< HEAD
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
=======
  async getStorageUsage(): Promise<{ totalBytes: number; fileCount: number }> {
    try {
      const [files] = await this.primaryBucket.getFiles();
      
      let totalBytes = 0;
      const fileCount = files.length;

      for (const file of files) {
        totalBytes += Number(file.metadata.size || '0');
      }

      return { totalBytes, fileCount };
    } catch (error) {
      this.logger.error(`Failed to get storage usage: ${error.message}`);
>>>>>>> 95a4953bf20bc5be8bab23a742a748db194a70b5
      throw error;
    }
  }

<<<<<<< HEAD
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
=======
  private generateGCSKey(backupId: string, tier: RetentionTier): string {
    const date = new Date();
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const timestamp = date.toISOString().replace(/[:.]/g, '-');

    return `${tier}/${year}/${month}/${day}/${backupId}-${timestamp}.sql.gz`;
>>>>>>> 95a4953bf20bc5be8bab23a742a748db194a70b5
  }
}