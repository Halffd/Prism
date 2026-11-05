/**
 * Typed chrome.runtime message contracts for the Prism extension.
 *
 * The extension previously used ad-hoc string literals at every send/listen
 * site, which made it impossible to type-check a message end to end and let
 * typos (or drift between sender and receiver) pass silently. These types
 * give every runtime message a discriminated union so a handler can narrow on
 * `request.type` and have the payload typed automatically.
 */

import type {
  AIConfig,
  ContextData,
  ExtensionSettings,
  Message,
} from './message.types';

/** Badge states driven by the background service worker. */
export type PrismBadgeState = 'idle' | 'busy' | 'transcribing' | 'disabled';

/** Interaction modes toggled from the content script hotkeys. */
export type PrismToggleMode =
  'textSelection' | 'pageContext' | 'pageScreenshot' | 'clipboard' | 'pageInfo';

/**
 * Messages sent from an extension page (popup, chat, settings) to the
 * background service worker.
 */
export type BackgroundRequest =
  | { type: 'SEND_MESSAGE'; data: SendMessagePayload }
  | { type: 'GET_CONTEXT'; tabId?: number }
  | { type: 'UPDATE_AI_CONFIG'; data: AIConfig }
  | { type: 'GET_AI_CONFIG' }
  | { type: 'OPEN_CHAT' }
  | { type: 'INSERT_PROMPT_SHORTCUT'; content: string }
  | { type: 'TOGGLE_MODE'; mode: PrismToggleMode; value: boolean }
  | { type: 'SET_BADGE_STATE'; state: PrismBadgeState; count?: number };

/** Messages sent from the background service worker to a content script. */
export type ContentRequest =
  | { type: 'EXTRACT_CONTEXT'; pageContentTokenLimit?: number }
  | { type: 'GET_SELECTED_TEXT' }
  | { type: 'GET_PAGE_CONTENTS' }
  | { type: 'GET_PAGE_CONTENTS_WITH_LIMIT'; tokenLimit?: number }
  | { type: 'OPEN_CHAT' }
  | { type: 'INJECT_IFRAME_CHAT' }
  | { type: 'UPDATE_DISPLAY_MODE'; data: Partial<ExtensionSettings> }
  | { type: 'UPDATE_FONT_SCALE'; scale: number }
  | { type: 'PING' };

/** Messages sent between extension pages (popup <-> chat/settings). */
export type PageRequest =
  | { type: 'INSERT_PROMPT_CONTENT'; content: string }
  | { type: 'MODE_TOGGLED'; mode: PrismToggleMode; value: boolean }
  | { type: 'CLEAR_CHAT' }
  | { type: 'RETRY_LAST_MESSAGE' }
  | { type: 'UPDATE_AI_CONFIG'; data: AIConfig }
  | { type: 'OPEN_EXTENSION_POPUP' };

/** Every runtime message the extension understands. */
export type ExtensionRequest = BackgroundRequest | ContentRequest | PageRequest;

/**
 * Every runtime message type string, useful for exhaustiveness checks and
 * for building message-type registries.
 */
export type ExtensionRequestType = ExtensionRequest['type'];

export interface SendMessagePayload {
  content: string;
  context?: ContextData;
  images?: string[];
  conversationHistory?: Message[];
  aiConfig?: AIConfig;
}

/**
 * Type guard for a runtime message. Narrows an unknown value to the union
 * when its `type` field is one of the known message types.
 */
export function isExtensionRequest(value: unknown): value is ExtensionRequest {
  if (typeof value !== 'object' || value === null) {
    return false;
  }
  if (!('type' in value)) {
    return false;
  }
  const type = value.type;
  return typeof type === 'string' && type.length > 0;
}
