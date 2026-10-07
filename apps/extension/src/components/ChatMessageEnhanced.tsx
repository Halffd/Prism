import { useState, useCallback } from 'react';
import { useDispatch, useSelector } from 'react-redux';
import { updateMessage } from '@prism/redux-store';
import type { RootState } from '@prism/redux-store';
import type {
  Message,
  MessageSwipe,
  EnhancedMessage,
  CharacterCard,
} from '@prism/shared-types';
import './SillyTavernComponents.scss';

interface ChatMessageEnhancedProps {
  message: Message;
  onRegenerate?: (message: Message) => void;
  onContinue?: (message: Message) => void;
  characterId?: string; // Override for character attribution (from message.characterId)
}

function toEnhanced(msg: Message): EnhancedMessage {
  return msg as EnhancedMessage;
}

function isEnhanced(msg: Message): msg is EnhancedMessage {
  return 'swipes' in msg || 'swipeIndex' in msg || 'isEditing' in msg;
}

// Deterministic color assignment for character attribution
const CHARACTER_COLORS = [
  '#6C8EBF', // blue
  '#B85450', // red
  '#82B366', // green
  '#D6B656', // yellow
  '#9673A6', // purple
  '#D79B00', // orange
  '#6A9FB5', // teal
  '#C75450', // crimson
];

function getCharacterColor(characterId: string): string {
  let hash = 0;
  for (let i = 0; i < characterId.length; i++) {
    hash = characterId.charCodeAt(i) + ((hash << 5) - hash);
  }
  return CHARACTER_COLORS[Math.abs(hash) % CHARACTER_COLORS.length];
}

export function ChatMessageEnhanced({
  message,
  onRegenerate,
  onContinue,
  characterId: propCharacterId,
}: ChatMessageEnhancedProps) {
  const dispatch = useDispatch();
  const [editContent, setEditContent] = useState(message.content);
  const { characters } = useSelector((state: RootState) => state.characters);

  // Resolve which character authored this message
  const resolvedCharacterId = propCharacterId ?? message.characterId;
  const authorCharacter: CharacterCard | undefined = resolvedCharacterId
    ? characters.find((c) => c.id === resolvedCharacterId)
    : undefined;

  const enhanced = toEnhanced(message);
  const swipes = enhanced.swipes ?? [];
  const swipeIndex = enhanced.swipeIndex ?? 0;
  const isEditing = isEnhanced(message) && enhanced.isEditing;
  const isAssistant = message.role === 'assistant';
  const currentSwipeIndex = swipes.length > 0 ? swipeIndex : 0;

  const handleSwipeLeft = useCallback(() => {
    if (swipes.length <= 1) return;
    const newIdx = Math.max(0, currentSwipeIndex - 1);
    dispatch(
      updateMessage(message.id, {
        swipeIndex: newIdx,
        content: swipes[newIdx].content,
      } as Partial<Message>),
    );
  }, [swipes, currentSwipeIndex, message.id, dispatch]);

  const handleSwipeRight = useCallback(() => {
    if (swipes.length <= 1) return;
    const newIdx = Math.min(swipes.length - 1, currentSwipeIndex + 1);
    dispatch(
      updateMessage(message.id, {
        swipeIndex: newIdx,
        content: swipes[newIdx].content,
      } as Partial<Message>),
    );
  }, [swipes, currentSwipeIndex, message.id, dispatch]);

  const handleStartEdit = useCallback(() => {
    setEditContent(message.content);
    dispatch(
      updateMessage(message.id, { isEditing: true } as Partial<Message>),
    );
  }, [message.content, message.id, dispatch]);

  const handleSaveEdit = useCallback(() => {
    dispatch(
      updateMessage(message.id, {
        content: editContent,
        isEditing: false,
      } as Partial<Message>),
    );
  }, [editContent, message.id, dispatch]);

  const handleCancelEdit = useCallback(() => {
    dispatch(
      updateMessage(message.id, { isEditing: false } as Partial<Message>),
    );
  }, [message.id, dispatch]);

  const handleRegenerate = useCallback(() => {
    const newSwipe: MessageSwipe = {
      id: `swipe_${Date.now()}`,
      content: '',
      selected: true,
    };

    const updatedSwipes = swipes.map((s) => ({ ...s, selected: false }));
    updatedSwipes.push(newSwipe);

    dispatch(
      updateMessage(message.id, {
        swipes: updatedSwipes,
        swipeIndex: updatedSwipes.length - 1,
        isEditing: false,
      } as Partial<Message>),
    );

    if (onRegenerate) onRegenerate(message);
  }, [swipes, message.id, message, onRegenerate, dispatch]);

  const handleContinue = useCallback(() => {
    if (onContinue) onContinue(message);
  }, [message, onContinue]);

  if (isEditing) {
    return (
      <div className="st-message-edit">
        <textarea
          className="st-textarea"
          value={editContent}
          onChange={(e) => setEditContent(e.target.value)}
          rows={6}
          autoFocus
        />
        <div className="st-message-edit-actions">
          <button className="st-btn-ghost" onClick={handleCancelEdit}>
            Cancel
          </button>
          <button className="st-btn-primary" onClick={handleSaveEdit}>
            Save
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="st-message-enhanced">
      {/* Character attribution header for group chat messages */}
      {isAssistant && authorCharacter && (
        <div className="st-message-character-attribution">
          <span
            className="st-attribution-name"
            style={{ color: getCharacterColor(authorCharacter.id) }}
          >
            {authorCharacter.name}
          </span>
        </div>
      )}

      {isAssistant && swipes.length > 1 && (
        <div className="st-swipe-controls">
          <button
            className="st-swipe-btn"
            onClick={handleSwipeLeft}
            disabled={currentSwipeIndex <= 0}
          >
            &lt;
          </button>
          <span className="st-swipe-counter">
            {currentSwipeIndex + 1}/{swipes.length}
          </span>
          <button
            className="st-swipe-btn"
            onClick={handleSwipeRight}
            disabled={currentSwipeIndex >= swipes.length - 1}
          >
            &gt;
          </button>
        </div>
      )}

      {isAssistant && (
        <div className="st-message-actions">
          <button className="st-msg-action-btn" onClick={handleRegenerate}>
            Regenerate
          </button>
          <button className="st-msg-action-btn" onClick={handleContinue}>
            Continue
          </button>
          <button className="st-msg-action-btn" onClick={handleStartEdit}>
            Edit
          </button>
        </div>
      )}

      {!isAssistant && (
        <div className="st-message-actions">
          <button className="st-msg-action-btn" onClick={handleStartEdit}>
            Edit
          </button>
        </div>
      )}
    </div>
  );
}
