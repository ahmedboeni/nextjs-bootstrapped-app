/**
 * Learning Loop Enhancements
 * Validates and filters training data to improve AI model quality
 */

interface TrainingData {
  id: string;
  customerId: string;
  originalMessage: string;
  aiResponse: string;
  humanResponse?: string;
  feedback?: 'positive' | 'negative' | 'neutral';
  timestamp: Date;
  context: {
    intent?: string;
    sentiment?: string;
    channel: string;
    resolved: boolean;
  };
  quality: {
    score: number;
    validated: boolean;
    reviewedBy?: string;
    reviewNotes?: string;
  };
}

interface ValidationResult {
  isValid: boolean;
  confidence: number;
  reasons: string[];
  requiresHumanReview: boolean;
  suggestedImprovements?: string[];
}

interface LearningMetrics {
  totalInteractions: number;
  validatedResponses: number;
  humanInterventions: number;
  averageQualityScore: number;
  improvementTrend: number;
  lastUpdated: Date;
}

class LearningLoopManager {
  private trainingData: Map<string, TrainingData> = new Map();
  private validationThreshold = 0.7; // Minimum similarity threshold
  private qualityThreshold = 0.8; // Minimum quality score for auto-approval
  private metrics: LearningMetrics;

  constructor() {
    this.metrics = this.initializeMetrics();
  }

  /**
   * Validate human response against AI response
   * Based on the pseudocode from the analysis
   */
  async validateHumanResponse(
    customerId: string,
    aiResponse: string,
    humanResponse: string,
    context?: Record<string, any>
  ): Promise<ValidationResult> {
    try {
      console.log(`🔍 Validating human response for customer ${customerId}`);

      // 1. Calculate semantic difference between AI and human responses
      const semanticDiff = await this.calculateSemanticDiff(aiResponse, humanResponse);
      
      // 2. Analyze response quality
      const qualityAnalysis = await this.analyzeResponseQuality(humanResponse, context);
      
      // 3. Check for policy compliance
      const policyCompliance = this.checkPolicyCompliance(humanResponse);
      
      // 4. Determine if human review is needed
      const requiresReview = semanticDiff > this.validationThreshold || 
                           qualityAnalysis.score < this.qualityThreshold ||
                           !policyCompliance.compliant;

      const reasons: string[] = [];
      const suggestedImprovements: string[] = [];

      if (semanticDiff > this.validationThreshold) {
        reasons.push(`High semantic difference: ${(semanticDiff * 100).toFixed(1)}%`);
        suggestedImprovements.push('Consider aligning response style with AI recommendations');
      }

      if (qualityAnalysis.score < this.qualityThreshold) {
        reasons.push(`Low quality score: ${(qualityAnalysis.score * 100).toFixed(1)}%`);
        suggestedImprovements.push(...qualityAnalysis.improvements);
      }

      if (!policyCompliance.compliant) {
        reasons.push('Policy compliance issues detected');
        suggestedImprovements.push(...policyCompliance.violations);
      }

      const result: ValidationResult = {
        isValid: !requiresReview,
        confidence: Math.min(1 - semanticDiff, qualityAnalysis.score),
        reasons,
        requiresHumanReview: requiresReview,
        suggestedImprovements: suggestedImprovements.length > 0 ? suggestedImprovements : undefined
      };

      // Log validation result
      if (requiresReview) {
        console.warn(`⚠️ Human response requires review: ${reasons.join(', ')}`);
        await this.sendToSupervisor(customerId, aiResponse, humanResponse, result);
      } else {
        console.log(`✅ Human response validated successfully`);
        await this.saveForTraining(customerId, humanResponse, context);
      }

      return result;
    } catch (error) {
      console.error('❌ Validation failed:', error);
      return {
        isValid: false,
        confidence: 0,
        reasons: ['Validation process failed'],
        requiresHumanReview: true
      };
    }
  }

  /**
   * Calculate semantic difference between two responses
   */
  private async calculateSemanticDiff(response1: string, response2: string): Promise<number> {
    try {
      // Simple similarity calculation based on word overlap and length
      // In production, you would use sentence-transformers or similar
      
      const words1 = this.tokenizeText(response1.toLowerCase());
      const words2 = this.tokenizeText(response2.toLowerCase());
      
      const set1 = new Set(words1);
      const set2 = new Set(words2);
      
      const intersection = new Set([...set1].filter(x => set2.has(x)));
      const union = new Set([...set1, ...set2]);
      
      const jaccardSimilarity = intersection.size / union.size;
      
      // Calculate length difference
      const lengthDiff = Math.abs(response1.length - response2.length) / Math.max(response1.length, response2.length);
      
      // Combine similarity metrics
      const semanticSimilarity = (jaccardSimilarity * 0.7) + ((1 - lengthDiff) * 0.3);
      
      // Return difference (1 - similarity)
      return 1 - semanticSimilarity;
    } catch (error) {
      console.error('❌ Semantic difference calculation failed:', error);
      return 1; // Maximum difference on error
    }
  }

  /**
   * Analyze response quality
   */
  private async analyzeResponseQuality(
    response: string,
    context?: Record<string, any>
  ): Promise<{
    score: number;
    improvements: string[];
  }> {
    const improvements: string[] = [];
    let score = 1.0;

    // Check response length
    if (response.length < 10) {
      score -= 0.3;
      improvements.push('Response is too short, provide more detail');
    } else if (response.length > 1000) {
      score -= 0.2;
      improvements.push('Response is too long, be more concise');
    }

    // Check for professional language
    const unprofessionalWords = ['stupid', 'dumb', 'whatever', 'idk', 'dunno'];
    const hasUnprofessional = unprofessionalWords.some(word => 
      response.toLowerCase().includes(word)
    );
    
    if (hasUnprofessional) {
      score -= 0.4;
      improvements.push('Use more professional language');
    }

    // Check for empathy indicators
    const empathyWords = ['understand', 'sorry', 'apologize', 'help', 'assist'];
    const hasEmpathy = empathyWords.some(word => 
      response.toLowerCase().includes(word)
    );
    
    if (!hasEmpathy && context?.sentiment === 'negative') {
      score -= 0.2;
      improvements.push('Show more empathy for customer concerns');
    }

    // Check for solution-oriented language
    const solutionWords = ['will', 'can', 'resolve', 'fix', 'solution', 'help'];
    const hasSolution = solutionWords.some(word => 
      response.toLowerCase().includes(word)
    );
    
    if (!hasSolution && context?.intent === 'complaint') {
      score -= 0.2;
      improvements.push('Provide clear solutions or next steps');
    }

    // Check for proper grammar (basic check)
    if (!response.includes('.') && !response.includes('!') && !response.includes('?')) {
      score -= 0.1;
      improvements.push('Use proper punctuation');
    }

    return {
      score: Math.max(0, score),
      improvements
    };
  }

  /**
   * Check policy compliance
   */
  private checkPolicyCompliance(response: string): {
    compliant: boolean;
    violations: string[];
  } {
    const violations: string[] = [];
    const lowerResponse = response.toLowerCase();

    // Check for prohibited content
    const prohibitedPhrases = [
      'not my problem',
      'that\'s impossible',
      'we don\'t do that',
      'you\'re wrong',
      'calm down'
    ];

    prohibitedPhrases.forEach(phrase => {
      if (lowerResponse.includes(phrase)) {
        violations.push(`Avoid using phrase: "${phrase}"`);
      }
    });

    // Check for required elements in certain contexts
    if (lowerResponse.includes('refund') && !lowerResponse.includes('policy')) {
      violations.push('Mention refund policy when discussing refunds');
    }

    if (lowerResponse.includes('technical') && !lowerResponse.includes('support')) {
      violations.push('Offer technical support for technical issues');
    }

    return {
      compliant: violations.length === 0,
      violations
    };
  }

  /**
   * Send response to supervisor for review
   */
  private async sendToSupervisor(
    customerId: string,
    aiResponse: string,
    humanResponse: string,
    validationResult: ValidationResult
  ): Promise<void> {
    try {
      // In a real implementation, this would send to a review queue
      // For now, we'll log it and store for manual review
      
      const reviewItem = {
        id: this.generateId(),
        customerId,
        aiResponse,
        humanResponse,
        validationResult,
        timestamp: new Date(),
        status: 'pending_review'
      };

      console.log('📋 Sending to supervisor for review:', {
        customerId,
        reasons: validationResult.reasons,
        confidence: validationResult.confidence
      });

      // Store in review queue (in production, this would be a database)
      // For now, we'll just log it
      this.logReviewItem(reviewItem);
    } catch (error) {
      console.error('❌ Failed to send to supervisor:', error);
    }
  }

  /**
   * Save validated response for training
   */
  private async saveForTraining(
    customerId: string,
    response: string,
    context?: Record<string, any>
  ): Promise<void> {
    try {
      const trainingItem: TrainingData = {
        id: this.generateId(),
        customerId,
        originalMessage: context?.originalMessage || '',
        aiResponse: context?.aiResponse || '',
        humanResponse: response,
        feedback: 'positive', // Validated responses are considered positive
        timestamp: new Date(),
        context: {
          intent: context?.intent,
          sentiment: context?.sentiment,
          channel: context?.channel || 'unknown',
          resolved: true
        },
        quality: {
          score: 0.9, // High score for validated responses
          validated: true,
          reviewedBy: 'system'
        }
      };

      this.trainingData.set(trainingItem.id, trainingItem);
      this.updateMetrics(trainingItem);

      console.log(`💾 Saved validated response for training: ${trainingItem.id}`);
    } catch (error) {
      console.error('❌ Failed to save for training:', error);
    }
  }

  /**
   * Get training data for model improvement
   */
  getTrainingData(filters?: {
    customerId?: string;
    channel?: string;
    minQualityScore?: number;
    dateRange?: { start: Date; end: Date };
  }): TrainingData[] {
    let data = Array.from(this.trainingData.values());

    if (filters) {
      if (filters.customerId) {
        data = data.filter(item => item.customerId === filters.customerId);
      }
      
      if (filters.channel) {
        data = data.filter(item => item.context.channel === filters.channel);
      }
      
      if (filters.minQualityScore !== undefined) {
        data = data.filter(item => item.quality.score >= filters.minQualityScore!);
      }
      
      if (filters.dateRange) {
        data = data.filter(item => 
          item.timestamp >= filters.dateRange!.start && 
          item.timestamp <= filters.dateRange!.end
        );
      }
    }

    return data.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime());
  }

  /**
   * Get learning metrics
   */
  getLearningMetrics(): LearningMetrics {
    return { ...this.metrics };
  }

  /**
   * Add feedback to training data
   */
  addFeedback(
    trainingId: string,
    feedback: 'positive' | 'negative' | 'neutral',
    notes?: string
  ): boolean {
    const trainingItem = this.trainingData.get(trainingId);
    
    if (!trainingItem) {
      return false;
    }

    trainingItem.feedback = feedback;
    if (notes) {
      trainingItem.quality.reviewNotes = notes;
    }

    // Adjust quality score based on feedback
    if (feedback === 'negative') {
      trainingItem.quality.score = Math.max(0.1, trainingItem.quality.score - 0.3);
    } else if (feedback === 'positive') {
      trainingItem.quality.score = Math.min(1.0, trainingItem.quality.score + 0.1);
    }

    this.trainingData.set(trainingId, trainingItem);
    console.log(`📝 Added feedback to training item ${trainingId}: ${feedback}`);
    
    return true;
  }

  /**
   * Export training data for model training
   */
  exportTrainingData(format: 'json' | 'csv' = 'json'): string {
    const data = this.getTrainingData({ minQualityScore: 0.7 });
    
    if (format === 'json') {
      return JSON.stringify(data, null, 2);
    } else {
      // CSV format
      const headers = ['id', 'customerId', 'originalMessage', 'aiResponse', 'humanResponse', 'feedback', 'qualityScore'];
      const rows = data.map(item => [
        item.id,
        item.customerId,
        item.originalMessage.replace(/"/g, '""'),
        item.aiResponse.replace(/"/g, '""'),
        item.humanResponse?.replace(/"/g, '""') || '',
        item.feedback || '',
        item.quality.score.toString()
      ]);
      
      return [headers.join(','), ...rows.map(row => row.map(cell => `"${cell}"`).join(','))].join('\n');
    }
  }

  /**
   * Tokenize text for similarity calculation
   */
  private tokenizeText(text: string): string[] {
    return text
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 2);
  }

  /**
   * Generate unique ID
   */
  private generateId(): string {
    return `train_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  /**
   * Log review item
   */
  private logReviewItem(item: any): void {
    console.log('📋 Review Item:', {
      id: item.id,
      customerId: item.customerId,
      timestamp: item.timestamp,
      reasons: item.validationResult.reasons
    });
  }

  /**
   * Update learning metrics
   */
  private updateMetrics(trainingItem: TrainingData): void {
    this.metrics.totalInteractions++;
    
    if (trainingItem.quality.validated) {
      this.metrics.validatedResponses++;
    }
    
    if (trainingItem.humanResponse) {
      this.metrics.humanInterventions++;
    }

    // Recalculate average quality score
    const allScores = Array.from(this.trainingData.values()).map(item => item.quality.score);
    this.metrics.averageQualityScore = allScores.reduce((sum, score) => sum + score, 0) / allScores.length;
    
    this.metrics.lastUpdated = new Date();
  }

  /**
   * Initialize metrics
   */
  private initializeMetrics(): LearningMetrics {
    return {
      totalInteractions: 0,
      validatedResponses: 0,
      humanInterventions: 0,
      averageQualityScore: 0,
      improvementTrend: 0,
      lastUpdated: new Date()
    };
  }
}

// Singleton instance
export const learningLoopManager = new LearningLoopManager();

// Export types
export type { TrainingData, ValidationResult, LearningMetrics };
