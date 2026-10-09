import { Router } from 'express';
import { chatRouter } from './chat.routes';
import { sessionRouter } from './session.routes';
import { authRouter } from './auth.routes';
import { syncRouter } from './sync.routes';
import { renderMetrics } from '../middleware/logger';

const router = Router();

// Mount API routes
router.use('/auth', authRouter);
router.use('/chat', chatRouter);
router.use('/sessions', sessionRouter);
router.use('/sync', syncRouter);

// API info and health check
router.get('/', (req, res) => {
  res.json({
    name: 'Prism API',
    version: '1.0.0',
    endpoints: {
      auth: '/api/auth',
      chat: '/api/chat',
      sessions: '/api/sessions',
      sync: '/api/sync',
    },
  });
});

// Health check endpoint
router.get('/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    uptime: process.uptime(),
  });
});

// Monitoring metrics (Prometheus text format)
router.get('/metrics', (req, res) => {
  res.type('text/plain; version=0.0.4').send(renderMetrics());
});

export { router as routes };
