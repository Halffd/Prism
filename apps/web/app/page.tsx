'use client';

import { useMemo, useState } from 'react';
import { Icon } from '../src/studio/icons';

interface ModelDef {
  id: string;
  name: string;
  spec: string;
  chips: string[];
  badge?: string;
  hue: number;
}

const MODELS: ModelDef[] = [
  { id: 'seedance', name: 'Seedance', spec: '480-4k | 4-30s', chips: ['Reference', 'Start-End', 'Audio'], badge: 'Top pick', hue: 278 },
  { id: 'sora', name: 'Sora 2', spec: '480-1080p | 4-20s', chips: ['Start-End'], badge: 'Fast', hue: 218 },
  { id: 'veo', name: 'Veo 3', spec: '720-4k | 4-30s', chips: ['Reference', 'Audio'], hue: 165 },
  { id: 'kling', name: 'Kling 2.5', spec: '480-1080p | 5-10s', chips: ['Reference', 'Start-End'], badge: 'New', hue: 32 },
  { id: 'luma', name: 'Ray 2', spec: '720-4k | 5-25s', chips: ['Audio'], hue: 330 },
];

const TABS = ['Video', 'Image', 'Audio', 'Character', 'World'];
const MODES = ['Text to Video', 'Image to Video', 'First & Last Frame', 'Lip Sync'];
const COLLECTIONS = ['Unsorted', 'All creations', 'Favorites', 'Archived'];

interface VideoCard {
  id: number;
  title: string;
  ratio: string;
  resolution: string;
  duration: string;
  model: string;
  hue: number;
}

export default function StudioPage() {
  const [tab, setTab] = useState('Video');
  const [mode, setMode] = useState(MODES[0]);
  const [model, setModel] = useState(MODELS[0].id);
  const [prompt, setPrompt] = useState('');
  const [polish, setPolish] = useState(false);
  const [audio, setAudio] = useState(false);
  const [ratio, setRatio] = useState('16:9');
  const [resolution, setResolution] = useState('720p');
  const [duration, setDuration] = useState('5s');
  const [quantity, setQuantity] = useState(1);
  const [generating, setGenerating] = useState(false);
  const [cards, setCards] = useState<VideoCard[]>([]);
  const [collection, setCollection] = useState(COLLECTIONS[0]);
  const [filter, setFilter] = useState('Labels');
  const [search, setSearch] = useState('');

  const visible = useMemo(
    () => cards.filter((card) => card.title.toLowerCase().includes(search.toLowerCase())),
    [cards, search],
  );
  const selected = MODELS.find((candidate) => candidate.id === model) ?? MODELS[0];

  function generate() {
    if (generating) return;
    setGenerating(true);
    window.setTimeout(() => {
      const fresh: VideoCard[] = Array.from({ length: quantity }, (_, index) => ({
        id: Date.now() + index,
        title: prompt.trim().slice(0, 48) || `Untitled generation ${cards.length + index + 1}`,
        ratio,
        resolution,
        duration,
        model: selected.name,
        hue: (selected.hue + index * 37) % 360,
      }));
      setCards((existing) => [...fresh, ...existing]);
      setGenerating(false);
    }, 2400);
  }

  return (
    <>
      <div className="studio-page-header">
        <h1>Studio</h1>
        <p>Describe a shot, choose a model, and create. Free and unlimited.</p>
      </div>

      <div className="studio-workbench">
        <section className="studio-card" style={{ padding: 18 }} aria-label="Generation panel">
          <div className="studio-chip-row" style={{ marginBottom: 16 }}>
            {TABS.map((name) => (
              <button
                type="button"
                key={name}
                className={`studio-chip ${tab === name ? 'is-active' : ''}`}
                onClick={() => setTab(name)}
              >
                {name}
              </button>
            ))}
          </div>

          <div className="studio-field" style={{ marginBottom: 14 }}>
            <label className="studio-field-label" htmlFor="studio-mode">Mode</label>
            <select id="studio-mode" className="studio-select" value={mode} onChange={(e) => setMode(e.target.value)}>
              {MODES.map((option) => <option key={option}>{option}</option>)}
            </select>
          </div>

          <p className="studio-field-label">Model</p>
          <div className="studio-model-grid" style={{ marginBottom: 16 }}>
            {MODELS.map((candidate) => (
              <button
                type="button"
                key={candidate.id}
                className={`studio-model-card ${model === candidate.id ? 'is-active' : ''}`}
                onClick={() => setModel(candidate.id)}
              >
                <div
                  className="studio-model-thumb"
                  style={{ background: `linear-gradient(120deg, hsl(${candidate.hue} 45% 26%), #141414)` }}
                />
                <strong>{candidate.name}</strong>
                {candidate.badge ? <span className="studio-badge is-new">{candidate.badge}</span> : null}
                <small>{candidate.spec}</small>
                <small>{candidate.chips.join(' · ')}</small>
              </button>
            ))}
          </div>

          <div className="studio-field">
            <label className="studio-field-label" htmlFor="studio-prompt">Prompt</label>
            <textarea
              id="studio-prompt"
              className="studio-textarea"
              placeholder="A neon-lit street at dusk, slow dolly forward…"
              value={prompt}
              onChange={(e) => setPrompt(e.target.value)}
            />
            <div style={{ display: 'flex', gap: 8 }}>
              <button type="button" className="studio-secondary-button" onClick={() => setPrompt('')}>
                Clear prompt
              </button>
              <button type="button" className="studio-secondary-button" disabled>Add shot</button>
              <button type="button" className="studio-secondary-button" disabled>Framing</button>
            </div>
          </div>

          <div className="studio-chip-row" style={{ margin: '16px 0' }}>
            <button type="button" className={`studio-chip ${polish ? 'is-active' : ''}`} onClick={() => setPolish(!polish)}>
              Auto Polish
            </button>
            <button type="button" className={`studio-chip ${audio ? 'is-active' : ''}`} onClick={() => setAudio(!audio)}>
              <Icon name="volume" size={13} /> Audio {audio ? 'On' : 'Off'}
            </button>
          </div>

          <div className="studio-node-section">
            <h3 className="studio-node-title">Output settings</h3>
            <div className="studio-node-body">
              <div>
                <span className="studio-field-label">Aspect ratio</span>
                <div className="studio-chip-row" style={{ marginTop: 6 }}>
                  {['16:9', '9:16', '1:1'].map((value) => (
                    <button type="button" key={value} className={`studio-chip ${ratio === value ? 'is-active' : ''}`} onClick={() => setRatio(value)}>{value}</button>
                  ))}
                </div>
              </div>
              <div>
                <span className="studio-field-label">Resolution</span>
                <div className="studio-chip-row" style={{ marginTop: 6 }}>
                  {['480p', '720p', '1080p'].map((value) => (
                    <button type="button" key={value} className={`studio-chip ${resolution === value ? 'is-active' : ''}`} onClick={() => setResolution(value)}>{value}</button>
                  ))}
                </div>
              </div>
              <div>
                <span className="studio-field-label">Duration</span>
                <div className="studio-chip-row" style={{ marginTop: 6 }}>
                  {['5s', '10s'].map((value) => (
                    <button type="button" key={value} className={`studio-chip ${duration === value ? 'is-active' : ''}`} onClick={() => setDuration(value)}>{value}</button>
                  ))}
                </div>
              </div>
              <div className="studio-field">
                <span className="studio-field-label">Quantity — 1 to 8, unrestricted</span>
                <div className="studio-stepper">
                  <button type="button" aria-label="Decrease quantity" onClick={() => setQuantity(Math.max(1, quantity - 1))}><Icon name="minus" size={14} /></button>
                  <span>{quantity}</span>
                  <button type="button" aria-label="Increase quantity" onClick={() => setQuantity(Math.min(8, quantity + 1))}><Icon name="plus" size={14} /></button>
                </div>
              </div>
            </div>
          </div>

          <button type="button" className="studio-primary-button" style={{ width: '100%' }} onClick={generate} disabled={generating}>
            <Icon name={generating ? 'sparkles' : 'play'} size={16} />
            {generating ? 'Generating…' : 'Generate'}
          </button>
        </section>

        <section aria-label="Workspace">
          <div className="studio-workspace-bar">
            <select className="studio-select" style={{ width: 'auto' }} value={collection} onChange={(e) => setCollection(e.target.value)}>
              {COLLECTIONS.map((option) => <option key={option}>{option}</option>)}
            </select>
            {['Labels', 'Folders', 'Templates'].map((name) => (
              <button type="button" key={name} className={`studio-chip ${filter === name ? 'is-active' : ''}`} onClick={() => setFilter(name)}>{name}</button>
            ))}
            <label className="studio-field" style={{ marginLeft: 'auto', minWidth: 180 }}>
              <span className="studio-field-label">Search creations</span>
              <input className="studio-input" value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search…" />
            </label>
          </div>

          {generating ? (
            <div className="studio-card studio-generating">
              <div className="studio-spinner" />
              <strong>Generating your video…</strong>
              <span className="studio-status">Free and unlimited — no credits, no waiting rooms.</span>
              <div className="studio-empty" style={{ minHeight: 40, border: 0 }} />
            </div>
          ) : visible.length === 0 ? (
            <div className="studio-card studio-empty">
              <div className="studio-polaroids">
                <div className="studio-polaroid" /><div className="studio-polaroid" /><div className="studio-polaroid" />
              </div>
              <Icon name="sparkles" size={26} className="studio-spark" />
              <h3>Empty, for now — your first creation changes that.</h3>
            </div>
          ) : (
            <div className="studio-video-grid">
              {visible.map((card) => (
                <article className="studio-video-card" key={card.id}>
                  <div
                    className="studio-video-thumb"
                    style={{ background: `linear-gradient(135deg, hsl(${card.hue} 45% 25%), #121212)` }}
                  >
                    <Icon name="play" size={28} />
                  </div>
                  <div>
                    <strong>{card.title}</strong>
                    <small style={{ display: 'block', color: 'var(--studio-sub)', marginTop: 4 }}>
                      {card.model} · {card.ratio} · {card.resolution} · {card.duration}
                    </small>
                  </div>
                </article>
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}
