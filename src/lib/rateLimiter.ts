/**
 * Rate Limiting Middleware
 * Protects endpoints against abuse and implements channel-specific limits
 */

interface RateLimitConfig {
  windowMs: number;
  maxRequests: number;
  skipSuccessfulRequests?: boolean;
  skipFailedRequests?: boolean;
}

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  resetTime: number;
  retryAfter?: number;
}

class RateLimiter {
  private store = new Map<string, RateLimitEntry>();
  private config: RateLimitConfig;

  constructor(config: RateLimitConfig = {
    windowMs: parseInt(process.env.RATE_LIMIT_WINDOW_MS || '60000'),
    maxRequests: parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100')
  }) {
    this.config = config;
    
    // Clean up expired entries every minute
    setInterval(() => {
      this.cleanup();
    }, 60000);
  }

  /**
   * Check if request is allowed under rate limit
   */
  checkLimit(identifier: string): RateLimitResult {
    const now = Date.now();
    const key = this.generateKey(identifier);
    const entry = this.store.get(key);

    // If no entry exists or window has expired, create new entry
    if (!entry || now >= entry.resetTime) {
      const newEntry: RateLimitEntry = {
        count: 1,
        resetTime: now + this.config.windowMs
      };
      this.store.set(key, newEntry);

      return {
        allowed: true,
        remaining: this.config.maxRequests - 1,
        resetTime: newEntry.resetTime
      };
    }

    // Check if limit exceeded
    if (entry.count >= this.config.maxRequests) {
      const retryAfter = Math.ceil((entry.resetTime - now) / 1000);
      
      console.warn(`🚨 Rate limit exceeded for ${identifier}. Retry after ${retryAfter}s`);
      
      return {
        allowed: false,
        remaining: 0,
        resetTime: entry.resetTime,
        retryAfter
      };
    }

    // Increment counter
    entry.count++;
    this.store.set(key, entry);

    console.log(`✅ Rate limit check passed for ${identifier}. ${this.config.maxRequests - entry.count} remaining`);

    return {
      allowed: true,
      remaining: this.config.maxRequests - entry.count,
      resetTime: entry.resetTime
    };
  }

  /**
   * Channel-specific rate limiting
   */
  checkChannelLimit(channel: string, userId: string): RateLimitResult {
    // Different limits for different channels
    const channelLimits: Record<string, RateLimitConfig> = {
      whatsapp: { windowMs: 60000, maxRequests: 30 }, // 30 messages per minute
      telegram: { windowMs: 60000, maxRequests: 50 }, // 50 messages per minute
      email: { windowMs: 300000, maxRequests: 10 },   // 10 emails per 5 minutes
      web: { windowMs: 60000, maxRequests: 100 }      // 100 requests per minute
    };

    const channelConfig = channelLimits[channel] || this.config;
    const tempLimiter = new RateLimiter(channelConfig);
    
    return tempLimiter.checkLimit(`${channel}:${userId}`);
  }

  /**
   * IP-based rate limiting
   */
  checkIPLimit(ipAddress: string): RateLimitResult {
    // Stricter limits for IP addresses
    const ipConfig: RateLimitConfig = {
      windowMs: 60000,  // 1 minute
      maxRequests: 200  // 200 requests per minute per IP
    };

    const tempLimiter = new RateLimiter(ipConfig);
    return tempLimiter.checkLimit(`ip:${ipAddress}`);
  }

  /**
   * Global rate limiting (across all users)
   */
  checkGlobalLimit(): RateLimitResult {
    const globalConfig: RateLimitConfig = {
      windowMs: 60000,   // 1 minute
      maxRequests: 10000 // 10k requests per minute globally
    };

    const tempLimiter = new RateLimiter(globalConfig);
    return tempLimiter.checkLimit('global');
  }

  /**
   * Reset rate limit for specific identifier
   */
  resetLimit(identifier: string): void {
    const key = this.generateKey(identifier);
    this.store.delete(key);
    console.log(`🔄 Rate limit reset for ${identifier}`);
  }

  /**
   * Get current usage statistics
   */
  getUsageStats(identifier: string): {
    current: number;
    limit: number;
    remaining: number;
    resetTime: number;
  } | null {
    const key = this.generateKey(identifier);
    const entry = this.store.get(key);

    if (!entry) {
      return null;
    }

    return {
      current: entry.count,
      limit: this.config.maxRequests,
      remaining: Math.max(0, this.config.maxRequests - entry.count),
      resetTime: entry.resetTime
    };
  }

  /**
   * Get all active rate limit entries (for monitoring)
   */
  getAllActiveEntries(): Array<{
    identifier: string;
    count: number;
    limit: number;
    resetTime: number;
  }> {
    const now = Date.now();
    const activeEntries: Array<{
      identifier: string;
      count: number;
      limit: number;
      resetTime: number;
    }> = [];

    this.store.forEach((entry, key) => {
      if (entry.resetTime > now) {
        activeEntries.push({
          identifier: key,
          count: entry.count,
          limit: this.config.maxRequests,
          resetTime: entry.resetTime
        });
      }
    });

    return activeEntries.sort((a, b) => b.count - a.count);
  }

  /**
   * Clean up expired entries
   */
  private cleanup(): void {
    const now = Date.now();
    let cleanedCount = 0;

    this.store.forEach((entry, key) => {
      if (now >= entry.resetTime) {
        this.store.delete(key);
        cleanedCount++;
      }
    });

    if (cleanedCount > 0) {
      console.log(`🧹 Cleaned up ${cleanedCount} expired rate limit entries`);
    }
  }

  /**
   * Generate storage key for identifier
   */
  private generateKey(identifier: string): string {
    return `ratelimit:${identifier}`;
  }
}

/**
 * Express-like middleware function for Next.js API routes
 */
export function createRateLimitMiddleware(config?: RateLimitConfig) {
  const limiter = new RateLimiter(config);
  const maxRequests = config?.maxRequests || parseInt(process.env.RATE_LIMIT_MAX_REQUESTS || '100');

  return function rateLimitMiddleware(
    request: Request,
    identifier?: string
  ): {
    success: boolean;
    headers: Record<string, string>;
    error?: string;
  } {
    // Extract identifier from request if not provided
    const clientId = identifier || 
      request.headers.get('x-forwarded-for') || 
      request.headers.get('x-real-ip') || 
      'unknown';

    const result = limiter.checkLimit(clientId);

    const headers: Record<string, string> = {
      'X-RateLimit-Limit': maxRequests.toString(),
      'X-RateLimit-Remaining': result.remaining.toString(),
      'X-RateLimit-Reset': new Date(result.resetTime).toISOString()
    };

    if (!result.allowed && result.retryAfter) {
      headers['Retry-After'] = result.retryAfter.toString();
    }

    return {
      success: result.allowed,
      headers,
      error: result.allowed ? undefined : 'Rate limit exceeded'
    };
  };
}

/**
 * Multi-layer rate limiting for comprehensive protection
 */
export class MultiLayerRateLimiter {
  private ipLimiter: RateLimiter;
  private userLimiter: RateLimiter;
  private globalLimiter: RateLimiter;

  constructor() {
    this.ipLimiter = new RateLimiter({
      windowMs: 60000,
      maxRequests: 200
    });

    this.userLimiter = new RateLimiter({
      windowMs: 60000,
      maxRequests: 100
    });

    this.globalLimiter = new RateLimiter({
      windowMs: 60000,
      maxRequests: 10000
    });
  }

  /**
   * Check all rate limit layers
   */
  checkAllLimits(ipAddress: string, userId?: string, channel?: string): {
    allowed: boolean;
    layer: string;
    details: RateLimitResult;
  } {
    // Check global limit first
    const globalResult = this.globalLimiter.checkLimit('global');
    if (!globalResult.allowed) {
      return { allowed: false, layer: 'global', details: globalResult };
    }

    // Check IP limit
    const ipResult = this.ipLimiter.checkLimit(`ip:${ipAddress}`);
    if (!ipResult.allowed) {
      return { allowed: false, layer: 'ip', details: ipResult };
    }

    // Check user limit if userId provided
    if (userId) {
      const userResult = this.userLimiter.checkLimit(`user:${userId}`);
      if (!userResult.allowed) {
        return { allowed: false, layer: 'user', details: userResult };
      }
    }

    // Check channel-specific limit if provided
    if (channel && userId) {
      const channelResult = this.userLimiter.checkChannelLimit(channel, userId);
      if (!channelResult.allowed) {
        return { allowed: false, layer: 'channel', details: channelResult };
      }
    }

    // All checks passed
    return { 
      allowed: true, 
      layer: 'none', 
      details: { allowed: true, remaining: 999, resetTime: Date.now() + 60000 }
    };
  }
}

// Export singleton instances
export const rateLimiter = new RateLimiter();
export const multiLayerLimiter = new MultiLayerRateLimiter();

// Export types
export type { RateLimitConfig, RateLimitResult };
