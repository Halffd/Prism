# Redux Store - Fork, Undo/Redo, and Forms Management

## Overview

This library now includes comprehensive fork, undo/redo, and forms management for chat sessions.

## New Features

### 1. Fork Chat Sessions

Fork a chat session from any message, creating a new session with all messages up to that point.

**Types** (`@prism/shared-types`):
```typescript
export interface ChatSession {
  id: string;
  userId: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
  parentSessionId?: string;      // New: Reference to parent session
  forkedFromMessageId?: string; // New: Message where fork occurred
}
```

**Redux Actions** (`@prism/redux-store`):
- `forkSession({ messageId, newSessionId })` - Fork session at specific message

**Hook** (`@prism/redux-store`):
```typescript
import { useForkChat } from '@prism/redux-store';

function ChatComponent() {
  const { fork, forkedSessions, currentSessionId } = useForkChat();

  const handleFork = (messageId: string) => {
    fork(messageId); // Creates new session with messages up to messageId
  };

  return (
    <div>
      <button onClick={() => handleFork('msg_123')}>Fork from here</button>
      <p>Forked sessions: {forkedSessions.length}</p>
    </div>
  );
}
```

### 2. Undo/Redo for Messages

Track message history and allow undo/redo operations.

**Types** (`@prism/shared-types`):
```typescript
export interface ChatHistoryState {
  past: Message[][];    // History of previous states
  present: Message[];   // Current state
  future: Message[][];  // Redo stack
}
```

**Redux Actions** (`@prism/redux-store`):
- `pushToHistory(messages)` - Push current state to history
- `undo()` - Undo last action
- `redo()` - Redo last undone action
- `clearHistory()` - Clear all history

**Hook** (`@prism/redux-store`):
```typescript
import { useUndoRedo } from '@prism/redux-store';

function ChatComponent() {
  const { undo, redo, canUndo, canRedo, history } = useUndoRedo();

  return (
    <div>
      <button onClick={undo} disabled={!canUndo}>Undo</button>
      <button onClick={redo} disabled={!canRedo}>Redo</button>
      <p>History depth: {history.past.length}</p>
    </div>
  );
}
```

**Automatic History Tracking**: The following actions automatically track history:
- `addMessage`
- `setMessages`
- `updateMessage`
- `clearMessages`

### 3. Forms Management

Manage form state with validation, dirty tracking, and submission handling.

**Types** (`@prism/shared-types`):
```typescript
export interface FormField {
  name: string;
  value: unknown;
  error?: string;
  touched: boolean;
  dirty: boolean;
}

export interface FormState {
  fields: Record<string, FormField>;
  isValid: boolean;
  isSubmitting: boolean;
  submitCount: number;
  errors: Record<string, string>;
}

export interface ChatFormData {
  [formId: string]: FormState;
}
```

**Redux Actions** (`@prism/redux-store`):
- `initForm({ formId, fields })` - Initialize a form
- `updateField({ formId, name, value })` - Update field value
- `setFieldError({ formId, name, error })` - Set field error
- `setFormSubmitting({ formId, isSubmitting })` - Set submitting state
- `resetForm(formId)` - Reset form
- `touchField({ formId, name })` - Mark field as touched

**Hook** (`@prism/redux-store`):
```typescript
import { useChatForm } from '@prism/redux-store';

function MyForm() {
  const {
    init,
    update,
    setError,
    clearError,
    setSubmitting,
    reset,
    touch,
    getField,
    isValid,
    isSubmitting,
    values
  } = useChatForm('myForm');

  // Initialize form (call once in useEffect or component setup)
  useEffect(() => {
    init({
      name: '',
      email: '',
      message: ''
    });
  }, [init]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setSubmitting(true);

    // Validate
    if (!values.email) {
      setError('email', 'Email is required');
      setSubmitting(false);
      return;
    }

    // Submit...
    await submitForm(values);
    setSubmitting(false);
    reset();
  };

  return (
    <form onSubmit={handleSubmit}>
      <input
        value={values.name as string}
        onChange={(e) => update('name', e.target.value)}
        onBlur={() => touch('name')}
      />
      {getField('name')?.error && <span>{getField('name')?.error}</span>}
      
      <button type="submit" disabled={isSubmitting || !isValid}>
        {isSubmitting ? 'Submitting...' : 'Submit'}
      </button>
    </form>
  );
}
```

## Integration

All new features are integrated into the existing Redux store. The state structure is:

```typescript
{
  chat: {
    messages: Message[],
    currentSessionId: string,
    sessions: any[],
    loading: boolean,
    selectedProvider: AIConfig['provider'],
    history: ChatHistoryState,  // New
    forms: ChatFormData        // New
  }
}
```

## Usage in Components

Import hooks and actions from `@prism/redux-store`:

```typescript
import {
  useChatForm,
  useUndoRedo,
  useForkChat,
  forkSession,
  undo,
  redo,
  initForm,
  updateField,
  // ... other exports
} from '@prism/redux-store';
```
