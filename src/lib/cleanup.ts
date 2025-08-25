/**
 * Data Cleanup & Retention
 * Enforces data retention policies and manages storage cleanup
 */

import * as cron from 'node-cron';

interface RetentionPolicy {
  dataType: string;
  retentionDays: number;
  archiveBeforeDelete: boolean;
  encryptArchive: boolean;
}

interface CleanupResult {
  dataType: string;
  recordsProcessed: number;
  recordsDeleted: number;
  recordsArchived: number;
  errors: string[];
  executionTime: number;
}

interface DataRecord {
  id: string;
  createdAt: Date;
  dataType: string;
  customerId?: string;
  size: number;
  metadata?: Record<string, any>;
}

class DataCleanupManager {
  private retentionPolicies: Map<string, RetentionPolicy> = new Map();
  private cleanupHistory: CleanupResult[] = [];
  private isRunning = false;
  private scheduledJobs: Map<string, cron.ScheduledTask> = new Map();

  constructor() {
    this.initializeDefaultPolicies();
    this.scheduleCleanupJobs();
  }

  /**
   * Initialize default retention policies
   */
  private initializeDefaultPolicies(): void {
    const defaultPolicies: RetentionPolicy[] = [
      {
        dataType: 'raw_messages',
        retentionDays: parseInt(process.env.DATA_RETENTION_DAYS || '365'),
        archiveBeforeDelete: true,
        encryptArchive: true
      },
      {
        dataType: 'processed_messages',
        retentionDays: 730, // 2 years
        archiveBeforeDelete: true,
        encryptArchive: true
      },
      {
        dataType: 'attachments',
        retentionDays: 365, // 1 year
        archiveBeforeDelete: true,
        encryptArchive: true
      },
      {
        dataType: 'ai_responses',
        retentionDays: 1095, // 3 years for learning purposes
        archiveBeforeDelete: true,
        encryptArchive: false
      },
      {
        dataType: 'audit_logs',
        retentionDays: 2555, // 7 years for compliance
        archiveBeforeDelete: true,
        encryptArchive: true
      },
      {
        dataType: 'customer_sessions',
        retentionDays: 90, // 3 months
        archiveBeforeDelete: false,
        encryptArchive: false
      },
      {
        dataType: 'rate_limit_records',
        retentionDays: 30, // 1 month
        archiveBeforeDelete: false,
        encryptArchive: false
      },
      {
        dataType: 'idempotency_records',
        retentionDays: 7, // 1 week
        archiveBeforeDelete: false,
        encryptArchive: false
      }
    ];

    defaultPolicies.forEach(policy => {
      this.retentionPolicies.set(policy.dataType, policy);
    });

    console.log(`📋 Initialized ${defaultPolicies.length} retention policies`);
  }

  /**
   * Schedule cleanup jobs
   */
  private scheduleCleanupJobs(): void {
    // Daily cleanup at 2 AM
    const dailyCleanup = cron.schedule('0 2 * * *', async () => {
      console.log('🕐 Starting scheduled daily cleanup...');
      await this.runFullCleanup();
    }, {
      scheduled: false,
      timezone: 'UTC'
    });

    // Weekly deep cleanup on Sundays at 3 AM
    const weeklyCleanup = cron.schedule('0 3 * * 0', async () => {
      console.log('🕐 Starting scheduled weekly deep cleanup...');
      await this.runDeepCleanup();
    }, {
      scheduled: false,
      timezone: 'UTC'
    });

    // Monthly archive cleanup on 1st of month at 4 AM
    const monthlyArchive = cron.schedule('0 4 1 * *', async () => {
      console.log('🕐 Starting scheduled monthly archive cleanup...');
      await this.runArchiveCleanup();
    }, {
      scheduled: false,
      timezone: 'UTC'
    });

    this.scheduledJobs.set('daily', dailyCleanup);
    this.scheduledJobs.set('weekly', weeklyCleanup);
    this.scheduledJobs.set('monthly', monthlyArchive);

    // Start the jobs
    dailyCleanup.start();
    weeklyCleanup.start();
    monthlyArchive.start();

    console.log('⏰ Cleanup jobs scheduled successfully');
  }

  /**
   * Run full cleanup for all data types
   */
  async runFullCleanup(): Promise<CleanupResult[]> {
    if (this.isRunning) {
      console.warn('⚠️ Cleanup already in progress, skipping...');
      return [];
    }

    this.isRunning = true;
    const results: CleanupResult[] = [];

    try {
      console.log('🧹 Starting full cleanup process...');
      
      for (const [dataType, policy] of this.retentionPolicies) {
        try {
          const result = await this.cleanupDataType(dataType, policy);
          results.push(result);
          
          // Add delay between cleanups to avoid overwhelming the system
          await this.sleep(1000);
        } catch (error) {
          console.error(`❌ Cleanup failed for ${dataType}:`, error);
          results.push({
            dataType,
            recordsProcessed: 0,
            recordsDeleted: 0,
            recordsArchived: 0,
            errors: [error instanceof Error ? error.message : 'Unknown error'],
            executionTime: 0
          });
        }
      }

      // Store cleanup history
      this.cleanupHistory.push(...results);
      
      // Keep only last 100 cleanup results
      if (this.cleanupHistory.length > 100) {
        this.cleanupHistory = this.cleanupHistory.slice(-100);
      }

      const totalDeleted = results.reduce((sum, r) => sum + r.recordsDeleted, 0);
      const totalArchived = results.reduce((sum, r) => sum + r.recordsArchived, 0);
      
      console.log(`✅ Full cleanup completed: ${totalDeleted} deleted, ${totalArchived} archived`);
      
      return results;
    } finally {
      this.isRunning = false;
    }
  }

  /**
   * Cleanup specific data type
   */
  async cleanupDataType(dataType: string, policy: RetentionPolicy): Promise<CleanupResult> {
    const startTime = Date.now();
    const result: CleanupResult = {
      dataType,
      recordsProcessed: 0,
      recordsDeleted: 0,
      recordsArchived: 0,
      errors: [],
      executionTime: 0
    };

    try {
      console.log(`🔍 Cleaning up ${dataType} (retention: ${policy.retentionDays} days)`);
      
      // Calculate cutoff date
      const cutoffDate = new Date();
      cutoffDate.setDate(cutoffDate.getDate() - policy.retentionDays);
      
      // Get expired records (simulated - in production this would query your database)
      const expiredRecords = await this.getExpiredRecords(dataType, cutoffDate);
      result.recordsProcessed = expiredRecords.length;

      if (expiredRecords.length === 0) {
        console.log(`✅ No expired records found for ${dataType}`);
        result.executionTime = Date.now() - startTime;
        return result;
      }

      // Process each expired record
      for (const record of expiredRecords) {
        try {
          if (policy.archiveBeforeDelete) {
            // Archive the record
            await this.archiveRecord(record, policy.encryptArchive);
            result.recordsArchived++;
          }

          // Delete the record
          await this.deleteRecord(record);
          result.recordsDeleted++;
          
        } catch (recordError) {
          const errorMsg = recordError instanceof Error ? recordError.message : 'Unknown error';
          result.errors.push(`Failed to process record ${record.id}: ${errorMsg}`);
        }
      }

      console.log(`✅ ${dataType} cleanup completed: ${result.recordsDeleted} deleted, ${result.recordsArchived} archived`);
      
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Unknown error';
      result.errors.push(`Cleanup failed for ${dataType}: ${errorMsg}`);
      console.error(`❌ ${dataType} cleanup failed:`, error);
    }

    result.executionTime = Date.now() - startTime;
    return result;
  }

  /**
   * Run deep cleanup (more thorough, includes optimization)
   */
  async runDeepCleanup(): Promise<void> {
    console.log('🔧 Starting deep cleanup process...');
    
    try {
      // Run regular cleanup first
      await this.runFullCleanup();
      
      // Additional deep cleanup tasks
      await this.optimizeStorage();
      await this.cleanupTempFiles();
      await this.validateDataIntegrity();
      
      console.log('✅ Deep cleanup completed successfully');
    } catch (error) {
      console.error('❌ Deep cleanup failed:', error);
    }
  }

  /**
   * Run archive cleanup (compress and optimize archives)
   */
  async runArchiveCleanup(): Promise<void> {
    console.log('📦 Starting archive cleanup process...');
    
    try {
      await this.compressOldArchives();
      await this.validateArchiveIntegrity();
      await this.cleanupCorruptedArchives();
      
      console.log('✅ Archive cleanup completed successfully');
    } catch (error) {
      console.error('❌ Archive cleanup failed:', error);
    }
  }

  /**
   * Get expired records for a data type (simulated)
   */
  private async getExpiredRecords(dataType: string, cutoffDate: Date): Promise<DataRecord[]> {
    // In a real implementation, this would query your database
    // For simulation, we'll return some mock expired records
    
    const mockRecords: DataRecord[] = [];
    const recordCount = Math.floor(Math.random() * 10); // 0-9 records
    
    for (let i = 0; i < recordCount; i++) {
      const recordDate = new Date(cutoffDate.getTime() - Math.random() * 30 * 24 * 60 * 60 * 1000);
      mockRecords.push({
        id: `${dataType}_${Date.now()}_${i}`,
        createdAt: recordDate,
        dataType,
        customerId: `customer_${Math.floor(Math.random() * 1000)}`,
        size: Math.floor(Math.random() * 10000),
        metadata: { expired: true }
      });
    }
    
    return mockRecords;
  }

  /**
   * Archive a record
   */
  private async archiveRecord(record: DataRecord, encrypt: boolean): Promise<void> {
    // In a real implementation, this would move data to archive storage
    console.log(`📦 Archiving record ${record.id} (encrypt: ${encrypt})`);
    
    // Simulate archiving process
    await this.sleep(10);
    
    if (encrypt) {
      // Simulate encryption
      console.log(`🔐 Encrypting archived record ${record.id}`);
    }
  }

  /**
   * Delete a record
   */
  private async deleteRecord(record: DataRecord): Promise<void> {
    // In a real implementation, this would delete from database
    console.log(`🗑️ Deleting record ${record.id}`);
    
    // Simulate deletion
    await this.sleep(5);
  }

  /**
   * Optimize storage
   */
  private async optimizeStorage(): Promise<void> {
    console.log('🔧 Optimizing storage...');
    
    // Simulate storage optimization
    await this.sleep(2000);
    
    console.log('✅ Storage optimization completed');
  }

  /**
   * Clean up temporary files
   */
  private async cleanupTempFiles(): Promise<void> {
    console.log('🧹 Cleaning up temporary files...');
    
    // Simulate temp file cleanup
    await this.sleep(1000);
    
    console.log('✅ Temporary files cleaned up');
  }

  /**
   * Validate data integrity
   */
  private async validateDataIntegrity(): Promise<void> {
    console.log('🔍 Validating data integrity...');
    
    // Simulate integrity check
    await this.sleep(3000);
    
    console.log('✅ Data integrity validation completed');
  }

  /**
   * Compress old archives
   */
  private async compressOldArchives(): Promise<void> {
    console.log('📦 Compressing old archives...');
    
    // Simulate archive compression
    await this.sleep(5000);
    
    console.log('✅ Archive compression completed');
  }

  /**
   * Validate archive integrity
   */
  private async validateArchiveIntegrity(): Promise<void> {
    console.log('🔍 Validating archive integrity...');
    
    // Simulate archive validation
    await this.sleep(2000);
    
    console.log('✅ Archive integrity validation completed');
  }

  /**
   * Clean up corrupted archives
   */
  private async cleanupCorruptedArchives(): Promise<void> {
    console.log('🗑️ Cleaning up corrupted archives...');
    
    // Simulate corrupted archive cleanup
    await this.sleep(1000);
    
    console.log('✅ Corrupted archives cleaned up');
  }

  /**
   * Get cleanup statistics
   */
  getCleanupStatistics(): {
    totalCleanups: number;
    lastCleanup?: Date;
    totalRecordsDeleted: number;
    totalRecordsArchived: number;
    averageExecutionTime: number;
    errorRate: number;
  } {
    if (this.cleanupHistory.length === 0) {
      return {
        totalCleanups: 0,
        totalRecordsDeleted: 0,
        totalRecordsArchived: 0,
        averageExecutionTime: 0,
        errorRate: 0
      };
    }

    const totalDeleted = this.cleanupHistory.reduce((sum, r) => sum + r.recordsDeleted, 0);
    const totalArchived = this.cleanupHistory.reduce((sum, r) => sum + r.recordsArchived, 0);
    const totalTime = this.cleanupHistory.reduce((sum, r) => sum + r.executionTime, 0);
    const totalErrors = this.cleanupHistory.reduce((sum, r) => sum + r.errors.length, 0);

    return {
      totalCleanups: this.cleanupHistory.length,
      lastCleanup: new Date(), // In real implementation, track actual last cleanup time
      totalRecordsDeleted: totalDeleted,
      totalRecordsArchived: totalArchived,
      averageExecutionTime: totalTime / this.cleanupHistory.length,
      errorRate: totalErrors / this.cleanupHistory.length
    };
  }

  /**
   * Get retention policies
   */
  getRetentionPolicies(): RetentionPolicy[] {
    return Array.from(this.retentionPolicies.values());
  }

  /**
   * Update retention policy
   */
  updateRetentionPolicy(dataType: string, policy: Partial<RetentionPolicy>): boolean {
    const existingPolicy = this.retentionPolicies.get(dataType);
    
    if (!existingPolicy) {
      return false;
    }

    const updatedPolicy = { ...existingPolicy, ...policy };
    this.retentionPolicies.set(dataType, updatedPolicy);
    
    console.log(`📝 Updated retention policy for ${dataType}`);
    return true;
  }

  /**
   * Manual cleanup trigger
   */
  async triggerManualCleanup(dataType?: string): Promise<CleanupResult[]> {
    if (dataType) {
      const policy = this.retentionPolicies.get(dataType);
      if (!policy) {
        throw new Error(`No retention policy found for ${dataType}`);
      }
      
      const result = await this.cleanupDataType(dataType, policy);
      return [result];
    } else {
      return await this.runFullCleanup();
    }
  }

  /**
   * Stop all scheduled jobs
   */
  stopScheduledJobs(): void {
    this.scheduledJobs.forEach((job, name) => {
      job.stop();
      console.log(`⏹️ Stopped ${name} cleanup job`);
    });
  }

  /**
   * Utility sleep function
   */
  private sleep(ms: number): Promise<void> {
    return new Promise(resolve => setTimeout(resolve, ms));
  }
}

// Singleton instance
export const dataCleanupManager = new DataCleanupManager();

// Export types
export type { RetentionPolicy, CleanupResult, DataRecord };
