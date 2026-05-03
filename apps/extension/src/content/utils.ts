// utils.ts - Utility functions for the content script

// Simple token estimation function (roughly 1 token = 4 characters or 1 word)
export function estimateTokenCount(text: string): number {
  if (!text || text.length === 0) return 0;

  // Simple estimation: split by whitespace and punctuation
  const words = text.trim().split(/\s+/).filter(word => word.length > 0);
  // Rough estimation: about 1 token per word, but longer words might be multiple tokens
  let tokenCount = 0;
  for (const word of words) {
    // For longer words, count as multiple tokens (common in tokenizers)
    if (word.length <= 4) {
      tokenCount += 1;
    } else {
      // Estimate: 1 token per 4-5 characters
      tokenCount += Math.ceil(word.length / 4);
    }
  }
  return Math.max(1, tokenCount);
}

// Truncate text to a specific token limit
export function truncateToTokenLimit(text: string, tokenLimit: number): string {
  if (tokenLimit <= 0) return '';
  if (estimateTokenCount(text) <= tokenLimit) return text;

  // Simple truncation: split into words and reduce until under the limit
  const words = text.split(/\s+/);
  let result = '';

  for (const word of words) {
    const testResult = result + (result ? ' ' : '') + word;
    if (estimateTokenCount(testResult) > tokenLimit) {
      break;
    }
    result = testResult;
  }

  return result;
}

// Check if an element should be ignored (form elements, sensitive info, etc.)
export function isIgnoredElement(element: Element | null): boolean {
  if (!element) return false;

  const tagName = element.tagName.toLowerCase();
  const className = element.className.toLowerCase();
  const id = element.id.toLowerCase();

  // Ignore form elements
  if (['input', 'textarea', 'select', 'option', 'button', 'form'].includes(tagName)) {
    return true;
  }

  // Ignore elements that might contain emails or sensitive info
  if (className.includes('email') || className.includes('contact') ||
      id.includes('email') || id.includes('contact') ||
      className.includes('form') || id.includes('form') ||
      className.includes('login') || id.includes('login') ||
      className.includes('password') || id.includes('password')) {
    return true;
  }

  // Ignore script and style tags
  if (['script', 'style', 'noscript'].includes(tagName)) {
    return true;
  }

  return false;
}