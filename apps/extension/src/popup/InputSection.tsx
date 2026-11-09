import { useRef, useState } from 'react';
import type React from 'react';
import { VoiceInput } from './VoiceInput';
import { EmojiPicker } from '../components/EmojiPicker';

interface InputSectionProps {
  input: string;
  setInput: (value: string | ((prev: string) => string)) => void;
  loading: boolean;
  uploadedImages: string[];
  removeImage: (index: number) => void;
  sendMessage: () => void;
  sendSelectedText: boolean;
  setSendSelectedText: (value: boolean) => void;
  textSelectionMode: boolean;
  setTextSelectionMode: (value: boolean) => void;
  sendPageContents: boolean;
  setSendPageContents: (value: boolean) => void;
  pageContextMode: boolean;
  setPageContextMode: (value: boolean) => void;
  sendScreenshot: boolean;
  setSendScreenshot: (value: boolean) => void;
  pageScreenshotMode: boolean;
  setPageScreenshotMode: (value: boolean) => void;
  clipboardMode: boolean;
  setClipboardMode: (value: boolean) => void;
  pageInfoMode: boolean;
  setPageInfoMode: (value: boolean) => void;
  addImageToInput: () => void;
  onPasteImage?: (e: React.ClipboardEvent) => void;
  onDrop?: (e: React.DragEvent) => void;
  onDragOver?: (e: React.DragEvent) => void;
  onDragLeave?: (e: React.DragEvent) => void;
  dragOver?: boolean;
  onVoiceTranscript?: (text: string) => void;
  voiceClient?: any;
  useWhisper?: boolean;
}

export const InputSection: React.FC<InputSectionProps> = ({
  input,
  setInput,
  loading,
  uploadedImages,
  removeImage,
  sendMessage,
  sendSelectedText,
  setSendSelectedText,
  textSelectionMode,
  setTextSelectionMode,
  sendPageContents,
  setSendPageContents,
  pageContextMode,
  setPageContextMode,
  sendScreenshot,
  setSendScreenshot,
  pageScreenshotMode,
  setPageScreenshotMode,
  clipboardMode,
  setClipboardMode,
  pageInfoMode,
  setPageInfoMode,
  addImageToInput,
  onPasteImage,
  onDrop,
  onDragOver,
  onDragLeave,
  dragOver,
  onVoiceTranscript,
  voiceClient,
  useWhisper,
}) => {
  const [showEmojiPicker, setShowEmojiPicker] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  // Remembers where the caret was when the picker opened, so the chosen
  // character lands where the user was typing rather than at the end.
  const caretRef = useRef<number | null>(null);

  const openEmojiPicker = () => {
    caretRef.current = textareaRef.current?.selectionStart ?? null;
    setShowEmojiPicker((open) => !open);
  };

  /**
   * Inserts the chosen character at the remembered caret position.
   *
   * The textarea's selection is restored before insertion so the browser
   * puts the character exactly where the user left off.
   */
  const insertAtCaret = (value: string) => {
    const textarea = textareaRef.current;
    const position = caretRef.current ?? textarea?.selectionStart ?? input.length;

    setInput((prev) => {
      const start = Math.min(position, prev.length);
      return prev.slice(0, start) + value + prev.slice(start);
    });

    caretRef.current = position + value.length;
    setShowEmojiPicker(false);

    // Restore the caret after React has committed the new value.
    requestAnimationFrame(() => {
      const next = textareaRef.current;
      if (!next) {
        return;
      }
      const caret = Math.min(caretRef.current ?? next.value.length, next.value.length);
      next.focus();
      next.setSelectionRange(caret, caret);
    });
  };

  return (
    <div
      className={`input-container${dragOver ? ' drag-over' : ''}`}
      onDrop={onDrop}
      onDragOver={onDragOver}
      onDragLeave={onDragLeave}
    >
      {dragOver && (
        <div className="drop-overlay">
          <span>Drop images here</span>
        </div>
      )}
      <div className="input-actions">
        <button
          className={`action-btn ${sendSelectedText || textSelectionMode ? 'active' : ''}`}
          onClick={() => {
            setSendSelectedText(!sendSelectedText);
            setTextSelectionMode(!textSelectionMode);
          }}
          title="Include selected text in your message (Ctrl+Shift+T or Shift+1)"
        >
          📝
        </button>
        <button
          className={`action-btn ${sendPageContents || pageContextMode ? 'active' : ''}`}
          onClick={() => {
            setSendPageContents(!sendPageContents);
            setPageContextMode(!pageContextMode);
          }}
          title="Include page contents in your message (Ctrl+Shift+G or Shift+2)"
        >
          📄
        </button>
        <button
          className={`action-btn ${sendScreenshot || pageScreenshotMode ? 'active' : ''}`}
          onClick={() => {
            setSendScreenshot(!sendScreenshot);
            setPageScreenshotMode(!pageScreenshotMode);
          }}
          title="Include screenshot in your message (Ctrl+Shift+S or Shift+3)"
        >
          📷
        </button>
        <button
          className="action-btn"
          onClick={() => {
            setClipboardMode(!clipboardMode);
            if (!clipboardMode) {
              navigator.clipboard.readText().then((text) => {
                setInput((prev) => prev + (prev ? ' ' : '') + text);
              });
            }
          }}
          title="Include clipboard content in your message (Shift+4)"
        >
          📋
        </button>
        <button
          className="action-btn"
          onClick={() => {
            setPageInfoMode(!pageInfoMode);
            if (!pageInfoMode) {
              const pageInfo = `URL: ${window.location.href}\nTitle: ${document.title}`;
              setInput((prev) => prev + (prev ? '\n' : '') + pageInfo);
            }
          }}
          title="Include page info in your message (Shift+5)"
        >
          ℹ️
        </button>
        <button
          className="action-btn"
          onClick={addImageToInput}
          title="Upload an image"
        >
          🖼️
        </button>
        <button
          className={`action-btn${showEmojiPicker ? ' active' : ''}`}
          onClick={openEmojiPicker}
          title="Insert emoji or shape"
        >
          😀
        </button>
        {onVoiceTranscript && (
          <VoiceInput
            onTranscript={onVoiceTranscript}
            disabled={loading}
            client={voiceClient}
            useWhisper={useWhisper}
          />
        )}
      </div>

      {/* Display uploaded images */}
      {uploadedImages.length > 0 && (
        <div className="uploaded-images">
          {uploadedImages.map((img, index) => (
            <div key={index} className="image-preview">
              <img src={img} alt={`Preview ${index}`} />
              <button
                className="remove-image-btn"
                onClick={() => removeImage(index)}
                title="Remove image"
              >
                ✕
              </button>
            </div>
          ))}
        </div>
      )}

      <textarea
        ref={textareaRef}
        value={input}
        onChange={(e) => setInput(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            sendMessage();
          }
        }}
        onPaste={onPasteImage}
        placeholder="Ask about this page... (paste or drop images)"
        disabled={loading}
        rows={2}
        autoFocus
        onFocus={(e) => {
          e.target.select();
        }}
      />
      {showEmojiPicker && (
        <EmojiPicker
          onSelect={insertAtCaret}
          onClose={() => setShowEmojiPicker(false)}
        />
      )}
      <div className="input-footer">
        <div className="send-options">
          {(sendSelectedText || textSelectionMode) && (
            <span
              className="send-option active"
              title="Ctrl+Shift+T or Shift+1 to toggle"
            >
              📝
            </span>
          )}
          {(sendPageContents || pageContextMode) && (
            <span
              className="send-option active"
              title="Ctrl+Shift+G or Shift+2 to toggle"
            >
              📄
            </span>
          )}
          {(sendScreenshot || pageScreenshotMode) && (
            <span
              className="send-option active"
              title="Ctrl+Shift+S or Shift+3 to toggle"
            >
              📷
            </span>
          )}
          {clipboardMode && (
            <span className="send-option active" title="Shift+4 to toggle">
              📋
            </span>
          )}
          {pageInfoMode && (
            <span className="send-option active" title="Shift+5 to toggle">
              ℹ️
            </span>
          )}
          {uploadedImages.length > 0 && (
            <span className="send-option active" title="Uploaded images">
              🖼️ {uploadedImages.length}
            </span>
          )}
        </div>
        <button
          onClick={sendMessage}
          disabled={loading || (!input.trim() && uploadedImages.length === 0)}
          className="send-btn"
        >
          {loading ? '⏳' : '🚀'}
        </button>
      </div>
    </div>
  );
};
