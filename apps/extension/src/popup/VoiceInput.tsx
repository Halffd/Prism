import React, { useState, useRef, useEffect, useCallback } from 'react';
import type { UnifiedAIClient } from '@prism/api-client';

interface VoiceInputProps {
  onTranscript: (text: string) => void;
  disabled?: boolean;
  client?: UnifiedAIClient;
  useWhisper?: boolean;
}

export const VoiceInput: React.FC<VoiceInputProps> = ({ onTranscript, disabled, client, useWhisper }) => {
  const [recording, setRecording] = useState(false);
  const [processing, setProcessing] = useState(false);
  const [mode, setMode] = useState<'dictation' | 'whisper'>(useWhisper ? 'whisper' : 'dictation');
  const recognitionRef = useRef<any>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);

  const onTranscriptRef = useRef(onTranscript);
  onTranscriptRef.current = onTranscript;

  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (SpeechRecognition) {
      const recognition = new SpeechRecognition();
      recognition.continuous = true;
      recognition.interimResults = true;
      recognition.lang = 'en-US';

      recognition.onresult = (event: any) => {
        let transcript = '';
        for (let i = 0; i < event.results.length; i++) {
          transcript += event.results[i][0].transcript;
        }
        if (event.results[event.results.length - 1].isFinal) {
          onTranscriptRef.current(transcript);
        }
      };

      recognition.onerror = () => setRecording(false);
      recognition.onend = () => setRecording(false);

      recognitionRef.current = recognition;
    }

    return () => {
      if (recognitionRef.current) {
        try { recognitionRef.current.stop(); } catch {}
      }
      stopMediaRecorder();
    };
  }, []);

  const stopMediaRecorder = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
    }
    mediaRecorderRef.current = null;
    chunksRef.current = [];
  }, []);

  const transcribeWithWhisper = useCallback(async (audioBlob: Blob) => {
    if (!client) return;

    setProcessing(true);
    try {
      const result = await client.transcribeAudio(audioBlob);
      if (result.success && result.data?.text) {
        onTranscriptRef.current(result.data.text);
      }
    } catch (err) {
      console.error('Whisper transcription failed:', err);
    } finally {
      setProcessing(false);
    }
  }, [client]);

  const toggleRecording = useCallback(() => {
    if (mode === 'dictation') {
      if (!recognitionRef.current) return;
      if (recording) {
        recognitionRef.current.stop();
        setRecording(false);
      } else {
        recognitionRef.current.start();
        setRecording(true);
      }
      return;
    }

    // Whisper mode — MediaRecorder
    if (recording) {
      stopMediaRecorder();
      setRecording(false);
      return;
    }

    navigator.mediaDevices.getUserMedia({ audio: true }).then(stream => {
      const mediaRecorder = new MediaRecorder(stream, {
        mimeType: MediaRecorder.isTypeSupported('audio/webm;codecs=opus') ? 'audio/webm;codecs=opus' : 'audio/webm',
      });

      chunksRef.current = [];

      mediaRecorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      mediaRecorder.onstop = () => {
        const blob = new Blob(chunksRef.current, { type: 'audio/webm' });
        stream.getTracks().forEach(t => t.stop());
        if (client) {
          transcribeWithWhisper(blob);
        }
      };

      mediaRecorder.start();
      mediaRecorderRef.current = mediaRecorder;
      setRecording(true);
    }).catch(err => {
      console.error('Microphone access denied:', err);
    });
  }, [mode, recording, client, stopMediaRecorder, transcribeWithWhisper]);

  const toggleMode = useCallback(() => {
    if (recording) {
      if (mode === 'dictation') {
        recognitionRef.current?.stop();
      } else {
        stopMediaRecorder();
      }
      setRecording(false);
    }
    setMode(prev => prev === 'dictation' ? 'whisper' : 'dictation');
  }, [recording, mode, stopMediaRecorder]);

  const hasWebSpeech = !!(recognitionRef.current || ((window as any).SpeechRecognition || (window as any).webkitSpeechRecognition));

  return (
    <>
      <button
        className={`action-btn${recording ? ' active recording' : ''}${processing ? ' processing' : ''}`}
        onClick={toggleRecording}
        disabled={disabled || processing}
        title={mode === 'whisper' ? 'Whisper: record then transcribe' : 'Dictation: real-time speech-to-text'}
      >
        {processing ? '⏳' : recording ? '⏹️' : mode === 'whisper' ? '🎙️' : '🎤'}
      </button>
      <button
        className="action-btn"
        onClick={toggleMode}
        disabled={recording || processing}
        title={mode === 'whisper' ? 'Switch to dictation mode' : 'Switch to Whisper mode (higher quality)'}
      >
        {mode === 'whisper' ? '🔄' : '🔀'}
      </button>
    </>
  );
};
