# Spec: Prism-AI-Consolidation

Scope: repo

# Prism AI Service Consolidation

## Current State (2 overlapping monoliths)

### AIService (libs/llm-service, 800+ lines)
- Single file with 15+ provider switch/case
- Each provider: different headers, URLs, payload formats, stream parsing
- Retry logic, rate limiting inline
- Tight coupling - adding a provider means modifying the switch

### UnifiedAIClient (libs/api-client, 500+ lines)
- Unified interface + offline queue
- Duplicates much of AIService logic
- Network status awareness

## Target State (Strategy Pattern)

```
ILlmProvider (interface)
├── OpenAiProvider
├── AnthropicProvider
├── GoogleGeminiProvider
├── AlibabaQwenProvider
├── MistralProvider
├── OllamaProvider (local)
├── DeepSeekProvider
├── CohereProvider
├── GroqProvider
├── TogetherProvider
├── FireworksProvider
├── PerplexityProvider
├── OpenRouterProvider
├── HuggingFaceProvider
└── CustomEndpointProvider

LlmClient (facade, ~200 lines)
├── Selects provider by AiProvider enum
├── Polly resilience pipeline (retry, circuit breaker, rate limit)
├── IAsyncEnumerable<string> for SSE streaming
├── OfflineQueue<TRequest> for network-down scenarios
└── Caching layer (frequently asked → instant response)
```

## C# Interface

```csharp
public interface ILlmProvider
{
    AiProvider ProviderType { get; }
    Task<IAsyncEnumerable<string>> StreamAsync(LlmRequest request, CancellationToken ct);
    Task<LlmResponse> CompleteAsync(LlmRequest request, CancellationToken ct);
    bool SupportsStreaming { get; }
    bool SupportsImageGeneration { get; }
}
```

## Benefits
- 1300-line monolith → ~15 focused classes (50-80 lines each) + 1 facade
- Adding a provider = new class, zero modifications to existing code
- Polly replaces hand-rolled retry/rate-limit
- `IAsyncEnumerable<string>` replaces manual SSE parsing
- Each provider independently testable