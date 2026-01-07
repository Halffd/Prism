
// Define ContextData interface locally since import was removed
interface ContextData {
  type: 'page' | 'screen' | 'selection';
  url?: string;
  title?: string;
  selectedText?: string;
  fullText?: string;
  appName?: string;
  metadata?: Record<string, unknown>;
}

export interface ProcessedContext {
  summary: string;
  keywords: string[];
  sentiment: 'positive' | 'negative' | 'neutral';
  relevanceScore: number;
  entities: string[];
}

export class ContextProcessor {
  process(context: ContextData | undefined): ProcessedContext {
    if (!context) {
      return {
        summary: '',
        keywords: [],
        sentiment: 'neutral',
        relevanceScore: 0,
        entities: []
      };
    }

    let summary = '';
    const keywords: string[] = [];
    const entities: string[] = [];

    // Process title
    if (context.title) {
      summary += `Title: ${context.title}. `;
      keywords.push(...this.extractKeywords(context.title));
    }

    // Process URL - extract meaningful parts
    if (context.url) {
      const urlParts = this.extractUrlParts(context.url);
      if (urlParts.length > 0) {
        summary += `URL context: ${urlParts.join(', ')}. `;
        keywords.push(...urlParts);
      }
    }

    // Process selected text
    let fullContent = '';
    if (context.selectedText) {
      fullContent += `Selected text: "${context.selectedText}". `;
      keywords.push(...this.extractKeywords(context.selectedText));
      entities.push(...this.extractEntities(context.selectedText));
    }

    // Process full text if available
    if (context.fullText) {
      // Limit the summary to avoid overly long context
      const contentSummary = context.fullText.length > 2000
        ? context.fullText.substring(0, 2000) + '...'
        : context.fullText;
      fullContent += `Content: ${contentSummary}. `;

      keywords.push(...this.extractKeywords(context.fullText.substring(0, 1000)));
      entities.push(...this.extractEntities(context.fullText.substring(0, 1000)));
    }

    summary += fullContent;

    // Determine sentiment and relevance
    const sentiment = this.analyzeSentiment(summary);
    const relevanceScore = this.calculateRelevanceScore(context);

    // Remove duplicates
    const uniqueKeywords = [...new Set(keywords)];
    const uniqueEntities = [...new Set(entities)];

    return {
      summary,
      keywords: uniqueKeywords,
      sentiment,
      relevanceScore,
      entities: uniqueEntities
    };
  }

  private extractKeywords(text: string): string[] {
    if (!text) return [];

    // Simple keyword extraction - in a real app, this would use NLP
    const words = text.toLowerCase()
      .replace(/[^\w\s]/g, ' ')
      .split(/\s+/)
      .filter(word => word.length > 3 && !this.isStopWord(word));

    // Return top 10 most frequent words
    const wordCount: { [key: string]: number } = {};
    words.forEach(word => {
      wordCount[word] = (wordCount[word] || 0) + 1;
    });

    return Object.entries(wordCount)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([word]) => word);
  }

  private extractEntities(text: string): string[] {
    if (!text) return [];

    // Simple entity extraction - find capitalized words
    const entityRegex = /\b[A-Z][a-z]+\b/g;
    const matches = text.match(entityRegex) || [];
    return [...new Set(matches)].slice(0, 20);
  }

  private extractUrlParts(url: string): string[] {
    try {
      const urlObj = new URL(url);
      const parts = [];

      // Extract domain
      parts.push(urlObj.hostname.replace('www.', ''));

      // Extract path segments
      const pathSegments = urlObj.pathname.split('/').filter(segment => segment);
      parts.push(...pathSegments);

      return parts.slice(0, 10);
    } catch {
      return [];
    }
  }

  private isStopWord(word: string): boolean {
    const stopWords = new Set([
      'the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for',
      'of', 'with', 'by', 'is', 'are', 'was', 'were', 'be', 'been', 'have',
      'has', 'had', 'do', 'does', 'did', 'will', 'would', 'could', 'should',
      'this', 'that', 'these', 'those', 'i', 'you', 'he', 'she', 'it', 'we', 'they'
    ]);
    return stopWords.has(word.toLowerCase());
  }

  private analyzeSentiment(text: string): 'positive' | 'negative' | 'neutral' {
    if (!text) return 'neutral';

    const positiveWords = ['good', 'great', 'excellent', 'amazing', 'wonderful', 'fantastic', 'love', 'like', 'awesome', 'perfect'];
    const negativeWords = ['bad', 'terrible', 'awful', 'horrible', 'hate', 'dislike', 'worst', 'sucks', 'stupid', 'useless'];

    const lowerText = text.toLowerCase();
    const positiveCount = positiveWords.filter(word => lowerText.includes(word)).length;
    const negativeCount = negativeWords.filter(word => lowerText.includes(word)).length;

    if (positiveCount > negativeCount) return 'positive';
    if (negativeCount > positiveCount) return 'negative';
    return 'neutral';
  }

  private calculateRelevanceScore(context: ContextData): number {
    let score = 0;

    if (context.title) score += 20;
    if (context.url) score += 10;
    if (context.selectedText) score += 30;
    if (context.fullText && context.fullText.length > 0) score += 25;
    if (context.metadata) score += 15;

    // Cap the score between 0 and 100
    return Math.min(100, score);
  }
}

export const createContextProcessor = () => new ContextProcessor();