import { useCallback } from 'react';
import { useAppDispatch, useAppSelector } from '../store';
import { forkSession } from '../chatSlice';

interface UseForkChatReturn {
  fork: (messageId: string, newSessionId?: string) => void;
  sessions: any[];
  currentSessionId: string;
  forkedSessions: any[];
}

export function useForkChat(): UseForkChatReturn {
  const dispatch = useAppDispatch();
  const sessions = useAppSelector((state) => state.chat.sessions);
  const currentSessionId = useAppSelector((state) => state.chat.currentSessionId);

  const fork = useCallback(
    (messageId: string, newSessionId?: string) => {
      const sessionId = newSessionId || `session_${Date.now()}`;
      dispatch(forkSession({ messageId, newSessionId: sessionId }));
    },
    [dispatch]
  );

  const forkedSessions = sessions.filter(
    (s) => s.parentSessionId === currentSessionId
  );

  return {
    fork,
    sessions,
    currentSessionId,
    forkedSessions,
  };
}
