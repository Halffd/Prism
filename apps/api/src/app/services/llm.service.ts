// Define interfaces locally since imports are having issues
interface Message {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;
  images?: string[];
  context?: ContextData;
  timestamp: number;
  tokens?: number;
}

interface ContextData {
  type: 'page' | 'screen' | 'selection';
  url?: string;
  title?: string;
  selectedText?: string;
  fullText?: string;
  appName?: string;
  metadata?: Record<string, unknown>;
}

export interface LLMConfig {
  apiKey: string;
  model?: string;
  baseUrl?: string;
  provider?: 'openai' | 'anthropic' | 'custom';
}

export interface LLMMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export class LLMService {
  private config: LLMConfig;

  constructor(config: LLMConfig) {
    this.config = config;
  }

  async generateResponse(
    messages: Message[],
    context?: ContextData
  ): Promise<string> {
    try {
      // Format messages for LLM API
      const formattedMessages: LLMMessage[] = this.formatMessagesForLLM(messages, context);

      // Call the appropriate LLM provider
      switch (this.config.provider) {
        case 'openai':
          return await this.callOpenAI(formattedMessages);
        case 'anthropic':
          return await this.callAnthropic(formattedMessages);
        default:
          return await this.callOpenAI(formattedMessages); // Default to OpenAI
      }
    } catch (error) {
      console.error('LLM Service Error:', error);

      // Return a fallback response
      const lastUserMessage = messages[messages.length - 1]?.content;
      return `I encountered an issue processing your request about "${lastUserMessage || 'the topic'}". Please try again.`;
    }
  }

  private formatMessagesForLLM(
    messages: Message[],
    context?: ContextData
  ): LLMMessage[] {
    // Create system message with context if available
    let systemMessageContent = 'You are Prism, a helpful AI assistant that can answer questions based on provided context. Be concise and helpful.';

    if (context) {
      const contextText = [];
      if (context.title) contextText.push(`Page title: ${context.title}`);
      if (context.url) contextText.push(`Page URL: ${context.url}`);
      if (context.selectedText) contextText.push(`Selected text: "${context.selectedText}"`);
      if (context.fullText) {
        const truncatedText = context.fullText.length > 2000
          ? context.fullText.substring(0, 2000) + '...'
          : context.fullText;
        contextText.push(`Page content: ${truncatedText}`);
      }

      if (contextText.length > 0) {
        systemMessageContent += `\n\nRelevant context:\n${contextText.join('\n')}`;
      }
    }

    const formattedMessages: LLMMessage[] = [
      { role: 'system', content: systemMessageContent }
    ];

    // Add conversation history
    for (const msg of messages) {
      formattedMessages.push({
        role: msg.role as 'user' | 'assistant',
        content: msg.content
      });
    }

    return formattedMessages;
  }

  private async callOpenAI(messages: LLMMessage[]): Promise<string> {
    // Check if we're in development mode (no real API key)
    if (!this.config.apiKey || this.config.apiKey === 'fake-api-key') {
      // Return simulated response in development
      return this.simulateResponse(messages);
    }

    const response = await fetch(
      this.config.baseUrl || 'https://api.openai.com/v1/chat/completions',
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${this.config.apiKey}`
        },
        body: JSON.stringify({
          model: this.config.model || 'gpt-3.5-turbo',
          messages: messages,
          temperature: 0.7,
          max_tokens: 1000
        })
      }
    );

    if (!response.ok) {
      const errorData: any = await response.json();
      throw new Error(`OpenAI API error: ${errorData.error?.message || 'Unknown error'}`);
    }

    const data: any = await response.json();
    return data.choices[0].message.content;
  }

  private async callAnthropic(messages: LLMMessage[]): Promise<string> {
    // Check if we're in development mode (no real API key)
    if (!this.config.apiKey || this.config.apiKey === 'fake-api-key') {
      // Return simulated response in development
      return this.simulateResponse(messages);
    }

    // Anthropic API requires system messages to be separate
    const userMessages = messages.filter(m => m.role !== 'system');
    const systemMessage = messages.find(m => m.role === 'system')?.content || '';

    const response = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': this.config.apiKey,
        'anthropic-version': '2023-06-01'
      },
      body: JSON.stringify({
        model: this.config.model || 'claude-3-haiku-20240307',
        messages: userMessages,
        system: systemMessage,
        max_tokens: 1000,
        temperature: 0.7
      })
    });

    if (!response.ok) {
      const errorData: any = await response.json();
      throw new Error(`Anthropic API error: ${errorData.error?.message || 'Unknown error'}`);
    }

    const data: any = await response.json();
    return data.content[0].text;
  }

  private simulateResponse(messages: LLMMessage[]): string {
    // Extract the user's last message
    const lastUserMessage = messages.filter(m => m.role === 'user').pop()?.content || 'the topic';

    // Generate a simulated response based on the user's message
    const responses = [
      `I understand your question about "${lastUserMessage}". Based on the provided context, I can tell you...`,
      `Thanks for asking about "${lastUserMessage}". From what I can see in the provided content...`,
      `Looking at your query "${lastUserMessage}", I can provide the following insights...`,
      `Regarding "${lastUserMessage}", the context suggests that...`,
      `Based on the information available, "${lastUserMessage}" relates to...`
    ];

    return responses[Math.floor(Math.random() * responses.length)];
  }
}