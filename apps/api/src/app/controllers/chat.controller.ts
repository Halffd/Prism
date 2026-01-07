import { Response } from 'express';
import { MessageModel, SessionModel } from '../models';
import { createContextProcessor } from '../services/context.service';
import { LLMService } from '../services/llm.service';
import { AuthenticatedRequest } from '../middleware/auth';

// Initialize services
const contextProcessor = createContextProcessor();
// Initialize LLM service with configuration from environment
const apiKey = process.env.OPENAI_API_KEY || process.env.LLM_API_KEY || 'fake-api-key';
const provider = process.env.LLM_PROVIDER as 'openai' | 'anthropic' | undefined;
const llmService: LLMService = new LLMService({
  apiKey,
  model: process.env.LLM_MODEL || 'gpt-3.5-turbo',
  baseUrl: process.env.LLM_BASE_URL,
  provider
});

export const sendMessage = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { content, context, sessionId } = req.body || {};

    if (!content) {
      return res.status(400).json({
        success: false,
        error: 'Content is required'
      });
    }

    // Use authenticated user ID or default to anonymous
    const userId = req.user?.id || 'anonymous';

    // Create or get session
    let session;
    if (sessionId) {
      session = await SessionModel.findById(sessionId);
      if (!session) {
        return res.status(404).json({
          success: false,
          error: 'Session not found'
        });
      }

      // Check if user owns this session
      if (req.user && session.userId !== req.user.id) {
        return res.status(403).json({
          success: false,
          error: 'Access denied'
        });
      }
    } else {
      // Create a new session if none provided
      session = await SessionModel.create({
        userId,
        messages: []
      });
    }

    // Process context for better understanding
    const processedContext = contextProcessor.process(context);

    // Save user message to session
    await MessageModel.addMessageToSession(session.id, {
      role: 'user',
      content,
      context
    });

    // Get the full conversation history for the LLM
    const conversationHistory = await MessageModel.findBySessionId(session.id);

    // Generate response from LLM
    const llmResponse = await llmService.generateResponse(conversationHistory, context);

    // Save assistant message to session
    const assistantMessage = await MessageModel.addMessageToSession(session.id, {
      role: 'assistant',
      content: llmResponse,
      context
    });

    return res.json({
      success: true,
      data: assistantMessage,
      // Include processed context info for debugging/monitoring
      metadata: {
        contextRelevance: processedContext.relevanceScore,
        keywords: processedContext.keywords.slice(0, 5), // Top 5 keywords
        sentiment: processedContext.sentiment
      }
    });
  } catch (error: any) {
    console.error('Error in sendMessage:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to send message'
    });
  }
};

export const getHistory = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { sessionId } = req.params;

    if (!sessionId) {
      return res.status(400).json({
        success: false,
        error: 'Session ID is required'
      });
    }

    const session = await SessionModel.findById(sessionId);
    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'Session not found'
      });
    }

    // Check if user owns this session
    if (req.user && session.userId !== req.user.id) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }

    const messages = await MessageModel.findBySessionId(sessionId);

    if (!messages) {
      return res.status(404).json({
        success: false,
        error: 'Session not found'
      });
    }

    return res.json({
      success: true,
      data: messages
    });
  } catch (error: unknown) {
    console.error('Error in getHistory:', error);
    return res.status(500).json({
      success: false,
      error: 'Failed to retrieve history'
    });
  }
};

// Export the context processor for use in routes
export { createContextProcessor };