/**
 * Webhook & Request Validation
 * Handles secure validation of incoming requests from messaging platforms
 */

import crypto from 'crypto';

interface ValidationResult {
  isValid: boolean;
  error?: string;
  metadata?: Record<string, any>;
}

interface WhatsAppWebhookData {
  object: string;
  entry: Array<{
    id: string;
    changes: Array<{
      value: {
        messaging_product: string;
        metadata: any;
        contacts?: any[];
        messages?: any[];
      };
      field: string;
    }>;
  }>;
}

interface TelegramWebhookData {
  update_id: number;
  message?: {
    message_id: number;
    from: {
      id: number;
      is_bot: boolean;
      first_name: string;
      username?: string;
    };
    chat: {
      id: number;
      first_name: string;
      username?: string;
      type: string;
    };
    date: number;
    text?: string;
  };
}

class WebhookValidator {
  /**
   * Verify WhatsApp webhook signature
   */
  static verifyWhatsAppSignature(
    payload: string,
    signature: string,
    secret: string = process.env.WHATSAPP_WEBHOOK_SECRET || 'dummy-webhook-secret'
  ): ValidationResult {
    try {
      // WhatsApp sends signature as "sha256=<hash>"
      const expectedSignature = `sha256=${crypto
        .createHmac('sha256', secret)
        .update(payload)
        .digest('hex')}`;

      const isValid = crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
      );

      if (!isValid) {
        console.warn('🚨 WhatsApp webhook signature validation failed');
        return { isValid: false, error: 'Invalid signature' };
      }

      console.log('✅ WhatsApp webhook signature validated');
      return { isValid: true };
    } catch (error) {
      console.error('❌ WhatsApp signature verification error:', error);
      return { isValid: false, error: 'Signature verification failed' };
    }
  }

  /**
   * Verify Telegram webhook signature
   */
  static verifyTelegramSignature(
    payload: string,
    signature: string,
    secret: string = process.env.TELEGRAM_WEBHOOK_SECRET || 'dummy-telegram-secret'
  ): ValidationResult {
    try {
      const expectedSignature = crypto
        .createHmac('sha256', secret)
        .update(payload)
        .digest('hex');

      const isValid = crypto.timingSafeEqual(
        Buffer.from(signature),
        Buffer.from(expectedSignature)
      );

      if (!isValid) {
        console.warn('🚨 Telegram webhook signature validation failed');
        return { isValid: false, error: 'Invalid signature' };
      }

      console.log('✅ Telegram webhook signature validated');
      return { isValid: true };
    } catch (error) {
      console.error('❌ Telegram signature verification error:', error);
      return { isValid: false, error: 'Signature verification failed' };
    }
  }

  /**
   * Validate WhatsApp webhook data structure
   */
  static validateWhatsAppData(data: any): ValidationResult {
    try {
      const webhookData = data as WhatsAppWebhookData;

      // Basic structure validation
      if (!webhookData.object || webhookData.object !== 'whatsapp_business_account') {
        return { isValid: false, error: 'Invalid WhatsApp webhook object' };
      }

      if (!webhookData.entry || !Array.isArray(webhookData.entry)) {
        return { isValid: false, error: 'Invalid WhatsApp webhook entry structure' };
      }

      // Extract message data
      const messages: any[] = [];
      webhookData.entry.forEach(entry => {
        entry.changes.forEach(change => {
          if (change.value.messages) {
            messages.push(...change.value.messages);
          }
        });
      });

      console.log(`✅ WhatsApp webhook data validated, ${messages.length} messages found`);
      return { 
        isValid: true, 
        metadata: { 
          messageCount: messages.length,
          messages: messages
        }
      };
    } catch (error) {
      console.error('❌ WhatsApp data validation error:', error);
      return { isValid: false, error: 'Invalid WhatsApp webhook data structure' };
    }
  }

  /**
   * Validate Telegram webhook data structure
   */
  static validateTelegramData(data: any): ValidationResult {
    try {
      const webhookData = data as TelegramWebhookData;

      // Basic structure validation
      if (typeof webhookData.update_id !== 'number') {
        return { isValid: false, error: 'Invalid Telegram webhook update_id' };
      }

      // Check if it's a message update
      if (webhookData.message) {
        const message = webhookData.message;
        
        if (!message.message_id || !message.from || !message.chat) {
          return { isValid: false, error: 'Invalid Telegram message structure' };
        }
      }

      console.log(`✅ Telegram webhook data validated, update_id: ${webhookData.update_id}`);
      return { 
        isValid: true, 
        metadata: { 
          updateId: webhookData.update_id,
          hasMessage: !!webhookData.message,
          message: webhookData.message
        }
      };
    } catch (error) {
      console.error('❌ Telegram data validation error:', error);
      return { isValid: false, error: 'Invalid Telegram webhook data structure' };
    }
  }

  /**
   * Validate generic webhook request
   */
  static validateWebhookRequest(
    headers: Record<string, string>,
    body: string,
    channel: 'whatsapp' | 'telegram'
  ): ValidationResult {
    try {
      // Check content type
      const contentType = headers['content-type'] || headers['Content-Type'];
      if (!contentType || !contentType.includes('application/json')) {
        return { isValid: false, error: 'Invalid content type, expected application/json' };
      }

      // Parse JSON body
      let parsedBody;
      try {
        parsedBody = JSON.parse(body);
      } catch (parseError) {
        return { isValid: false, error: 'Invalid JSON body' };
      }

      // Channel-specific validation
      switch (channel) {
        case 'whatsapp':
          const whatsappSignature = headers['x-hub-signature-256'] || headers['X-Hub-Signature-256'];
          if (!whatsappSignature) {
            return { isValid: false, error: 'Missing WhatsApp signature header' };
          }
          
          const whatsappSigResult = this.verifyWhatsAppSignature(body, whatsappSignature);
          if (!whatsappSigResult.isValid) {
            return whatsappSigResult;
          }
          
          return this.validateWhatsAppData(parsedBody);

        case 'telegram':
          const telegramSignature = headers['x-telegram-bot-api-secret-token'] || headers['X-Telegram-Bot-Api-Secret-Token'];
          if (!telegramSignature) {
            return { isValid: false, error: 'Missing Telegram signature header' };
          }
          
          const telegramSigResult = this.verifyTelegramSignature(body, telegramSignature);
          if (!telegramSigResult.isValid) {
            return telegramSigResult;
          }
          
          return this.validateTelegramData(parsedBody);

        default:
          return { isValid: false, error: 'Unsupported channel' };
      }
    } catch (error) {
      console.error('❌ Webhook request validation error:', error);
      return { isValid: false, error: 'Webhook validation failed' };
    }
  }

  /**
   * Sanitize and validate message content
   */
  static sanitizeMessageContent(content: string): {
    sanitized: string;
    containsSuspiciousContent: boolean;
    warnings: string[];
  } {
    const warnings: string[] = [];
    let sanitized = content;

    // Remove potential XSS patterns
    const xssPatterns = [
      /<script\b[^<]*(?:(?!<\/script>)<[^<]*)*<\/script>/gi,
      /javascript:/gi,
      /on\w+\s*=/gi
    ];

    xssPatterns.forEach(pattern => {
      if (pattern.test(sanitized)) {
        warnings.push('Potential XSS content detected and removed');
        sanitized = sanitized.replace(pattern, '');
      }
    });

    // Check for suspicious URLs
    const urlPattern = /https?:\/\/[^\s]+/gi;
    const urls = sanitized.match(urlPattern) || [];
    const suspiciousUrls = urls.filter(url => {
      // Basic suspicious URL detection
      return url.includes('bit.ly') || url.includes('tinyurl') || url.includes('t.co');
    });

    if (suspiciousUrls.length > 0) {
      warnings.push(`Suspicious shortened URLs detected: ${suspiciousUrls.join(', ')}`);
    }

    // Limit message length
    const maxLength = 10000;
    if (sanitized.length > maxLength) {
      sanitized = sanitized.substring(0, maxLength) + '... [truncated]';
      warnings.push('Message truncated due to length limit');
    }

    return {
      sanitized,
      containsSuspiciousContent: warnings.length > 0,
      warnings
    };
  }
}

export { WebhookValidator };
export type { ValidationResult, WhatsAppWebhookData, TelegramWebhookData };
