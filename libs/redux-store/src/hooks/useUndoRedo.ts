import { useCallback } from 'react';
import { useAppDispatch, useAppSelector } from '../store';
import { undo, redo, clearHistory } from '../chatSlice';
import type { ChatHistoryState } from '@prism/shared-types';

interface UseUndoRedoReturn {
  history: ChatHistoryState;
  canUndo: boolean;
  canRedo: boolean;
  undo: () => void;
  redo: () => void;
  clearHistory: () => void;
}

export function useUndoRedo(): UseUndoRedoReturn {
  const dispatch = useAppDispatch();
  const history = useAppSelector((state) => state.chat.history);

  const canUndo = history.past.length > 0;
  const canRedo = history.future.length > 0;

  const undoAction = useCallback(() => {
    dispatch(undo());
  }, [dispatch]);

  const redoAction = useCallback(() => {
    dispatch(redo());
  }, [dispatch]);

  const clearHistoryAction = useCallback(() => {
    dispatch(clearHistory());
  }, [dispatch]);

  return {
    history,
    canUndo,
    canRedo,
    undo: undoAction,
    redo: redoAction,
    clearHistory: clearHistoryAction,
  };
}
