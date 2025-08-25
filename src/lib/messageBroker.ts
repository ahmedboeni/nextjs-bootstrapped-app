خمج/**
 * Message Broker Integration
 * Handles message queuing, dead letter queues, and retry mechanisms
 */

interface Message {
  id: string;
  channel: 'whatsapp' | 'telegram' | 'email' | 'web';
  content: string;
  metadata: Record<string, any>;
  timestamp: Date;
  retryCount?: number;
}

interface MessageBrokerConfig {
  maxRetries: number;
  retryDelay: number;
  deadLetterQueueSize: number;
}

class MessageBroker {
  private messageQueue: Message[] = [];
  private deadLetterQueue: Message[] = [];
  private processing = false;
  private config: MessageBrokerConfig;

  constructor(config: MessageBrokerConfig = {
    maxRetries: 3,
    retryDelay: 1000,
    deadLetterQueueSize: 1000
  }) {
    this.config = config;
  }

  /**
   * Publish message to the queue
   */
  async publishMessage(message: Omit<Message, 'id' | 'timestamp'>): Promise<string> {
    const messageWithId: Message = {
      ...message,
      id: this.generateMessageId(),
      timestamp: new Date(),
      retryCount: 0
    };

    this.messageQueue.push(messageWithId);
    console.log(`📨 Message published to queue: ${messageWithId.id} from ${messageWithId.channel}`);
    
    // Start processing if not already running
    if (!this.processing) {
      this.processQueue();
    }

    return messageWithId.id;
  }

  /**
   * Process messages from the queue
   */
  private async processQueue(): Promise<void> {
    this.processing = true;

    while (this.messageQueue.length > 0) {
      const message = this.messageQueue.shift();
      if (!message) continue;

      try {
        await this.processMessage(message);
        console.log(`✅ Message processed successfully: ${message.id}`);
      } catch (error) {
        console.error(`❌ Error processing message ${message.id}:`, error);
        await this.handleFailedMessage(message);
      }
    }

    this.processing = false;
  }

  /**
   * Process individual message
   */
  private async processMessage(message: Message): Promise<void> {
    // Simulate message processing
    await new Promise(resolve => setTimeout(resolve, 100));
    
    // Here you would integrate with your actual message processing logic
    // For now, we'll just log the message
    console.log(`🔄 Processing message from ${message.channel}: ${message.content.substring(0, 50)}...`);
  }

  /**
   * Handle failed message processing
   */
  private async handleFailedMessage(message: Message): Promise<void> {
    const retryCount = (message.retryCount || 0) + 1;

    if (retryCount <= this.config.maxRetries) {
      // Retry with exponential backoff
      const delay = this.config.retryDelay * Math.pow(2, retryCount - 1);
      
      setTimeout(() => {
        const retryMessage = { ...message, retryCount };
        this.messageQueue.unshift(retryMessage);
        console.log(`🔄 Retrying message ${message.id} (attempt ${retryCount}/${this.config.maxRetries})`);
      }, delay);
    } else {
      // Move to dead letter queue
      this.moveToDeadLetterQueue(message);
    }
  }

  /**
   * Move message to dead letter queue
   */
  private moveToDeadLetterQueue(message: Message): void {
    if (this.deadLetterQueue.length >= this.config.deadLetterQueueSize) {
      // Remove oldest message if queue is full
      this.deadLetterQueue.shift();
    }

    this.deadLetterQueue.push(message);
    console.log(`💀 Message moved to dead letter queue: ${message.id}`);
  }

  /**
   * Get queue statistics
   */
  getQueueStats(): {
    activeMessages: number;
    deadLetterMessages: number;
    isProcessing: boolean;
  } {
    return {
      activeMessages: this.messageQueue.length,
      deadLetterMessages: this.deadLetterQueue.length,
      isProcessing: this.processing
    };
  }

  /**
   * Get dead letter queue messages for manual review
   */
  getDeadLetterMessages(): Message[] {
    return [...this.deadLetterQueue];
  }

  /**
   * Retry dead letter queue message
   */
  retryDeadLetterMessage(messageId: string): boolean {
    const messageIndex = this.deadLetterQueue.findIndex(msg => msg.id === messageId);
    if (messageIndex === -1) return false;

    const message = this.deadLetterQueue.splice(messageIndex, 1)[0];
    message.retryCount = 0; // Reset retry count
    this.messageQueue.push(message);

    if (!this.processing) {
      this.processQueue();
    }

    console.log(`🔄 Dead letter message requeued: ${messageId}`);
    return true;
  }

  /**
   * Generate unique message ID
   */
  private generateMessageId(): string {
    return `msg_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }
}

// Singleton instance
export const messageBroker = new MessageBroker();

// Export types
export type { Message, MessageBrokerConfig };
