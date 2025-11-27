import { Router } from 'express';
import { chatRouter } from './chat.routes';
import { sessionRouter } from './session.routes';
import { authRouter } from './auth.routes';

const router = Router();

// Mount API routes
router.use('/auth', authRouter);
router.use('/chat', chatRouter);
router.use('/sessions', sessionRouter);

// API info and health check
router.get('/', (req, res) => {
  res.json({
    name: 'Prism API',
    version: '1.0.0',
    endpoints: {
      auth: '/api/auth',
      chat: '/api/chat',
      sessions: '/api/sessions'
    }
  });
});

// Health check endpoint
router.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime()
  });
});

export { router as routes };