import { Router } from 'express';
import {
  sendMessage,
  getHistory,
  streamMessage,
} from '../controllers/chat.controller';
import { authenticate } from '../middleware/auth';

const router = Router();

// Create context processor

// Chat endpoints
router.post('/', authenticate, sendMessage);
router.post('/stream', authenticate, streamMessage);
router.get('/history/:sessionId', authenticate, getHistory);

export { router as chatRouter };
