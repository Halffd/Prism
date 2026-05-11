import React, { useState } from 'react';
import type { Message } from '@prism/shared-types';
import { VoiceInput } from './VoiceInput';

interface InputSectionProps {
  input: string;
  setInput: (value: string) => void;
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
  useWhisper
}) => {
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
          title="Include page contents in your message (Ctrl+Shift+P or Shift+2)"
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
              navigator.clipboard.readText().then(text => {
                setInput(prev => prev + (prev ? ' ' : '') + text);
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
              setInput(prev => prev + (prev ? '\n' : '') + pageInfo);
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
        {onVoiceTranscript && (
          <VoiceInput onTranscript={onVoiceTranscript} disabled={loading} client={voiceClient} useWhisper={useWhisper} />
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
      <div className="input-footer">
        <div className="send-options">
          {(sendSelectedText || textSelectionMode) && <span className="send-option active" title="Ctrl+Shift+T or Shift+1 to toggle">📝</span>}
          {(sendPageContents || pageContextMode) && <span className="send-option active" title="Ctrl+Shift+P or Shift+2 to toggle">📄</span>}
          {(sendScreenshot || pageScreenshotMode) && <span className="send-option active" title="Ctrl+Shift+S or Shift+3 to toggle">📷</span>}
          {clipboardMode && <span className="send-option active" title="Shift+4 to toggle">📋</span>}
          {pageInfoMode && <span className="send-option active" title="Shift+5 to toggle">ℹ️</span>}
          {uploadedImages.length > 0 && <span className="send-option active" title="Uploaded images">🖼️ {uploadedImages.length}</span>}
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
