import { Router, Request, Response } from 'express';
import { wasm } from '../../wasm-pkg/prism_wasm.js';

const router = Router();

interface ProviderEntry {
  id: string;
  label: string;
  base_url: string;
  default_model: string;
  needs_key: boolean;
  env: string[];
}

interface ModelEntry {
  id: string;
  name: string;
  reasoning: boolean;
  tool_call: boolean;
  attachment: boolean;
  temperature: boolean;
  limit_context: number | null;
  limit_output: number | null;
  cost_in: number | null;
  cost_out: number | null;
  modalities_in: string[];
  status: string | null;
  release_date: string | null;
}

function parseProvidersJson(): ProviderEntry[] {
  const raw = wasm.providers_json();
  return JSON.parse(raw) as ProviderEntry[];
}

function parseModelsJson(providerId: string): ModelEntry[] {
  const providers = parseProvidersJson();
  const p = providers.find(p => p.id === providerId);
  if (!p || !p.models) return [];
  return Object.entries(p.models).map(([id, m]) => ({ id, ...m }));
}

/** GET /api/model — list all models for all providers, or filter by provider query. */
router.get('/model', (req: Request, res: Response) => {
  const providerId = req.query.provider as string | undefined;
  const providers = parseProvidersJson();

  let models: ModelEntry[] = [];
  if (providerId) {
    const p = providers.find(p => p.id === providerId);
    if (!p) {
      return res.status(404).json({ success: false, error: 'Provider not found' });
    }
    models = Object.entries(p.models).map(([id, m]) => ({ id, ...m }));
  } else {
    for (const p of providers) {
      models.push(...Object.entries(p.models).map(([id, m]) => ({ id, provider: p.id, ...m })));
    }
  }
  res.json({ success: true, models });
});

/** GET /api/model/default — returns the default model for a provider. */
router.get('/model/default', (req: Request, res: Response) => {
  const providerId = req.query.provider as string | undefined;
  if (!providerId) {
    return res.status(400).json({ success: false, error: 'provider query required' });
  }
  const providers = parseProvidersJson();
  const p = providers.find(p => p.id === providerId);
  if (!p) {
    return res.status(404).json({ success: false, error: 'Provider not found' });
  }
  const defaultModel = p.default_model || (p.models ? Object.keys(p.models)[0] : '');
  if (!defaultModel) {
    return res.status(404).json({ success: false, error: 'No default model for provider' });
  }
  res.json({ success: true, provider: providerId, default_model: defaultModel });
});

/** GET /api/provider — list all providers. */
router.get('/provider', (req: Request, res: Response) => {
  const providers = parseProvidersJson().map(p => ({
    id: p.id,
    label: p.label,
    base_url: p.base_url,
    default_model: p.default_model,
    needs_key: p.needs_key,
    env: p.env,
  }));
  res.json({ success: true, providers });
});

/** GET /api/provider/:id — single provider detail. */
router.get('/provider/:id', (req: Request, res: Response) => {
  const providers = parseProvidersJson();
  const p = providers.find(p => p.id === req.params.id);
  if (!p) {
    return res.status(404).json({ success: false, error: 'Provider not found' });
  }
  res.json({
    success: true,
    provider: {
      id: p.id,
      label: p.label,
      base_url: p.base_url,
      default_model: p.default_model,
      needs_key: p.needs_key,
      env: p.env,
      models: Object.keys(p.models).map(id => {
        const m = p.models[id];
        return {
          id,
          name: m.name,
          reasoning: m.reasoning,
          tool_call: m.tool_call,
          attachment: m.attachment,
          limit_context: m.limit_context,
          cost_in: m.cost_in,
          cost_out: m.cost_out,
          status: m.status,
        };
      }),
    },
  });
});

export { router as modelProviderRouter };