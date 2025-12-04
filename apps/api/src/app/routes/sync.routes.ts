import { Router } from 'express';
import {
  syncMessages,
  syncSessions,
  syncPrompts,
  getSyncedData,
  clearSyncedData
} from '../controllers/sync.controller';
import { authenticate } from '../middleware/auth';

const router = Router();

// Sync endpoints
router.post('/messages', authenticate, syncMessages);
router.post('/sessions', authenticate, syncSessions);
router.post('/prompts', authenticate, syncPrompts);
router.get('/data', authenticate, getSyncedData);
router.delete('/clear', authenticate, clearSyncedData);

export { router as syncRouter };