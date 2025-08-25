/**
 * LLM Interface
 * Handles communication with OpenRouter API and cost monitoring
 */

interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string | Array<{
    type: 'text' | 'image_url' | 'file';
    text?: string;
    image_url?: { url: string };
    file?: { filename: string; file_data: string };
  }>;
}

interface LLMRequest {
  model: string;
  messages: LLMMessage[];
  max_tokens?: number;
  temperature?: number;
  top_p?: number;
  frequency_penalty?: number;
  presence_penalty?: number;
  stream?: boolean;
}

interface LLMResponse {
  id: string;
  object: string;
  created: number;
  model: string;
  choices: Array<{
    index: number;
    message: {
      role: string;
      content: string;
    };
    finish_reason: string;
  }>;
  usage: {
    prompt_tokens: number;
    completion_tokens: number;
    total_tokens: number;
  };
}

interface LLMConfig {
  apiKey: string;
  model: string;
  maxTokens: number;
  temperature: number;
  baseURL: string;
}

interface CostTracker {
  totalTokensUsed: number;
  totalCost: number;
  requestCount: number;
  dailyTokens: number;
  dailyLimit: number;
  lastResetDate: string;
}

class LLMManager {
  private config: LLMConfig;
  private costTracker: CostTracker;
  private readonly tokenPrices = {
    'anthropic/claude-sonnet-4': { input: 0.003, output: 0.015 }, // per 1K tokens
    'openai/gpt-4o': { input: 0.005, output: 0.015 },
    'openai/gpt-4o-mini': { input: 0.00015, output: 0.0006 },
    'meta-llama/llama-3.1-8b-instruct': { input: 0.0001, output: 0.0001 }
  };

  constructor(config?: Partial<LLMConfig>) {
    this.config = {
      apiKey: config?.apiKey || process.env.OPENROUTER_API_KEY || 'sk-or-dummy-key-replace-with-real-key',
      model: config?.model || process.env.OPENROUTER_MODEL || 'anthropic/claude-sonnet-4',
      maxTokens: config?.maxTokens || parseInt(process.env.MAX_TOKENS_PER_REQUEST || '500'),
      temperature: config?.temperature || 0.7,
      baseURL: config?.baseURL || 'https://openrouter.ai/api/v1/chat/completions'
    };

    this.costTracker = this.initializeCostTracker();
  }

  /**
   * Call LLM with prompt and options
   */
  async callLLM(
    prompt: string,
    options?: {
      systemPrompt?: string;
      temperature?: number;
      maxTokens?: number;
      customerId?: string;
      context?: Record<string, any>;
    }
  ): Promise<{
    success: boolean;
    response?: string;
    usage?: {
      promptTokens: number;
      completionTokens: number;
      totalTokens: number;
      estimatedCost: number;
    };
    error?: string;
  }> {
    try {
      // Check daily token limit
      if (!this.checkDailyLimit()) {
        return {
          success: false,
          error: 'Daily token limit exceeded'
        };
      }

      // Prepare messages
      const messages: LLMMessage[] = [];

      // Add system prompt if provided
      if (options?.systemPrompt) {
        messages.push({
          role: 'system',
          content: options.systemPrompt
        });
      } else {
        // Default system prompt for customer service
        messages.push({
          role: 'system',
          content: this.getDefaultSystemPrompt()
        });
      }

      // Add user prompt
      messages.push({
        role: 'user',
        content: prompt
      });

      // Prepare request
      const request: LLMRequest = {
        model: this.config.model,
        messages,
        max_tokens: options?.maxTokens || this.config.maxTokens,
        temperature: options?.temperature || this.config.temperature
      };

      console.log(`🤖 Calling LLM: ${this.config.model} with ${messages.length} messages`);

      // Make API call
      const response = await fetch(this.config.baseURL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.config.apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://smart-workflow.local',
          'X-Title': 'Smart Customer Service Workflow'
        },
        body: JSON.stringify(request)
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('❌ LLM API error:', response.status, errorText);
        return {
          success: false,
          error: `LLM API error: ${response.status} - ${errorText}`
        };
      }

      const llmResponse: LLMResponse = await response.json();

      // Extract response content
      const content = llmResponse.choices[0]?.message?.content;
      if (!content) {
        return {
          success: false,
          error: 'No content in LLM response'
        };
      }

      // Calculate cost and update tracker
      const usage = llmResponse.usage;
      const estimatedCost = this.calculateCost(usage.prompt_tokens, usage.completion_tokens);
      this.updateCostTracker(usage.total_tokens, estimatedCost);

      console.log(`✅ LLM response received: ${usage.total_tokens} tokens, $${estimatedCost.toFixed(4)} cost`);

      return {
        success: true,
        response: content,
        usage: {
          promptTokens: usage.prompt_tokens,
          completionTokens: usage.completion_tokens,
          totalTokens: usage.total_tokens,
          estimatedCost
        }
      };
    } catch (error) {
      console.error('❌ LLM call failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Unknown LLM error'
      };
    }
  }

  /**
   * Generate customer service response
   */
  async generateResponse(
    customerMessage: string,
    context: {
      customerId: string;
      customerName?: string;
      previousMessages?: string[];
      intent?: string;
      sentiment?: string;
      companyPolicies?: string[];
    }
  ): Promise<{
    success: boolean;
    response?: string;
    tone?: string;
    confidence?: number;
    usage?: any;
    error?: string;
  }> {
    try {
      // Build context-aware system prompt
      const systemPrompt = this.buildCustomerServicePrompt(context);

      // Prepare enhanced prompt with context
      const enhancedPrompt = this.buildEnhancedPrompt(customerMessage, context);

      // Call LLM
      const result = await this.callLLM(enhancedPrompt, {
        systemPrompt,
        customerId: context.customerId,
        context
      });

      if (!result.success) {
        return result;
      }

      // Parse response for additional metadata
      const parsedResponse = this.parseCustomerServiceResponse(result.response!);

      return {
        success: true,
        response: parsedResponse.message,
        tone: parsedResponse.tone,
        confidence: parsedResponse.confidence,
        usage: result.usage
      };
    } catch (error) {
      console.error('❌ Response generation failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Response generation failed'
      };
    }
  }

  /**
   * Analyze customer message for intent and sentiment
   */
  async analyzeMessage(
    message: string,
    customerId: string
  ): Promise<{
    success: boolean;
    analysis?: {
      intent: string;
      sentiment: string;
      confidence: number;
      entities: string[];
      urgency: 'low' | 'medium' | 'high';
      category: string;
    };
    usage?: any;
    error?: string;
  }> {
    try {
      const analysisPrompt = `
Analyze the following customer message and provide a JSON response with:
- intent: primary intent (complaint, inquiry, request, compliment, etc.)
- sentiment: positive, negative, or neutral
- confidence: confidence score 0-1
- entities: important entities mentioned (names, products, dates, etc.)
- urgency: low, medium, or high
- category: support category (technical, billing, general, etc.)

Customer message: "${message}"

Respond only with valid JSON:`;

      const result = await this.callLLM(analysisPrompt, {
        systemPrompt: 'You are an expert customer message analyzer. Always respond with valid JSON only.',
        maxTokens: 200,
        temperature: 0.3,
        customerId
      });

      if (!result.success) {
        return result;
      }

      try {
        const analysis = JSON.parse(result.response!);
        return {
          success: true,
          analysis,
          usage: result.usage
        };
      } catch (parseError) {
        console.error('❌ Failed to parse analysis JSON:', parseError);
        return {
          success: false,
          error: 'Failed to parse analysis response'
        };
      }
    } catch (error) {
      console.error('❌ Message analysis failed:', error);
      return {
        success: false,
        error: error instanceof Error ? error.message : 'Message analysis failed'
      };
    }
  }

  /**
   * Get cost tracking statistics
   */
  getCostStats(): CostTracker {
    return { ...this.costTracker };
  }

  /**
   * Reset daily usage (called at midnight)
   */
  resetDailyUsage(): void {
    this.costTracker.dailyTokens = 0;
    this.costTracker.lastResetDate = new Date().toISOString().split('T')[0];
    console.log('🔄 Daily LLM usage reset');
  }

  /**
   * Check if daily limit is exceeded
   */
  private checkDailyLimit(): boolean {
    const today = new Date().toISOString().split('T')[0];
    
    // Reset if new day
    if (this.costTracker.lastResetDate !== today) {
      this.resetDailyUsage();
    }

    return this.costTracker.dailyTokens < this.costTracker.dailyLimit;
  }

  /**
   * Calculate cost based on token usage
   */
  private calculateCost(promptTokens: number, completionTokens: number): number {
    const modelPricing = this.tokenPrices[this.config.model as keyof typeof this.tokenPrices];
    
    if (!modelPricing) {
      // Default pricing if model not found
      return (promptTokens + completionTokens) * 0.001 / 1000;
    }

    const promptCost = (promptTokens / 1000) * modelPricing.input;
    const completionCost = (completionTokens / 1000) * modelPricing.output;
    
    return promptCost + completionCost;
  }

  /**
   * Update cost tracking
   */
  private updateCostTracker(tokens: number, cost: number): void {
    this.costTracker.totalTokensUsed += tokens;
    this.costTracker.totalCost += cost;
    this.costTracker.requestCount += 1;
    this.costTracker.dailyTokens += tokens;
  }

  /**
   * Initialize cost tracker
   */
  private initializeCostTracker(): CostTracker {
    return {
      totalTokensUsed: 0,
      totalCost: 0,
      requestCount: 0,
      dailyTokens: 0,
      dailyLimit: parseInt(process.env.DAILY_TOKEN_LIMIT || '100000'),
      lastResetDate: new Date().toISOString().split('T')[0]
    };
  }

  /**
   * Get default system prompt for customer service
   */
  private getDefaultSystemPrompt(): string {
    return `You are a professional customer service AI assistant. Follow these guidelines:

1. Be helpful, polite, and empathetic
2. Provide accurate information based on company policies
3. If you don't know something, admit it and offer to escalate
4. Keep responses concise but complete
5. Always maintain a professional tone
6. Never make promises you cannot keep
7. Prioritize customer satisfaction while following company guidelines

Remember: You represent the company, so maintain high standards in all interactions.`;
  }

  /**
   * Build customer service system prompt with context
   */
  private buildCustomerServicePrompt(context: any): string {
    let prompt = this.getDefaultSystemPrompt();

    if (context.companyPolicies?.length > 0) {
      prompt += `\n\nCompany Policies:\n${context.companyPolicies.join('\n')}`;
    }

    if (context.customerName) {
      prompt += `\n\nCustomer Name: ${context.customerName}`;
    }

    if (context.intent) {
      prompt += `\n\nDetected Intent: ${context.intent}`;
    }

    if (context.sentiment) {
      prompt += `\n\nCustomer Sentiment: ${context.sentiment}`;
    }

    return prompt;
  }

  /**
   * Build enhanced prompt with context
   */
  private buildEnhancedPrompt(message: string, context: any): string {
    let prompt = `Customer Message: "${message}"`;

    if (context.previousMessages?.length > 0) {
      prompt += `\n\nPrevious Messages:\n${context.previousMessages.join('\n')}`;
    }

    prompt += '\n\nPlease provide a helpful response:';

    return prompt;
  }

  /**
   * Parse customer service response for metadata
   */
  private parseCustomerServiceResponse(response: string): {
    message: string;
    tone: string;
    confidence: number;
  } {
    // Simple tone detection based on keywords
    const lowerResponse = response.toLowerCase();
    let tone = 'neutral';
    
    if (lowerResponse.includes('sorry') || lowerResponse.includes('apologize')) {
      tone = 'apologetic';
    } else if (lowerResponse.includes('happy') || lowerResponse.includes('glad')) {
      tone = 'positive';
    } else if (lowerResponse.includes('understand') || lowerResponse.includes('help')) {
      tone = 'supportive';
    }

    // Simple confidence calculation based on response length and certainty words
    const certaintyWords = ['definitely', 'certainly', 'absolutely', 'sure', 'confirm'];
    const uncertaintyWords = ['might', 'maybe', 'possibly', 'perhaps', 'unsure'];
    
    let confidence = 0.7; // base confidence
    
    certaintyWords.forEach(word => {
      if (lowerResponse.includes(word)) confidence += 0.1;
    });
    
    uncertaintyWords.forEach(word => {
      if (lowerResponse.includes(word)) confidence -= 0.1;
    });

    confidence = Math.max(0.1, Math.min(1.0, confidence));

    return {
      message: response,
      tone,
      confidence
    };
  }
}

// Singleton instance
export const llmManager = new LLMManager();

// Export types
export type { LLMMessage, LLMRequest, LLMResponse, LLMConfig, CostTracker };
