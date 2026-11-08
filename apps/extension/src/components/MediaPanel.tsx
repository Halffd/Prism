import React, { useCallback, useEffect, useState } from 'react';
import type { AIConfig } from '@prism/shared-types';
import {
  defaultMediaSettings,
  generateImage,
  generateModel,
  generateVideo,
  inpaint,
  loadMediaSettings,
  MEDIA_CAPABILITY_LABELS,
  providersForCapability,
  saveMediaSettings,
  type MediaCapability,
  type MediaCapabilityClient,
  type MediaResult,
  type MediaSettings,
} from '../chat/media-capabilities';

/**
 * The media panel: image generation, inpainting, video and 3D model
 * generation.
 *
 * The panel owns only the form state. The requests go through the
 * media-capabilities module, which knows the providers and the wire
 * shapes.
 */

export interface MediaPanelProps {
  /** The chat client, used for the capabilities that route through it. */
  client: MediaCapabilityClient | null;
  /** The chat config, so a provider key can serve a media capability. */
  aiConfig?: AIConfig;
}

const ASPECT_RATIOS = ['16:9', '9:16', '1:1'] as const;
const MODEL_FORMATS = ['glb', 'obj', 'stl', 'usdz', 'gltf'] as const;

export const MediaPanel: React.FC<MediaPanelProps> = ({ client, aiConfig }) => {
  const [capability, setCapability] = useState<MediaCapability>('image-gen');
  const [settings, setSettings] = useState<MediaSettings>(defaultMediaSettings);
  const [prompt, setPrompt] = useState('');
  const [negativePrompt, setNegativePrompt] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [maskUrl, setMaskUrl] = useState('');
  const [duration, setDuration] = useState('5');
  const [aspectRatio, setAspectRatio] = useState<(typeof ASPECT_RATIOS)[number]>(
    '16:9',
  );
  const [modelFormat, setModelFormat] = useState<
    (typeof MODEL_FORMATS)[number]
  >('glb');
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('');
  const [result, setResult] = useState<MediaResult | null>(null);

  useEffect(() => {
    let cancelled = false;
    loadMediaSettings()
      .then((stored) => {
        if (!cancelled) {
          setSettings(stored);
        }
      })
      .catch(() => {
        // Storage failures leave the defaults in place.
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const current = settings[capability];
  const providers = providersForCapability(capability);

  const updateCurrent = useCallback(
    (patch: Partial<(typeof settings)[MediaCapability]>) => {
      setSettings((previous) => {
        const next = {
          ...previous,
          [capability]: { ...previous[capability], ...patch },
        };
        saveMediaSettings(next).catch(() => {
          // A failed save must not break the panel.
        });
        return next;
      });
    },
    [capability],
  );

  const needsImage = capability === 'inpaint' || capability === 'video-gen';
  const needsMask = capability === 'inpaint';

  const run = useCallback(async () => {
    if (busy) {
      return;
    }
    setBusy(true);
    setStatus('Working…');
    setResult(null);
    try {
      let produced: MediaResult;
      if (capability === 'image-gen') {
        produced = await generateImage(prompt, current, aiConfig);
      } else if (capability === 'inpaint') {
        if (!client) {
          throw new Error('The AI client is not ready yet.');
        }
        produced = await inpaint(
          client,
          current,
          {
            image: imageUrl,
            mask: maskUrl,
            prompt,
            negativePrompt,
          },
          aiConfig,
        );
      } else if (capability === 'video-gen') {
        if (!client) {
          throw new Error('The AI client is not ready yet.');
        }
        produced = await generateVideo(
          client,
          current,
          {
            prompt,
            image: imageUrl,
            duration: Number(duration) || undefined,
            aspectRatio,
          },
          aiConfig,
        );
      } else {
        if (!client) {
          throw new Error('The AI client is not ready yet.');
        }
        produced = await generateModel(
          client,
          current,
          {
            prompt,
            image: imageUrl,
            format: modelFormat,
          },
          aiConfig,
        );
      }
      setResult(produced);
      setStatus('Done.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }, [
    aiConfig,
    aspectRatio,
    busy,
    capability,
    client,
    current,
    duration,
    imageUrl,
    maskUrl,
    modelFormat,
    negativePrompt,
    prompt,
  ]);

  return (
    <div className="media-panel">
      <div className="media-panel-row">
        <select
          value={capability}
          onChange={(e) => {
            const next = e.target.value as MediaCapability;
            setCapability(next);
            setStatus('');
            setResult(null);
          }}
          aria-label="Media capability"
        >
          {(Object.keys(MEDIA_CAPABILITY_LABELS) as MediaCapability[]).map(
            (key) => (
              <option key={key} value={key}>
                {MEDIA_CAPABILITY_LABELS[key]}
              </option>
            ),
          )}
        </select>

        <select
          value={current.provider}
          onChange={(e) => updateCurrent({ provider: e.target.value })}
          aria-label="Media provider"
        >
          {providers.map((provider) => (
            <option key={provider} value={provider}>
              {provider}
            </option>
          ))}
        </select>
      </div>

      <input
        type="text"
        value={prompt}
        onChange={(e) => setPrompt(e.target.value)}
        placeholder="Describe what to generate…"
        disabled={busy}
        aria-label="Media prompt"
      />

      {needsMask && (
        <input
          type="text"
          value={maskUrl}
          onChange={(e) => setMaskUrl(e.target.value)}
          placeholder="Mask image URL"
          disabled={busy}
          aria-label="Mask image URL"
        />
      )}

      {needsImage && (
        <input
          type="text"
          value={imageUrl}
          onChange={(e) => setImageUrl(e.target.value)}
          placeholder="Source image URL"
          disabled={busy}
          aria-label="Source image URL"
        />
      )}

      {capability === 'inpaint' && (
        <input
          type="text"
          value={negativePrompt}
          onChange={(e) => setNegativePrompt(e.target.value)}
          placeholder="Negative prompt (optional)"
          disabled={busy}
          aria-label="Negative prompt"
        />
      )}

      {capability === 'video-gen' && (
        <div className="media-panel-row">
          <input
            type="number"
            value={duration}
            onChange={(e) => setDuration(e.target.value)}
            placeholder="Seconds"
            disabled={busy}
            aria-label="Video duration"
          />
          <select
            value={aspectRatio}
            onChange={(e) =>
              setAspectRatio(e.target.value as (typeof ASPECT_RATIOS)[number])
            }
            aria-label="Aspect ratio"
          >
            {ASPECT_RATIOS.map((ratio) => (
              <option key={ratio} value={ratio}>
                {ratio}
              </option>
            ))}
          </select>
        </div>
      )}

      {capability === 'model-gen' && (
        <select
          value={modelFormat}
          onChange={(e) =>
            setModelFormat(e.target.value as (typeof MODEL_FORMATS)[number])
          }
          aria-label="Model format"
        >
          {MODEL_FORMATS.map((format) => (
            <option key={format} value={format}>
              {format}
            </option>
          ))}
        </select>
      )}

      <div className="media-panel-row">
        <input
          type="password"
          value={current.apiKey}
          onChange={(e) => updateCurrent({ apiKey: e.target.value })}
          placeholder="API key"
          disabled={busy}
          aria-label="Media API key"
        />
        <input
          type="text"
          value={current.model}
          onChange={(e) => updateCurrent({ model: e.target.value })}
          placeholder="Model (optional)"
          disabled={busy}
          aria-label="Media model"
        />
      </div>

      <button
        onClick={run}
        disabled={busy || !prompt.trim()}
        className="media-generate-btn"
      >
        {busy ? 'Generating…' : 'Generate'}
      </button>

      {status && (
        <p className="media-status" role="status">
          {status}
        </p>
      )}

      {result && (
        <div className="media-result">
          {result.kind === 'image' && (
            <img
              src={result.url}
              alt="Generated"
              style={{ maxWidth: '100%', borderRadius: '8px' }}
            />
          )}
          {result.kind === 'video' && <video src={result.url} controls />}
          {result.kind === 'model' && (
            <a href={result.url} download>
              Download 3D model
            </a>
          )}
        </div>
      )}
    </div>
  );
};
