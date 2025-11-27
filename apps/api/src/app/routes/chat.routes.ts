import { Router } from 'express';
import {
  sendMessage,
  getHistory,
  createContextProcessor
} from '../controllers/chat.controller';
import { authenticate } from '../middleware/auth';

const router = Router();

// Create context processor
const contextProcessor = createContextProcessor();

// Chat endpoints
router.post('/', authenticate, sendMessage);
router.get('/history/:sessionId', authenticate, getHistory);

export { router as chatRouter };