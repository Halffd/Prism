'use client';

import { useState } from 'react';
import { Icon } from '../../src/studio/icons';
import {
  A1111_ID,
  COMFYUI_ID,
  NATIVE_ID,
  type GeneratedImage,
  type ImageForm,
  defaultBaseUrl,
  generateImages,
  getCore,
} from '../../src/studio/media';

const SAMPLERS = [
  'euler', 'euler_ancestral', 'dpmpp_2m', 'dpmpp_2m_sde', 'ddim',
  'uni_pc', 'lms', 'heun', 'dpm_2',
];
const SCHEDULERS = [
  'normal', 'karras', 'exponential', 'sgm_uniform', 'simple', 'ddim_uniform', 'beta',
];
const MAX_LORAS = 8;
const MAX_RESULTS = 12;

interface LoraUi { name: string; weight: string }

interface FormState {
  provider: string;
  checkpoint: string;
  vae: string;
  clipSkip: string;
  loras: LoraUi[];
  prompt: string;
  negative: string;
  sampler: string;
  scheduler: string;
  steps: number;
  cfg: number;
  denoise: number;
  width: string;
  height: string;
  batch: number;
  seed: string;
  baseUrl: string;
}

const INITIAL: FormState = {
  provider: NATIVE_ID,
  checkpoint: '',
  vae: '',
  clipSkip: '1',
  loras: [],
  prompt: '',
  negative: '',
  sampler: 'euler',
  scheduler: 'normal',
  steps: 20,
  cfg: 7,
  denoise: 1,
  width: '512',
  height: '512',
  batch: 1,
  seed: '',
  baseUrl: '',
};

function Stepper({
  value,
  min,
  max,
  onChange,
}: {
  value: number;
  min: number;
  max: number;
  onChange: (value: number) => void;
}) {
  return (
    <div className="studio-stepper">
      <button type="button" aria-label="Decrease" onClick={() => onChange(Math.max(min, value - 1))}><Icon name="minus" size={14} /></button>
      <span>{value}</span>
      <button type="button" aria-label="Increase" onClick={() => onChange(Math.min(max, value + 1))}><Icon name="plus" size={14} /></button>
    </div>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  display,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display?: string;
  onChange: (value: number) => void;
}) {
  return (
    <div className="studio-slider-row">
      <div className="studio-slider-head">
        <span>{label}</span>
        <strong>{display ?? value}</strong>
      </div>
      <input
        className="studio-range"
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
    </div>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="studio-node-section">
      <h3 className="studio-node-title">{title}</h3>
      <div className="studio-node-body">{children}</div>
    </section>
  );
}

export default function ImagePage() {
  const [form, setForm] = useState<FormState>(INITIAL);
  const [results, setResults] = useState<GeneratedImage[]>([]);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState('Pick a backend, write a prompt, and hit Generate.');

  function patch<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function generate() {
    if (busy) return;
    if (!form.prompt.trim()) {
      setStatus('Enter a prompt first.');
      return;
    }
    setBusy(true);
    setStatus('Rendering…');
    try {
      const core = await getCore();
      const seed = form.seed.trim()
        ? Number(form.seed.trim())
        : Math.floor(Math.random() * 2 ** 31);
      if (!form.seed.trim()) patch('seed', String(seed));

      const imageForm: ImageForm = {
        provider: form.provider,
        checkpoint: form.checkpoint,
        vae: form.vae,
        clipSkip: Math.max(1, Math.min(12, Number(form.clipSkip) || 1)),
        loras: form.loras
          .filter((lora) => lora.name.trim())
          .map((lora) => ({
            name: lora.name.trim(),
            weight: Math.max(-2, Math.min(2, Number(lora.weight) || 1)),
          })),
        prompt: form.prompt,
        negativePrompt: form.negative,
        sampler: form.sampler,
        scheduler: form.scheduler,
        steps: form.steps,
        cfg: form.cfg,
        denoise: form.denoise,
        width: form.width.trim() ? Number(form.width) : null,
        height: form.height.trim() ? Number(form.height) : null,
        batch: Math.max(1, Math.min(8, form.batch)),
        seed,
        baseUrl: form.baseUrl.trim() || defaultBaseUrl(core, form.provider),
      };
      const images = await generateImages(core, imageForm, seed);
      setResults((current) => [...images, ...current].slice(0, MAX_RESULTS));
      setStatus(`${images.length} image${images.length === 1 ? '' : 's'} ready.`);
    } catch (error) {
      setStatus(error instanceof Error ? error.message : String(error));
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
      <div className="studio-page-header">
        <h1>Image Studio</h1>
        <p>Local-first image generation. Every knob, no paywalls.</p>
      </div>

      <div className="studio-image-layout">
        <div>
          <Section title="Checkpoint">
            <div className="studio-field">
              <label className="studio-field-label" htmlFor="img-backend">Backend</label>
              <select
                id="img-backend"
                className="studio-select"
                value={form.provider}
                onChange={(e) => patch('provider', e.target.value)}
              >
                <option value={NATIVE_ID}>Native (built-in)</option>
                <option value={A1111_ID}>Automatic1111</option>
                <option value={COMFYUI_ID}>ComfyUI</option>
              </select>
            </div>
            <div className="studio-field">
              <label className="studio-field-label" htmlFor="img-model">Checkpoint</label>
              <input id="img-model" className="studio-input" placeholder="install default" value={form.checkpoint} onChange={(e) => patch('checkpoint', e.target.value)} />
            </div>
            <div className="studio-field">
              <label className="studio-field-label" htmlFor="img-vae">VAE</label>
              <input id="img-vae" className="studio-input" placeholder="checkpoint's built-in VAE" value={form.vae} onChange={(e) => patch('vae', e.target.value)} />
            </div>
            <div className="studio-field">
              <span className="studio-field-label">CLIP skip</span>
              <Stepper value={Number(form.clipSkip) || 1} min={1} max={12} onChange={(value) => patch('clipSkip', String(value))} />
            </div>
            {form.provider !== NATIVE_ID ? (
              <div className="studio-field">
                <label className="studio-field-label" htmlFor="img-base">Base URL</label>
                <input id="img-base" className="studio-input" placeholder="http://127.0.0.1:7861" value={form.baseUrl} onChange={(e) => patch('baseUrl', e.target.value)} />
                <small className="studio-status">The install must allow browser requests (CORS). The bundled Prism server does; stock A1111 may need a launch flag.</small>
              </div>
            ) : null}
          </Section>

          <Section title="LoRA">
            {form.loras.map((lora, index) => (
              <div className="studio-lora-row" key={index}>
                <input className="studio-input" placeholder="lora.safetensors" value={lora.name} onChange={(e) => patch('loras', form.loras.map((item, i) => i === index ? { ...item, name: e.target.value } : item))} />
                <input className="studio-input" placeholder="weight" value={lora.weight} onChange={(e) => patch('loras', form.loras.map((item, i) => i === index ? { ...item, weight: e.target.value } : item))} />
                <button type="button" aria-label="Remove LoRA" onClick={() => patch('loras', form.loras.filter((_, i) => i !== index))}><Icon name="trash" size={14} /></button>
              </div>
            ))}
            <button
              type="button"
              className="studio-secondary-button"
              disabled={form.loras.length >= MAX_LORAS}
              onClick={() => patch('loras', [...form.loras, { name: '', weight: '1.0' }])}
            >
              <Icon name="plus" size={13} /> Add LoRA ({form.loras.length}/{MAX_LORAS})
            </button>
          </Section>

          <Section title="Prompt">
            <div className="studio-field">
              <label className="studio-field-label" htmlFor="img-prompt">Prompt</label>
              <textarea id="img-prompt" className="studio-textarea" value={form.prompt} onChange={(e) => patch('prompt', e.target.value)} placeholder="a red fox in a neon forest…" />
            </div>
            <div className="studio-field">
              <label className="studio-field-label" htmlFor="img-negative">Negative prompt</label>
              <textarea id="img-negative" className="studio-textarea" value={form.negative} onChange={(e) => patch('negative', e.target.value)} placeholder="blur, watermark" />
            </div>
          </Section>

          <Section title="Sampler">
            <div className="studio-field">
              <label className="studio-field-label" htmlFor="img-sampler">Sampler</label>
              <select id="img-sampler" className="studio-select" value={form.sampler} onChange={(e) => patch('sampler', e.target.value)}>
                {SAMPLERS.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </div>
            <div className="studio-field">
              <label className="studio-field-label" htmlFor="img-scheduler">Scheduler</label>
              <select id="img-scheduler" className="studio-select" value={form.scheduler} onChange={(e) => patch('scheduler', e.target.value)}>
                {SCHEDULERS.map((option) => <option key={option} value={option}>{option}</option>)}
              </select>
            </div>
          </Section>

          <Section title="Latent">
            <Slider label="Steps" value={form.steps} min={1} max={150} step={1} onChange={(value) => patch('steps', value)} />
            <Slider label="CFG" value={form.cfg} min={0} max={30} step={0.1} display={form.cfg.toFixed(1)} onChange={(value) => patch('cfg', value)} />
            <Slider label="Denoise" value={form.denoise} min={0} max={1} step={0.01} display={form.denoise.toFixed(2)} onChange={(value) => patch('denoise', value)} />
            <div className="studio-row">
              <div className="studio-field">
                <label className="studio-field-label" htmlFor="img-width">Width</label>
                <input id="img-width" className="studio-input" inputMode="numeric" value={form.width} onChange={(e) => patch('width', e.target.value)} />
              </div>
              <div className="studio-field">
                <label className="studio-field-label" htmlFor="img-height">Height</label>
                <input id="img-height" className="studio-input" inputMode="numeric" value={form.height} onChange={(e) => patch('height', e.target.value)} />
              </div>
            </div>
            <div className="studio-field">
              <span className="studio-field-label">Batch</span>
              <small className="studio-status">1 to 8, unrestricted</small>
              <Stepper value={form.batch} min={1} max={8} onChange={(value) => patch('batch', value)} />
            </div>
          </Section>

          <Section title="Seed">
            <div className="studio-field">
              <label className="studio-field-label" htmlFor="img-seed">Seed (empty = random)</label>
              <div style={{ display: 'flex', gap: 8 }}>
                <input id="img-seed" className="studio-input" inputMode="numeric" value={form.seed} onChange={(e) => patch('seed', e.target.value)} />
                <button type="button" className="studio-secondary-button" aria-label="Random seed" onClick={() => patch('seed', String(Math.floor(Math.random() * 2 ** 31)))}>
                  <Icon name="sparkles" size={15} />
                </button>
              </div>
            </div>
          </Section>

          <button type="button" className="studio-primary-button" style={{ width: '100%' }} onClick={generate} disabled={busy}>
            <Icon name="sparkles" size={16} />
            {busy ? 'Generating…' : 'Generate'}
          </button>
          <p className={`studio-status ${status.includes('ready') ? 'is-ready' : status.includes('failed') || status.includes('error') || status.includes('Enter') ? 'is-error' : ''}`}>
            {status}
          </p>
        </div>

        <section aria-label="Image output">
          <div className="studio-output-head">
            <h2>Output</h2>
            <span>{busy ? 'Rendering…' : results.length ? `${results.length} images` : 'No images yet'}</span>
          </div>
          {results.length === 0 ? (
            <div className="studio-card studio-empty">
              <Icon name="image" size={26} className="studio-spark" />
              <h3>No images yet</h3>
              <p>Pick a backend, write a prompt, and hit Generate.</p>
            </div>
          ) : (
            <div className="studio-result-grid">
              {results.map((image, index) => (
                <figure className="studio-result-tile" key={`${image.url.slice(0, 40)}-${index}`}>
                  {/* Data URLs and local http URLs are safe here: the core owns
                      the wire format and there is no user HTML injection. */}
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={image.url} alt={image.label} />
                  <figcaption>{image.label}</figcaption>
                </figure>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
