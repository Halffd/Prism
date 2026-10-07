import type { AICapability, AIProvider, ServiceConfig } from '@prism/shared-types';
import { AIFactory, type AIServiceType } from '@prism/ai-factory';

export interface AIServiceConfig {
  capability: AICapability;
  provider: string;
  config: ServiceConfig;
}

export class AIApplicationBuilder {
  private services: AIServiceConfig[] = [];
  private globalConfig: Partial<ServiceConfig> = {};

  withGlobalConfig(config: Partial<ServiceConfig>): this {
    this.globalConfig = { ...this.globalConfig, ...config };
    return this;
  }

  withProvider(provider: AIProvider, apiKey: string, apiUrl?: string): this {
    this.globalConfig.provider = provider;
    this.globalConfig.apiKey = apiKey;
    if (apiUrl) this.globalConfig.apiUrl = apiUrl;
    return this;
  }

  withModel(model: string): this {
    this.globalConfig.model = model;
    return this;
  }

  addOCR(provider?: string, config?: Partial<ServiceConfig>): this {
    return this.addService('ocr', provider, config);
  }

  addSTT(provider?: string, config?: Partial<ServiceConfig>): this {
    return this.addService('stt', provider, config);
  }

  addTTS(provider?: string, config?: Partial<ServiceConfig>): this {
    return this.addService('tts', provider, config);
  }

  addInpaint(provider?: string, config?: Partial<ServiceConfig>): this {
    return this.addService('inpaint', provider, config);
  }

  addModelGen(provider?: string, config?: Partial<ServiceConfig>): this {
    return this.addService('model-gen', provider, config);
  }

  addAudioGen(provider?: string, config?: Partial<ServiceConfig>): this {
    return this.addService('audio-gen', provider, config);
  }

  addVideoGen(provider?: string, config?: Partial<ServiceConfig>): this {
    return this.addService('video-gen', provider, config);
  }

  addLLM(provider?: string, config?: Partial<ServiceConfig>): this {
    return this.addService('llm', provider, config);
  }

  addAgent(provider?: string, config?: Partial<ServiceConfig>): this {
    return this.addService('agent', provider, config);
  }

  addService(capability: AICapability, provider?: string, config?: Partial<ServiceConfig>): this {
    this.services.push({
      capability,
      provider: provider || this.globalConfig.provider || 'openai',
      config: { ...this.globalConfig, ...config } as ServiceConfig,
    });
    return this;
  }

  build(): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const serviceConfig of this.services) {
      const { capability, provider, config } = serviceConfig;
      const service = AIFactory.create(capability, provider, config);
      const key = `${capability}:${provider}`;
      result[key] = service;
    }
    return result;
  }

  buildOne<T extends AICapability>(capability: T, provider?: string): AIServiceType<T> {
    const p = provider || this.globalConfig.provider || 'openai';
    const config: ServiceConfig = {
      provider: this.globalConfig.provider || ('openai' as AIProvider),
      apiKey: this.globalConfig.apiKey || '',
      apiUrl: this.globalConfig.apiUrl,
      model: this.globalConfig.model,
    };
    return AIFactory.create(capability, p, config);
  }

  reset(): this {
    this.services = [];
    this.globalConfig = {};
    return this;
  }
}

export function createAIBuilder(): AIApplicationBuilder {
  return new AIApplicationBuilder();
}
