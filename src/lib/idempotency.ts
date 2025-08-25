/**
 * Idempotency Manager
 * Prevents duplicate actions during execution phase
 */

interface IdempotencyRecord {
  actionId: string;
  customerId: string;
  actionType: string;
  status: 'pending' | 'completed' | 'failed';
  result?: any;
  createdAt: Date;
  completedAt?: Date;
  expiresAt: Date;
  metadata?: Record<string, any>;
}

interface IdempotencyConfig {
  ttlMs: number; // Time to live in milliseconds
  maxRetries: number;
  cleanupIntervalMs: number;
}

class IdempotencyManager {
  private store = new Map<string, IdempotencyRecord>();
  private config: IdempotencyConfig;
  private cleanupTimer?: NodeJS.Timeout;

  constructor(config: IdempotencyConfig = {
    ttlMs: 24 * 60 * 60 * 1000, // 24 hours
    maxRetries: 3,
    cleanupIntervalMs: 60 * 60 * 1000 // 1 hour
  }) {
    this.config = config;
    this.startCleanupTimer();
  }

  /**
   * Check if action is already in progress or completed
   */
  checkIdempotency(
    actionId: string,
    customerId: string,
    actionType: string
  ): {
    canProceed: boolean;
    existingRecord?: IdempotencyRecord;
    reason?: string;
  } {
    const key = this.generateKey(actionId, customerId);
    const existingRecord = this.store.get(key);

    // No existing record - can proceed
    if (!existingRecord) {
      console.log(`✅ No existing record for action ${actionId}, can proceed`);
      return { canProceed: true };
    }

    // Check if record has expired
    if (new Date() > existingRecord.expiresAt) {
      this.store.delete(key);
      console.log(`🕒 Expired record removed for action ${actionId}, can proceed`);
      return { canProceed: true };
    }

    // Action is still pending
    if (existingRecord.status === 'pending') {
      console.warn(`⏳ Action ${actionId} is still pending, cannot proceed`);
      return {
        canProceed: false,
        existingRecord,
        reason: 'Action is still in progress'
      };
    }

    // Action completed successfully - return cached result
    if (existingRecord.status === 'completed') {
      console.log(`✅ Action ${actionId} already completed, returning cached result`);
      return {
        canProceed: false,
        existingRecord,
        reason: 'Action already completed'
      };
    }

    // Action failed - allow retry based on configuration
    if (existingRecord.status === 'failed') {
      const retryCount = existingRecord.metadata?.retryCount || 0;
      
      if (retryCount >= this.config.maxRetries) {
        console.warn(`❌ Action ${actionId} exceeded max retries (${this.config.maxRetries})`);
        return {
          canProceed: false,
          existingRecord,
          reason: 'Max retries exceeded'
        };
      }

      console.log(`🔄 Action ${actionId} failed previously, allowing retry ${retryCount + 1}/${this.config.maxRetries}`);
      return { canProceed: true, existingRecord };
    }

    return { canProceed: false, existingRecord, reason: 'Unknown status' };
  }

  /**
   * Store action as pending
   */
  storeAction(
    actionId: string,
    customerId: string,
    actionType: string,
    metadata?: Record<string, any>
  ): IdempotencyRecord {
    const key = this.generateKey(actionId, customerId);
    const now = new Date();
    
    const record: IdempotencyRecord = {
      actionId,
      customerId,
      actionType,
      status: 'pending',
      createdAt: now,
      expiresAt: new Date(now.getTime() + this.config.ttlMs),
      metadata
    };

    this.store.set(key, record);
    console.log(`📝 Stored pending action: ${actionId} for customer ${customerId}`);
    
    return record;
  }

  /**
   * Mark action as completed
   */
  markCompleted(
    actionId: string,
    customerId: string,
    result: any,
    metadata?: Record<string, any>
  ): boolean {
    const key = this.generateKey(actionId, customerId);
    const record = this.store.get(key);

    if (!record) {
      console.warn(`⚠️ No record found for action ${actionId}`);
      return false;
    }

    record.status = 'completed';
    record.result = result;
    record.completedAt = new Date();
    
    if (metadata) {
      record.metadata = { ...record.metadata, ...metadata };
    }

    this.store.set(key, record);
    console.log(`✅ Marked action as completed: ${actionId}`);
    
    return true;
  }

  /**
   * Mark action as failed
   */
  markFailed(
    actionId: string,
    customerId: string,
    error: string,
    metadata?: Record<string, any>
  ): boolean {
    const key = this.generateKey(actionId, customerId);
    const record = this.store.get(key);

    if (!record) {
      console.warn(`⚠️ No record found for action ${actionId}`);
      return false;
    }

    const retryCount = (record.metadata?.retryCount || 0) + 1;

    record.status = 'failed';
    record.result = { error, timestamp: new Date().toISOString() };
    record.completedAt = new Date();
    record.metadata = {
      ...record.metadata,
      ...metadata,
      retryCount,
      lastError: error
    };

    this.store.set(key, record);
    console.log(`❌ Marked action as failed: ${actionId} (retry ${retryCount})`);
    
    return true;
  }

  /**
   * Get action result (for completed actions)
   */
  getActionResult(actionId: string, customerId: string): any {
    const key = this.generateKey(actionId, customerId);
    const record = this.store.get(key);

    if (!record || record.status !== 'completed') {
      return null;
    }

    return record.result;
  }

  /**
   * Get action status and details
   */
  getActionStatus(actionId: string, customerId: string): {
    exists: boolean;
    status?: string;
    createdAt?: Date;
    completedAt?: Date;
    result?: any;
    metadata?: Record<string, any>;
  } {
    const key = this.generateKey(actionId, customerId);
    const record = this.store.get(key);

    if (!record) {
      return { exists: false };
    }

    return {
      exists: true,
      status: record.status,
      createdAt: record.createdAt,
      completedAt: record.completedAt,
      result: record.result,
      metadata: record.metadata
    };
  }

  /**
   * Remove action record (manual cleanup)
   */
  removeAction(actionId: string, customerId: string): boolean {
    const key = this.generateKey(actionId, customerId);
    const deleted = this.store.delete(key);
    
    if (deleted) {
      console.log(`🗑️ Removed action record: ${actionId}`);
    }
    
    return deleted;
  }

  /**
   * Get all actions for a customer
   */
  getCustomerActions(customerId: string): IdempotencyRecord[] {
    const customerActions: IdempotencyRecord[] = [];
    
    this.store.forEach((record) => {
      if (record.customerId === customerId) {
        customerActions.push(record);
      }
    });

    return customerActions.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  /**
   * Get statistics about idempotency store
   */
  getStatistics(): {
    totalRecords: number;
    pendingActions: number;
    completedActions: number;
    failedActions: number;
    expiredRecords: number;
    actionsByType: Record<string, number>;
  } {
    const stats = {
      totalRecords: this.store.size,
      pendingActions: 0,
      completedActions: 0,
      failedActions: 0,
      expiredRecords: 0,
      actionsByType: {} as Record<string, number>
    };

    const now = new Date();

    this.store.forEach((record) => {
      // Count by status
      switch (record.status) {
        case 'pending':
          stats.pendingActions++;
          break;
        case 'completed':
          stats.completedActions++;
          break;
        case 'failed':
          stats.failedActions++;
          break;
      }

      // Count expired records
      if (now > record.expiresAt) {
        stats.expiredRecords++;
      }

      // Count by action type
      stats.actionsByType[record.actionType] = 
        (stats.actionsByType[record.actionType] || 0) + 1;
    });

    return stats;
  }

  /**
   * Execute action with idempotency protection
   */
  async executeWithIdempotency<T>(
    actionId: string,
    customerId: string,
    actionType: string,
    actionFunction: () => Promise<T>,
    metadata?: Record<string, any>
  ): Promise<{
    success: boolean;
    result?: T;
    fromCache: boolean;
    error?: string;
  }> {
    try {
      // Check idempotency
      const idempotencyCheck = this.checkIdempotency(actionId, customerId, actionType);

      // Return cached result if action already completed
      if (!idempotencyCheck.canProceed && idempotencyCheck.existingRecord?.status === 'completed') {
        return {
          success: true,
          result: idempotencyCheck.existingRecord.result,
          fromCache: true
        };
      }

      // Cannot proceed due to pending action or max retries
      if (!idempotencyCheck.canProceed) {
        return {
          success: false,
          fromCache: false,
          error: idempotencyCheck.reason || 'Cannot proceed with action'
        };
      }

      // Store action as pending
      this.storeAction(actionId, customerId, actionType, metadata);

      try {
        // Execute the action
        const result = await actionFunction();
        
        // Mark as completed
        this.markCompleted(actionId, customerId, result);
        
        return {
          success: true,
          result,
          fromCache: false
        };
      } catch (actionError) {
        // Mark as failed
        const errorMessage = actionError instanceof Error ? actionError.message : 'Unknown error';
        this.markFailed(actionId, customerId, errorMessage);
        
        return {
          success: false,
          fromCache: false,
          error: errorMessage
        };
      }
    } catch (error) {
      console.error('❌ Idempotency execution error:', error);
      return {
        success: false,
        fromCache: false,
        error: error instanceof Error ? error.message : 'Idempotency execution failed'
      };
    }
  }

  /**
   * Generate storage key
   */
  private generateKey(actionId: string, customerId: string): string {
    return `${customerId}:${actionId}`;
  }

  /**
   * Start cleanup timer for expired records
   */
  private startCleanupTimer(): void {
    this.cleanupTimer = setInterval(() => {
      this.cleanupExpiredRecords();
    }, this.config.cleanupIntervalMs);
  }

  /**
   * Clean up expired records
   */
  private cleanupExpiredRecords(): void {
    const now = new Date();
    let cleanedCount = 0;

    this.store.forEach((record, key) => {
      if (now > record.expiresAt) {
        this.store.delete(key);
        cleanedCount++;
      }
    });

    if (cleanedCount > 0) {
      console.log(`🧹 Cleaned up ${cleanedCount} expired idempotency records`);
    }
  }

  /**
   * Stop cleanup timer (for testing or shutdown)
   */
  stopCleanupTimer(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
      this.cleanupTimer = undefined;
    }
  }
}

// Singleton instance
export const idempotencyManager = new IdempotencyManager();

// Export types
export type { IdempotencyRecord, IdempotencyConfig };
