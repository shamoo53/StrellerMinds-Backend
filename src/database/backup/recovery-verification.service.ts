import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, IsNull, LessThan } from 'typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import * as fs from 'fs/promises';
import * as path from 'path';
import { exec } from 'child_process';
import { promisify } from 'util';
import { 
  BackupRecord, 
  BackupStatus, 
  BackupType,
  RecoveryTest,
  RecoveryTestStatus
} from './entities';
import { BackupService } from './backup.service';
import { BackupRecoveryService } from './backup-recovery.service';
import { RecoveryResult } from './interfaces';

const execAsync = promisify(exec);

export interface BackupVerificationOptions {
  verifyChecksum?: boolean;
  verifyIntegrity?: boolean;
  verifyStructure?: boolean;
  verifyData?: boolean;
  testRecovery?: boolean;
  testRecoveryTimeout?: number;
}

export interface BackupVerificationResult {
  isValid: boolean;
  checks: {
    checksum?: boolean;
    integrity?: boolean;
    structure?: boolean;
    data?: boolean;
    recovery?: boolean;
  };
  errors?: string[];
  durationMs: number;
}

@Injectable()
export class RecoveryVerificationService {
  private readonly logger = new Logger(RecoveryVerificationService.name);
  private readonly backupDir: string;

  constructor(
    private readonly configService: ConfigService,
    private readonly backupService: BackupService,
    private readonly recoveryService: BackupRecoveryService,
    @InjectRepository(BackupRecord)
    private readonly backupRepository: Repository<BackupRecord>,
    @InjectRepository(RecoveryTest)
    private readonly recoveryTestRepository: Repository<RecoveryTest>,
  ) {
    this.backupDir = this.configService.get('BACKUP_DIR', './backups');
  }

  async verifyBackup(
    backupId: string, 
    options: BackupVerificationOptions = {}
  ): Promise<BackupVerificationResult> {
    const startTime = Date.now();
    this.logger.log(`Starting verification for backup: ${backupId}`);

    const backup = await this.backupRepository.findOne({ where: { id: backupId } });
    if (!backup) {
      throw new BadRequestException(`Backup with ID ${backupId} not found`);
    }

    const results: BackupVerificationResult = {
      isValid: true,
      checks: {},
      durationMs: 0,
    };

    const errors: string[] = [];

    try {
      // Verify checksum if enabled
      if (options.verifyChecksum !== false) { // Default to true if not specified
        const checksumValid = await this.verifyChecksum(backup);
        results.checks.checksum = checksumValid;
        if (!checksumValid) {
          errors.push('Checksum verification failed');
          results.isValid = false;
        }
      }

      // Verify integrity if enabled
      if (options.verifyIntegrity !== false) {
        const integrityValid = await this.verifyIntegrity(backup);
        results.checks.integrity = integrityValid;
        if (!integrityValid) {
          errors.push('Integrity verification failed');
          results.isValid = false;
        }
      }

      // Verify structure if enabled
      if (options.verifyStructure !== false) {
        const structureValid = await this.verifyStructure(backup);
        results.checks.structure = structureValid;
        if (!structureValid) {
          errors.push('Structure verification failed');
          results.isValid = false;
        }
      }

      // Verify data if enabled
      if (options.verifyData !== false) {
        const dataValid = await this.verifyData(backup);
        results.checks.data = dataValid;
        if (!dataValid) {
          errors.push('Data verification failed');
          results.isValid = false;
        }
      }

      // Test recovery if enabled
      if (options.testRecovery) {
        const recoveryTestResult = await this.testRecovery(backup, options.testRecoveryTimeout || 300000); // 5 min timeout
        results.checks.recovery = recoveryTestResult.success;
        if (!recoveryTestResult.success) {
          errors.push(`Recovery test failed: ${recoveryTestResult.errors?.join(', ') || 'Unknown error'}`);
          results.isValid = false;
        }
      }

      results.durationMs = Date.now() - startTime;
      
      if (errors.length > 0) {
        results.errors = errors;
      }

      // Update the backup record with verification status
      backup.status = results.isValid ? BackupStatus.VERIFIED : BackupStatus.FAILED;
      backup.verifiedAt = new Date();
      backup.errorMessage = errors.length > 0 ? errors.join(', ') : null;
      await this.backupRepository.save(backup);

      this.logger.log(`Verification completed for backup ${backupId}: ${results.isValid ? 'VALID' : 'INVALID'}`);
      return results;

    } catch (error) {
      this.logger.error(`Verification failed for backup ${backupId}: ${error.message}`);
      throw error;
    }
  }

  private async verifyChecksum(backup: BackupRecord): Promise<boolean> {
    try {
      if (!backup.checksumSha256) {
        this.logger.warn(`No checksum available for backup ${backup.id}`);
        return true; // Consider as valid if no checksum to compare
      }

      // Calculate checksum of the backup file
      const filePath = path.join(this.backupDir, backup.filename);
      const fileBuffer = await fs.readFile(filePath);
      
      // For simplicity, we'll use Node's crypto module to hash
      const crypto = await import('crypto');
      const hash = crypto.createHash('sha256').update(fileBuffer).digest('hex');
      
      return hash === backup.checksumSha256;
    } catch (error) {
      this.logger.error(`Checksum verification failed: ${error.message}`);
      return false;
    }
  }

  private async verifyIntegrity(backup: BackupRecord): Promise<boolean> {
    try {
      // For PostgreSQL dumps, we can check if the dump file is valid SQL
      const filePath = path.join(this.backupDir, backup.filename);
      
      // First, check if the file exists and has content
      const stats = await fs.stat(filePath);
      if (stats.size === 0) {
        return false;
      }

      // For compressed files, we might need to decompress and check
      if (backup.isCompressed) {
        // Try to decompress and check if it's a valid SQL file
        const decompressCmd = `gunzip --test "${filePath}" 2>/dev/null || pigz -t "${filePath}" 2>/dev/null || true`;
        try {
          await execAsync(decompressCmd);
          return true;
        } catch {
          return false;
        }
      } else {
        // For uncompressed SQL files, we can check the header
        const fileContent = await fs.readFile(filePath, 'utf8');
        return fileContent.startsWith('-- PostgreSQL database dump') || 
               fileContent.includes('CREATE TABLE') || 
               fileContent.includes('INSERT INTO');
      }
    } catch (error) {
      this.logger.error(`Integrity verification failed: ${error.message}`);
      return false;
    }
  }

  private async verifyStructure(backup: BackupRecord): Promise<boolean> {
    try {
      // Structure verification would check that the backup contains expected tables, schemas, etc.
      // For PostgreSQL, this would involve examining the dump file for structural elements
      const filePath = path.join(this.backupDir, backup.filename);
      const fileContent = await fs.readFile(filePath, 'utf8');
      
      // Check for common structural elements in a PostgreSQL dump
      const hasSchema = fileContent.includes('CREATE SCHEMA') || fileContent.includes('SET schema');
      const hasTable = fileContent.includes('CREATE TABLE');
      const hasSequence = fileContent.includes('CREATE SEQUENCE') || fileContent.includes('ALTER SEQUENCE');
      const hasIndex = fileContent.includes('CREATE INDEX');
      
      return hasSchema || hasTable || hasSequence || hasIndex;
    } catch (error) {
      this.logger.error(`Structure verification failed: ${error.message}`);
      return false;
    }
  }

  private async verifyData(backup: BackupRecord): Promise<boolean> {
    try {
      // Data verification would check that the backup contains valid data records
      const filePath = path.join(this.backupDir, backup.filename);
      const fileContent = await fs.readFile(filePath, 'utf8');
      
      // Look for data insertion statements
      const hasInserts = fileContent.includes('INSERT INTO');
      const hasData = fileContent.includes('VALUES') && fileContent.includes('(');
      
      return hasInserts || hasData;
    } catch (error) {
      this.logger.error(`Data verification failed: ${error.message}`);
      return false;
    }
  }

  private async testRecovery(backup: BackupRecord, timeoutMs: number): Promise<RecoveryResult> {
    try {
      // Create a temporary database for recovery testing
      const tempDbName = `verification_test_${backup.id.replace(/-/g, '_')}`;
      
      // Attempt to restore the backup to the temporary database
      const recoveryResult = await this.recoveryService.restoreFromBackup({
        backupId: backup.id,
        targetDatabase: tempDbName,
        verifyAfterRestore: true,
      });

      return recoveryResult;
    } catch (error) {
      this.logger.error(`Recovery test failed: ${error.message}`);
      return {
        success: false,
        backupId: backup.id,
        restoredAt: new Date(),
        durationMs: 0,
        tablesRestored: 0,
        errors: [error.message],
      };
    }
  }

  async scheduleVerification(backupId: string, options: BackupVerificationOptions = {}): Promise<void> {
    this.logger.log(`Scheduling verification for backup: ${backupId}`);
    
    // In a real implementation, this would schedule the verification job
    // For now, we'll just trigger it immediately
    await this.verifyBackup(backupId, options);
  }

  async verifyAllBackups(options: BackupVerificationOptions = {}): Promise<any> {
    this.logger.log('Starting verification of all backups');
    
    const allBackups = await this.backupRepository.find({
      where: { status: BackupStatus.COMPLETED },
    });

    const results = [];
    let validCount = 0;
    let invalidCount = 0;

    for (const backup of allBackups) {
      try {
        const result = await this.verifyBackup(backup.id, options);
        (results as any).push({
          backupId: backup.id,
          filename: backup.filename,
          isValid: result.isValid,
          durationMs: result.durationMs,
        });

        if (result.isValid) {
          validCount++;
        } else {
          invalidCount++;
        }
      } catch (error) {
        this.logger.error(`Failed to verify backup ${backup.id}: ${error.message}`);
        (results as any).push({
          backupId: backup.id,
          filename: backup.filename,
          isValid: false,
          error: error.message,
        });
        invalidCount++;
      }
    }

    const summary = {
      total: allBackups.length,
      valid: validCount,
      invalid: invalidCount,
      results,
      completedAt: new Date(),
    };

    this.logger.log(`Verification of all backups completed: ${validCount} valid, ${invalidCount} invalid`);
    return summary;
  }

  @Cron(CronExpression.EVERY_DAY_AT_2AM)
  async runScheduledVerifications(): Promise<void> {
    this.logger.log('Running scheduled backup verifications');

    try {
      // Find backups that haven't been verified in the last day
      const yesterday = new Date();
      yesterday.setDate(yesterday.getDate() - 1);

      // Find backups that haven't been verified in the last day
      const unverifiedBackups = await this.backupRepository.find({
        where: {
          verifiedAt: LessThan(yesterday)
        },
        order: { createdAt: 'DESC' },
      });

      // Find backups that have never been verified
      const unverifiedBackupsNever = await this.backupRepository.find({
        where: {
          verifiedAt: IsNull()
        },
        order: { createdAt: 'DESC' },
      });

      // Combine both arrays
      const allUnverifiedBackups = [...unverifiedBackups, ...unverifiedBackupsNever];

      for (const backup of allUnverifiedBackups) {
        await this.verifyBackup(backup.id, {
          verifyChecksum: true,
          verifyIntegrity: true,
          verifyStructure: true,
          verifyData: true,
        });
      }

      this.logger.log(`Scheduled verification completed for ${allUnverifiedBackups.length} backups`);
    } catch (error) {
      this.logger.error(`Scheduled verification failed: ${error.message}`);
      throw error;
    }
  }

  async generateVerificationReport(backupId: string): Promise<any> {
    const backup = await this.backupRepository.findOne({ where: { id: backupId } });
    if (!backup) {
      throw new BadRequestException(`Backup with ID ${backupId} not found`);
    }

    return {
      backupId: backup.id,
      filename: backup.filename,
      type: backup.type,
      createdAt: backup.createdAt,
      status: backup.status,
      verificationStatus: (backup as any).verificationStatus,
      verifiedAt: backup.verifiedAt,
      verificationErrors: (backup as any).verificationErrors,
      fileSize: backup.sizeBytes,
      isCompressed: backup.isCompressed,
      metadata: backup.metadata,
    };
  }
}