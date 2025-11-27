import { Request, Response } from 'express';
import { SessionModel } from '../models';
import { ApiResponse } from '@prism/shared-types';
import { AuthenticatedRequest } from '../middleware/auth';

export const createSession = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { messages = [] } = req.body;

    // Use authenticated user ID or default to anonymous
    const userId = req.user?.id || 'anonymous';

    const session = await SessionModel.create({
      userId,
      messages
    });

    res.status(201).json({
      success: true,
      data: session
    });
  } catch (error: unknown) {
    console.error('Error in createSession:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to create session'
    });
  }
};

export const getSession = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;

    const session = await SessionModel.findById(id);

    if (!session) {
      return res.status(404).json({
        success: false,
        error: 'Session not found'
      });
    }

    // Check if user owns this session
    const isOwner = req.user && session.userId === req.user.id;
    const isAnonymousSession = session.userId === 'anonymous';

    if (!isOwner && !isAnonymousSession) {
      return res.status(403).json({
        success: false,
        error: 'Access denied'
      });
    }

    res.json({
      success: true,
      data: session
    });
  } catch (error: unknown) {
    console.error('Error in getSession:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to get session'
    });
  }
};

export const updateSession = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;
    const updates = req.body;

    const session = await SessionModel.findById(id);
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

    const updatedSession = await SessionModel.update(id, updates);
    if (!updatedSession) {
      return res.status(404).json({
        success: false,
        error: 'Session not found'
      });
    }

    res.json({
      success: true,
      data: updatedSession
    });
  } catch (error: unknown) {
    console.error('Error in updateSession:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to update session'
    });
  }
};

export const deleteSession = async (req: AuthenticatedRequest, res: Response) => {
  try {
    const { id } = req.params;

    const session = await SessionModel.findById(id);
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

    const deleted = await SessionModel.delete(id);

    if (!deleted) {
      return res.status(404).json({
        success: false,
        error: 'Session not found'
      });
    }

    res.json({
      success: true,
      data: { message: 'Session deleted successfully' }
    });
  } catch (error: unknown) {
    console.error('Error in deleteSession:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to delete session'
    });
  }
};

export const listSessions = async (req: AuthenticatedRequest, res: Response) => {
  try {
    // Use authenticated user ID or default to anonymous
    const userId = req.user?.id || 'anonymous';

    const sessions = await SessionModel.findAll(userId);

    res.json({
      success: true,
      data: sessions
    });
  } catch (error: unknown) {
    console.error('Error in listSessions:', error);
    res.status(500).json({
      success: false,
      error: 'Failed to list sessions'
    });
  }
};