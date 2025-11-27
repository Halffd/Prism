import type { Message, ContextData, ApiResponse } from '@prism/shared-types';

export class PrismClient {
  private baseUrl: string;
  private apiKey?: string;

  constructor(baseUrl: string, apiKey?: string) {
    this.baseUrl = baseUrl;
    this.apiKey = apiKey;
  }

  async sendMessage(
    content: string,
    context?: ContextData,
    sessionId?: string
  ): Promise<ApiResponse<Message>> {
    const response = await fetch(`${this.baseUrl}/api/chat`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.apiKey && { Authorization: `Bearer ${this.apiKey}` })
      },
      body: JSON.stringify({
        content,
        context,
        sessionId
      })
    });

    return response.json() as Promise<ApiResponse<Message>>;
  }

  async getHistory(sessionId: string): Promise<ApiResponse<Message[]>> {
    const response = await fetch(
      `${this.baseUrl}/api/sessions/${sessionId}/messages`,
      {
        headers: {
          ...(this.apiKey && { Authorization: `Bearer ${this.apiKey}` })
        }
      }
    );

    return response.json() as Promise<ApiResponse<Message[]>>;
  }
}


