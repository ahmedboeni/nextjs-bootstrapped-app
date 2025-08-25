/**
 * Encryption Utility
 * Handles encryption/decryption of sensitive attachments and data
 */

import crypto from 'crypto';

interface EncryptionResult {
  encrypted: string;
  iv: string;
  tag?: string;
}

interface DecryptionResult {
  decrypted: Buffer;
  success: boolean;
  error?: string;
}

class EncryptionManager {
  private readonly algorithm = 'aes-256-gcm';
  private readonly keyLength = 32; // 256 bits
  private readonly ivLength = 16;  // 128 bits

  /**
   * Generate a secure encryption key
   */
  generateKey(): string {
    return crypto.randomBytes(this.keyLength).toString('hex');
  }

  /**
   * Encrypt data using AES-256-GCM
   */
  encryptData(data: Buffer, key: string): EncryptionResult {
    try {
      // Validate key length
      if (key.length !== this.keyLength * 2) { // hex string is 2x the byte length
        throw new Error('Invalid key length. Expected 64 hex characters (32 bytes)');
      }

      // Generate random IV
      const iv = crypto.randomBytes(this.ivLength);
      
      // Create cipher
      const cipher = crypto.createCipher(this.algorithm, Buffer.from(key, 'hex'));
      cipher.setAAD(Buffer.from('smart-workflow-auth', 'utf8'));

      // Encrypt data
      let encrypted = cipher.update(data);
      encrypted = Buffer.concat([encrypted, cipher.final()]);

      // Get authentication tag
      const tag = cipher.getAuthTag();

      const result: EncryptionResult = {
        encrypted: encrypted.toString('base64'),
        iv: iv.toString('hex'),
        tag: tag.toString('hex')
      };

      console.log('🔐 Data encrypted successfully');
      return result;
    } catch (error) {
      console.error('❌ Encryption failed:', error);
      throw new Error(`Encryption failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Decrypt data using AES-256-GCM
   */
  decryptData(encryptedData: string, key: string, iv: string, tag?: string): DecryptionResult {
    try {
      // Validate inputs
      if (key.length !== this.keyLength * 2) {
        return {
          decrypted: Buffer.alloc(0),
          success: false,
          error: 'Invalid key length'
        };
      }

      // Create decipher
      const decipher = crypto.createDecipher(this.algorithm, Buffer.from(key, 'hex'));
      decipher.setAAD(Buffer.from('smart-workflow-auth', 'utf8'));

      if (tag) {
        decipher.setAuthTag(Buffer.from(tag, 'hex'));
      }

      // Decrypt data
      let decrypted = decipher.update(Buffer.from(encryptedData, 'base64'));
      decrypted = Buffer.concat([decrypted, decipher.final()]);

      console.log('🔓 Data decrypted successfully');
      return {
        decrypted,
        success: true
      };
    } catch (error) {
      console.error('❌ Decryption failed:', error);
      return {
        decrypted: Buffer.alloc(0),
        success: false,
        error: error instanceof Error ? error.message : 'Decryption failed'
      };
    }
  }

  /**
   * Encrypt file attachment
   */
  async encryptAttachment(
    fileBuffer: Buffer,
    filename: string,
    customerId: string
  ): Promise<{
    encryptedData: EncryptionResult;
    metadata: {
      originalFilename: string;
      customerId: string;
      encryptedAt: string;
      fileSize: number;
      checksum: string;
    };
  }> {
    try {
      // Generate customer-specific key
      const customerKey = this.generateCustomerKey(customerId);
      
      // Calculate file checksum for integrity verification
      const checksum = crypto.createHash('sha256').update(fileBuffer).digest('hex');
      
      // Encrypt the file
      const encryptedData = this.encryptData(fileBuffer, customerKey);
      
      const metadata = {
        originalFilename: filename,
        customerId,
        encryptedAt: new Date().toISOString(),
        fileSize: fileBuffer.length,
        checksum
      };

      console.log(`🔐 Attachment encrypted: ${filename} (${fileBuffer.length} bytes)`);
      
      return {
        encryptedData,
        metadata
      };
    } catch (error) {
      console.error('❌ Attachment encryption failed:', error);
      throw error;
    }
  }

  /**
   * Decrypt file attachment
   */
  async decryptAttachment(
    encryptedData: EncryptionResult,
    metadata: {
      originalFilename: string;
      customerId: string;
      checksum: string;
    }
  ): Promise<{
    fileBuffer: Buffer;
    filename: string;
    isValid: boolean;
  }> {
    try {
      // Generate customer-specific key
      const customerKey = this.generateCustomerKey(metadata.customerId);
      
      // Decrypt the file
      const decryptionResult = this.decryptData(
        encryptedData.encrypted,
        customerKey,
        encryptedData.iv,
        encryptedData.tag
      );

      if (!decryptionResult.success) {
        throw new Error(decryptionResult.error || 'Decryption failed');
      }

      // Verify file integrity
      const calculatedChecksum = crypto
        .createHash('sha256')
        .update(decryptionResult.decrypted)
        .digest('hex');

      const isValid = calculatedChecksum === metadata.checksum;

      if (!isValid) {
        console.warn('⚠️ File integrity check failed - checksums do not match');
      }

      console.log(`🔓 Attachment decrypted: ${metadata.originalFilename}`);

      return {
        fileBuffer: decryptionResult.decrypted,
        filename: metadata.originalFilename,
        isValid
      };
    } catch (error) {
      console.error('❌ Attachment decryption failed:', error);
      throw error;
    }
  }

  /**
   * Encrypt sensitive text data (like customer messages)
   */
  encryptText(text: string, customerId?: string): EncryptionResult {
    const key = customerId 
      ? this.generateCustomerKey(customerId)
      : process.env.ENCRYPTION_KEY || this.generateKey();
    
    return this.encryptData(Buffer.from(text, 'utf8'), key);
  }

  /**
   * Decrypt sensitive text data
   */
  decryptText(encryptedData: EncryptionResult, customerId?: string): string {
    const key = customerId 
      ? this.generateCustomerKey(customerId)
      : process.env.ENCRYPTION_KEY || '';
    
    const result = this.decryptData(
      encryptedData.encrypted,
      key,
      encryptedData.iv,
      encryptedData.tag
    );

    if (!result.success) {
      throw new Error(result.error || 'Text decryption failed');
    }

    return result.decrypted.toString('utf8');
  }

  /**
   * Generate customer-specific encryption key
   */
  private generateCustomerKey(customerId: string): string {
    const baseKey = process.env.ENCRYPTION_KEY || 'dummy-32-char-encryption-key-here';
    const customerSalt = `customer_${customerId}_salt`;
    
    // Use PBKDF2 to derive customer-specific key
    const derivedKey = crypto.pbkdf2Sync(
      baseKey,
      customerSalt,
      100000, // iterations
      this.keyLength,
      'sha256'
    );

    return derivedKey.toString('hex');
  }

  /**
   * Hash sensitive data (one-way, for comparison purposes)
   */
  hashData(data: string, salt?: string): string {
    const actualSalt = salt || crypto.randomBytes(16).toString('hex');
    const hash = crypto.pbkdf2Sync(data, actualSalt, 100000, 64, 'sha256');
    return `${actualSalt}:${hash.toString('hex')}`;
  }

  /**
   * Verify hashed data
   */
  verifyHash(data: string, hashedData: string): boolean {
    try {
      const [salt, hash] = hashedData.split(':');
      const verifyHash = crypto.pbkdf2Sync(data, salt, 100000, 64, 'sha256');
      return hash === verifyHash.toString('hex');
    } catch (error) {
      console.error('❌ Hash verification failed:', error);
      return false;
    }
  }

  /**
   * Generate secure random token
   */
  generateSecureToken(length: number = 32): string {
    return crypto.randomBytes(length).toString('hex');
  }

  /**
   * Encrypt database connection string or API keys
   */
  encryptCredentials(credentials: string): string {
    const key = process.env.ENCRYPTION_KEY || this.generateKey();
    const result = this.encryptData(Buffer.from(credentials, 'utf8'), key);
    
    // Return as single string for easy storage
    return `${result.encrypted}:${result.iv}:${result.tag}`;
  }

  /**
   * Decrypt database connection string or API keys
   */
  decryptCredentials(encryptedCredentials: string): string {
    const [encrypted, iv, tag] = encryptedCredentials.split(':');
    const key = process.env.ENCRYPTION_KEY || '';
    
    const result = this.decryptData(encrypted, key, iv, tag);
    
    if (!result.success) {
      throw new Error('Failed to decrypt credentials');
    }
    
    return result.decrypted.toString('utf8');
  }
}

// Singleton instance
export const encryptionManager = new EncryptionManager();

// Export types
export type { EncryptionResult, DecryptionResult };
