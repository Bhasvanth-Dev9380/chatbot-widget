/**
 * Helper utilities for entities component
 */

const VALID_PRODUCT_IDS = new Set(['slm', 'voice_agent', 'workflows', 'chatbot_builder']);

/**
 * Validate product ID (accepts any non-empty string)
 */
export function assertProductId(productId: string) {
  if (!productId || typeof productId !== 'string') {
    throw new Error('productId must be a non-empty string');
  }
  if (productId.trim().length === 0) {
    throw new Error('productId cannot be empty or whitespace');
  }
}

/**
 * Check if product ID is one of the standard products
 */
export function isStandardProduct(productId: string): boolean {
  return VALID_PRODUCT_IDS.has(productId);
}

/**
 * Get current month in yyyy_mm format
 */
export function getCurrentMonth(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}_${month}`;
}

/**
 * Get current month in yyyymm format
 */
export function getCurrentMonthCompact(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, '0');
  return `${year}${month}`;
}

/**
 * Generate UUID v4
 */
export function generateId(): string {
  return crypto.randomUUID();
}

/**
 * Initialize default product allocations
 */
export function getDefaultProductAllocations() {
  return {
    slm: { allocated: 0, consumed: 0, isEnabled: false },
    voice_agent: { allocated: 0, consumed: 0, isEnabled: false },
    workflows: { allocated: 0, consumed: 0, isEnabled: false },
    chatbot_builder: { allocated: 0, consumed: 0, isEnabled: false },
  };
}
