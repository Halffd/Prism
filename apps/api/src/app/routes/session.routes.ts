import { Router } from 'express';
import {
  createSession,
  getSession,
  updateSession,
  deleteSession,
  listSessions
} from '../controllers/session.controller';
import { authenticate } from '../middleware/auth';

const router = Router();

// Session endpoints
router.get('/', authenticate, listSessions);
router.post('/', authenticate, createSession);
router.get('/:id', authenticate, getSession);
router.put('/:id', authenticate, updateSession);
router.delete('/:id', authenticate, deleteSession);

export { router as sessionRouter };