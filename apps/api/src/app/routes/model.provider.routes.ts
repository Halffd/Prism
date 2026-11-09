import { Router, Request, Response } from 'express';
// The wasm pkg is a CJS module with a single default export object.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const wasm = require('../../wasm-pkg/prism_wasm.js') as {
  providers_json: () => string;
};

interface ProviderEntry {
  id: string;
  label: string;
  base_url: string;
  default_model: string;
  needs_key: boolean;
  env: string[];
}

const router = Router();

function parseProvidersJson(): ProviderEntry[] {
  // providers_json returns an array, not { providers: ... }.
  return JSON.parse(wasm.providers_json()) as ProviderEntry[];
}

/** GET /api/provider — list every provider the core knows. */
router.get('/provider', (_req: Request, res: Response) => {
  const providers = parseProvidersJson().map((p) => ({
    id: p.id,
    label: p.label,
    base_url: p.base_url,
    default_model: p.default_model,
    needs_key: p.needs_key,
    env: p.env,
  }));
  res.json({ success: true, providers });
});

/** GET /api/provider/:id — one provider's detail. */
router.get('/provider/:id', (req: Request, res: Response) => {
  const p = parseProvidersJson().find((x) => x.id === req.params.id);
  if (!p) {
    return res.status(404).json({ success: false, error: 'Provider not found' });
  }
  return res.json({
    success: true,
    provider: {
      id: p.id,
      label: p.label,
      base_url: p.base_url,
      default_model: p.default_model,
      needs_key: p.needs_key,
      env: p.env,
    },
  });
});

/**
 * GET /api/model — model ids the server can serve today: the provider
 * defaults. The per-provider /models list requires a live provider key
 * and lives on the client (which holds the key); this endpoint is the
 * credential-free catalog.
 */
router.get('/model', (req: Request, res: Response) => {
  const providerId = req.query.provider as string | undefined;
  const providers = parseProvidersJson();
  if (providerId) {
    const p = providers.find((x) => x.id === providerId);
    if (!p) {
      return res.status(404).json({ success: false, error: 'Provider not found' });
    }
    return res.json({
      success: true,
      models: p.default_model ? [p.default_model] : [],
      provider: p.id,
    });
  }
  const models = providers
    .filter((p) => p.default_model)
    .map((p) => ({ id: p.default_model, provider: p.id }));
  return res.json({ success: true, models });
});

/** GET /api/model/default — a provider's default model id. */
router.get('/model/default', (req: Request, res: Response) => {
  const providerId = req.query.provider as string | undefined;
  if (!providerId) {
    return res
      .status(400)
      .json({ success: false, error: 'provider query required' });
  }
  const p = parseProvidersJson().find((x) => x.id === providerId);
  if (!p) {
    return res.status(404).json({ success: false, error: 'Provider not found' });
  }
  if (!p.default_model) {
    return res
      .status(404)
      .json({ success: false, error: 'No default model for provider' });
  }
  return res.json({
    success: true,
    provider: providerId,
    default_model: p.default_model,
  });
});

export { router as modelProviderRouter };
