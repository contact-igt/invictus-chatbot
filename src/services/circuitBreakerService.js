/**
 * Circuit Breaker Pattern Implementation
 *
 * Provides resilience against cascading failures when calling external APIs.
 * Automatically opens circuit when failure threshold is exceeded, preventing
 * further calls until the service recovers.
 */
import { logger } from "../utils/logger.js";

export class CircuitBreaker {
  constructor(protectedFunction, options = {}) {
    this.protectedFunction = protectedFunction;
    this.failureThreshold = options.failureThreshold || 5;
    this.resetTimeout = options.resetTimeout || 60000; // 1 minute
    this.monitoringPeriod = options.monitoringPeriod || 60000; // 1 minute
    this.name = options.name || "CircuitBreaker";

    // Circuit states
    this.states = {
      CLOSED: "CLOSED", // Normal operation
      OPEN: "OPEN", // Circuit is open, failing fast
      HALF_OPEN: "HALF_OPEN", // Testing if service recovered
    };

    this.state = this.states.CLOSED;
    this.failures = 0;
    this.lastFailureTime = null;
    this.nextAttemptTime = null;

    // Monitoring
    this.callCount = 0;
    this.successCount = 0;
    this.failureCount = 0;
    this.monitoringStartTime = Date.now();

    // Start monitoring reset
    this.startMonitoring();
  }

  /**
   * Execute the protected function through the circuit breaker
   * @param {...any} args - Arguments to pass to the protected function
   * @returns {Promise<any>}
   */
  async execute(...args) {
    this.callCount++;

    if (this.state === this.states.OPEN) {
      if (Date.now() < this.nextAttemptTime) {
        throw new Error(`Circuit breaker is OPEN for ${this.name}`);
      }

      // Time to try again - move to half-open
      this.state = this.states.HALF_OPEN;
      logger.info(`[CIRCUIT-BREAKER] ${this.name} moving to HALF_OPEN state`);
    }

    try {
      const result = await this.protectedFunction(...args);

      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error);
      throw error;
    }
  }

  /**
   * Handle successful execution
   */
  onSuccess() {
    this.successCount++;

    if (this.state === this.states.HALF_OPEN) {
      // Service recovered - close the circuit
      this.state = this.states.CLOSED;
      this.failures = 0;
      this.lastFailureTime = null;
      this.nextAttemptTime = null;

      logger.info(`[CIRCUIT-BREAKER] ${this.name} recovered, circuit CLOSED`);
    }
  }

  /**
   * Handle failed execution
   * @param {Error} error - The error that occurred
   */
  onFailure(error) {
    this.failureCount++;
    this.failures++;
    this.lastFailureTime = Date.now();

    const errorMessage = error?.message || "Unknown error";

    if (this.state === this.states.HALF_OPEN) {
      // Failed during recovery test - open circuit again
      this.state = this.states.OPEN;
      this.nextAttemptTime = Date.now() + this.resetTimeout;

      logger.warn(
        `[CIRCUIT-BREAKER] ${this.name} recovery failed, circuit OPEN: ${errorMessage}`,
      );
    } else if (this.failures >= this.failureThreshold) {
      // Failure threshold exceeded - open circuit
      this.state = this.states.OPEN;
      this.nextAttemptTime = Date.now() + this.resetTimeout;

      logger.warn(
        `[CIRCUIT-BREAKER] ${this.name} failure threshold exceeded (${this.failures}/${this.failureThreshold}), circuit OPEN: ${errorMessage}`,
      );
    }
  }

  /**
   * Start monitoring for automatic reset attempts
   */
  startMonitoring() {
    setInterval(() => {
      this.resetMonitoringCounters();

      // Log circuit status periodically
      if (this.callCount > 0) {
        const successRate = (this.successCount / this.callCount) * 100;
        logger.debug(
          `[CIRCUIT-BREAKER] ${this.name} status: ${this.state}, calls: ${this.callCount}, success rate: ${successRate.toFixed(1)}%`,
        );
      }
    }, this.monitoringPeriod);
  }

  /**
   * Reset monitoring counters
   */
  resetMonitoringCounters() {
    this.callCount = 0;
    this.successCount = 0;
    this.failureCount = 0;
    this.monitoringStartTime = Date.now();
  }

  /**
   * Get current circuit breaker status
   * @returns {Object}
   */
  getStatus() {
    return {
      name: this.name,
      state: this.state,
      failures: this.failures,
      failureThreshold: this.failureThreshold,
      lastFailureTime: this.lastFailureTime,
      nextAttemptTime: this.nextAttemptTime,
      callCount: this.callCount,
      successCount: this.successCount,
      failureCount: this.failureCount,
      successRate:
        this.callCount > 0 ? (this.successCount / this.callCount) * 100 : 0,
    };
  }

  /**
   * Manually reset the circuit breaker
   */
  reset() {
    this.state = this.states.CLOSED;
    this.failures = 0;
    this.lastFailureTime = null;
    this.nextAttemptTime = null;
    this.resetMonitoringCounters();

    logger.info(`[CIRCUIT-BREAKER] ${this.name} manually reset to CLOSED`);
  }

  /**
   * Force the circuit open (for testing or maintenance)
   */
  forceOpen() {
    this.state = this.states.OPEN;
    this.nextAttemptTime = Date.now() + this.resetTimeout;

    logger.warn(`[CIRCUIT-BREAKER] ${this.name} forcibly opened`);
  }
}

// Meta API specific circuit breaker with WhatsApp-specific error handling
export class MetaApiCircuitBreaker extends CircuitBreaker {
  constructor(protectedFunction, options = {}) {
    super(protectedFunction, {
      name: "MetaAPI",
      failureThreshold: 10, // Higher threshold for Meta API
      resetTimeout: 120000, // 2 minutes
      monitoringPeriod: 300000, // 5 minutes
      ...options,
    });
  }

  /**
   * Enhanced failure detection for Meta API specific errors
   * @param {Error} error - The error that occurred
   */
  onFailure(error) {
    const errorMessage = error?.message || "";

    // Check for specific Meta API unhealthy indicators
    const isUnhealthy =
      errorMessage.toLowerCase().includes("unhealthy") ||
      errorMessage.toLowerCase().includes("service unavailable") ||
      errorMessage.toLowerCase().includes("502") ||
      errorMessage.toLowerCase().includes("503") ||
      errorMessage.toLowerCase().includes("504");

    if (isUnhealthy) {
      // Treat unhealthy responses as more severe failures
      this.failures += 2; // Count as 2 failures
      logger.warn(
        `[CIRCUIT-BREAKER] Meta API unhealthy detected: ${errorMessage}`,
      );
    }

    // Call parent failure handler
    super.onFailure(error);
  }
}

// Campaign-specific circuit breaker instances
let metaApiCircuitBreaker = null;

export const getMetaApiCircuitBreaker = (protectedFunction) => {
  if (!metaApiCircuitBreaker && protectedFunction) {
    metaApiCircuitBreaker = new MetaApiCircuitBreaker(protectedFunction);
  }
  return metaApiCircuitBreaker;
};

// Utility function to wrap any async function with circuit breaker
export const withCircuitBreaker = (
  fn,
  breakerName = "Generic",
  options = {},
) => {
  const breaker = new CircuitBreaker(fn, { name: breakerName, ...options });
  return (...args) => breaker.execute(...args);
};
