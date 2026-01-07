import { Router } from 'express';
import {
  sendMessage,
  getHistory
} from '../controllers/chat.controller';
import { authenticate } from '../middleware/auth';
import { createContextProcessor } from '../services/context.service';

const router = Router();

// Create context processor

// Chat endpoints
router.post('/', authenticate, sendMessage);
router.get('/history/:sessionId', authenticate, getHistory);

export { router as chatRouter };