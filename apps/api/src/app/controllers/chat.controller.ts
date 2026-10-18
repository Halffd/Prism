import { Response } from 'express';
import { MessageModel, SessionModel } from '../models';
import { createContextProcessor } from '../services/context.service';
import { LLMCoreService } from '../services/llm-core.service';
import { AuthenticatedRequest } from '../middleware/auth';

// Initialize services
const contextProcessor = createContextProcessor();
// Initialize LLM service with configuration from environment.
// Provider path runs through prism-core (WASM): request bodies are
// built by the core, response bytes decoded by the core's SSE decoder.
const apiKey =
  process.env.OPENAI_API_KEY || process.env.LLM_API_KEY || 'fake-api-key';
const llmService: LLMCoreService = new LLMCoreService({
  apiKey,
  model: process.env.LLM_MODEL || 'gpt-3.5-turbo',
  baseUrl: process.env.LLM_BASE_URL,
  temperature: process.env.LLM_TEMPERATURE
    ? Number(process.env.LLM_TEMPERATURE)
    : undefined,
  maxTokens: process.env.LLM_MAX_TOKENS
    ? Number(process.env.LLM_MAX_TOKENS)
    : undefined,
});

/** Resolve (or create) the chat session for a request. */
async function resolveSession(
  req: AuthenticatedRequest,
  sessionId?: string,
): Promise<{ session?: unknown; error?: { status: number; message: string } }> {
  const userId = req.user?.id || 'anonymous';

  if (sessionId) {
    const session = await SessionModel.findById(sessionId);
    if (!session) {
      return { error: { status: 404, message: 'Session not found' } };
    }
    if (req.user && session.userId !== req.user.id) {
      return { error: { status: 403, message: 'Access denied' } };
    }
    return { session };
  }

  const session = await SessionModel.create({
    userId,
    messages: [],
  });
  return { session };
}

export const sendMessage = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { content, context, sessionId } = req.body || {};

    if (!content) {
      return res.status(400).json({
        success: false,
        error: 'Content is required',
      });
    }

    // Create or get session
    const { session, error } = await resolveSession(req, sessionId);
    if (error || !session) {
      return res
        .status(error?.status ?? 500)
        .json({ success: false, error: error?.message ?? 'Session error' });
    }
    const chatSession = session as { id: string };

    // Process context for better understanding
    const processedContext = contextProcessor.process(context);

    // Save user message to session
    await MessageModel.addMessageToSession(chatSession.id, {
      role: 'user',
      content,
      context,
    });

    // Get the full conversation history for the LLM
    const conversationHistory = await MessageModel.findBySessionId(
      chatSession.id,
    );

    // Generate response from LLM
    const llmResponse = await llmService.generateResponse(
      conversationHistory,
      context,
    );

    // Save assistant message to session
    const assistantMessage = await MessageModel.addMessageToSession(
      chatSession.id,
      {
        role: 'assistant',
        content: llmResponse,
        context,
      },
    );

    return res.json({
      success: true,
      data: assistantMessage,
      // Include processed context info for debugging/monitoring
      metadata: {
        contextRelevance: processedContext.relevanceScore,
        keywords: processedContext.keywords.slice(0, 5), // Top 5 keywords
        sentiment: processedContext.sentiment,
      },
    });
  } catch (error: any) {
    console.error('Error in sendMessage:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to send message',
    });
  }
};

export const getHistory = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { sessionId } = req.params;

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: 'Session ID is required',
      });
    }

    const session = await SessionModel.findById(sessionId);
    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'Session not found',
      });
    }

    // Check if user owns this session
    if (req.user && session.userId !== req.user.id) {
      return res.status(403).json({
        success: false,
        error: 'Access denied',
      });
    }

    const messages = await MessageModel.findBySessionId(sessionId);

    if (!messages) {
      return res.status(404).json({
        success: false,
        error: 'Session not found',
      });
    }

    return res.json({
      success: true,
      data: messages,
    });
  } catch (error: unknown) {
    console.error('Error in getHistory:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve history',
    });
  }
};

// Export the context processor for use in routes
export { createContextProcessor };

/**
 * POST /api/chat/stream — SSE variant of sendMessage.
 *
 * Frames are OpenAI-compatible so any core consumer can parse them with
 * the same SSE decoder used for direct provider streams:
 *   data: {"choices":[{"delta":{"content":"..."}}]}
 *   data: [DONE]
 * Errors mid-stream: data: {"error":"..."} then close.
 */
export const streamMessage = async (
  req: AuthenticatedRequest,
  res: Response,
) => {
  const { content, context, sessionId } = req.body || {};

  if (!content) {
    return res
      .status(400)
      .json({ success: false, error: 'Content is required' });
  }

  let session: unknown;
  try {
    const resolved = await resolveSession(req, sessionId);
    if (resolved.error || !resolved.session) {
      return res.status(resolved.error?.status ?? 500).json({
        success: false,
        error: resolved.error?.message ?? 'Session error',
      });
    }
    session = resolved.session;
  } catch (error: unknown) {
    console.error('Error in streamMessage (session):', error);
    return res
      .status(500)
      .json({ success: false, error: 'Failed to send message' });
  }
  const chatSession = session as { id: string };

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  try {
    await MessageModel.addMessageToSession(chatSession.id, {
      role: 'user',
      content,
      context,
    });

    const conversationHistory = await MessageModel.findBySessionId(
      chatSession.id,
    );

    let full = '';
    for await (const delta of llmService.streamResponse(
      conversationHistory,
      context,
    )) {
      full += delta;
      res.write(
        `data: ${JSON.stringify({ choices: [{ delta: { content: delta } }] })}\n\n`,
      );
    }

    await MessageModel.addMessageToSession(chatSession.id, {
      role: 'assistant',
      content: full,
      context,
    });

    res.write('data: [DONE]\n\n');
    res.end();
    return;
  } catch (error: unknown) {
    console.error('Error in streamMessage:', error);
    res.write(
      `data: ${JSON.stringify({ error: 'Failed to stream response' })}\n\n`,
    );
    res.end();
    return;
  }
};
