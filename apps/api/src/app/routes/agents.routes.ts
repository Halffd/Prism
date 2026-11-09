import { Router, Request, Response, NextFunction } from 'express';
// The wasm pkg is a CJS module with a single default export object.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const wasm = require('../../wasm-pkg/prism_wasm.js') as {
  agent_sandbox_policy_check: (policyJson: string) => string;
  agent_tool_repair: (rawInput: string) => string;
  agent_tool_classify: (observation: string) => string;
  agent_tool_clamp: (reqJson: string) => string;
  agent_subagents_list: () => string;
  agent_subagent_resolve_model: (
    name: string,
    sessionModel: string,
    providerDefault?: string | null,
  ) => string;
};

/**
 * Agent-surface endpoints — the core's agent answers as a JSON API over
 * the prism-core wasm:
 *   - GET  /agents/subagents            shipped subagent registry
 *   - POST /agents/subagents/:name/model  forced-model resolution
 *   - POST /agents/tools/repair       model-argument normalisation
 *   - POST /agents/tools/clamp        advertised-surface clamp
 *   - POST /agents/tools/classify     closed tool-error classification
 *   - POST /agents/sandbox/preflight  sandbox plan without spawning
 *
 * Everything here is deterministic and side-effect free: no process is
 * executed and no network call is made, so the routes gate nothing and
 * only serve policy/repair decisions the surface can act on.
 */

interface SandboxPreflightResponse {
  ok: boolean;
  sandbox_used?: string;
  error?: string;
}

interface ToolResponse {
  success?: boolean;
  input?: string;
  notes?: string[];
  kind?: string;
  detail?: string | null;
  error?: string;
}

/** Parse a wasm JSON payload; a malformed one is a 500, not an HTML
 *  error page (the default express handler would leak HTML into a JSON
 *  client). */
function parseWasmJson(raw: string, what: string): unknown {
  try {
    return JSON.parse(raw);
  } catch (e) {
    throw new Error(`${what}: wasm returned invalid JSON (${(e as Error).message})`);
  }
}

const router = Router();

/** GET /api/agents/subagents */
router.get('/subagents', (_req: Request, res: Response) => {
  res.json({
    success: true,
    subagents: parseWasmJson(wasm.agent_subagents_list(), 'subagents'),
  });
});

/** POST /api/agents/subagents/:name/model
 *  body: { session_model?: string, provider_default?: string } */
router.post('/subagents/:name/model', (req: Request, res: Response) => {
  const { session_model: sessionModel = '', provider_default: providerDefault = null } =
    (req.body ?? {}) as {
      session_model?: string;
      provider_default?: string | null;
    };
  const result = parseWasmJson(
    wasm.agent_subagent_resolve_model(req.params.name, sessionModel, providerDefault),
    'subagent model resolution',
  ) as { model?: string; tier?: string; error?: string };
  if (result.error) {
    return res.status(404).json({ success: false, error: result.error });
  }
  return res.json({ success: true, resolution: result });
});

/** POST /api/agents/tools/repair
 *  body: { input: string } — returns the normalised input + notes. */
router.post('/tools/repair', (req: Request, res: Response) => {
  const { input } = (req.body ?? {}) as { input?: unknown };
  if (!input || typeof input !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'input (string) is required',
    } satisfies ToolResponse);
  }
  return res.json({
    success: true,
    ...(parseWasmJson(wasm.agent_tool_repair(input), 'tool repair') as {
      input: string;
      notes: string[];
    }),
  });
});

/** POST /api/agents/tools/clamp
 *  body: { advertised: string[], tool: string } — the advertised-surface
 *  clamp: a tool that is not advertised fails closed with the list. */
router.post('/tools/clamp', (req: Request, res: Response) => {
  const { advertised, tool } = (req.body ?? {}) as {
    advertised?: unknown;
    tool?: unknown;
  };
  if (!Array.isArray(advertised) || !advertised.every((t) => typeof t === 'string')) {
    return res.status(400).json({
      success: false,
      error: 'advertised (string[]) is required',
    } satisfies ToolResponse);
  }
  if (!tool || typeof tool !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'tool (string) is required',
    } satisfies ToolResponse);
  }
  const result = parseWasmJson(
    wasm.agent_tool_clamp(JSON.stringify({ advertised, tool })),
    'tool clamp',
  ) as { ok?: boolean; error?: string };
  if (!result.ok) {
    return res.status(409).json({
      success: false,
      error: result.error ?? 'tool_clamped',
    } satisfies ToolResponse);
  }
  return res.json({ success: true, ok: true });
});

/** POST /api/agents/tools/classify
 *  body: { observation: string } — closed ToolErrorKind + detail. */
router.post('/tools/classify', (req: Request, res: Response) => {
  const { observation } = (req.body ?? {}) as { observation?: unknown };
  if (!observation || typeof observation !== 'string') {
    return res.status(400).json({
      success: false,
      error: 'observation (string) is required',
    } satisfies ToolResponse);
  }
  return res.json({
    success: true,
    ...(parseWasmJson(wasm.agent_tool_classify(observation), 'tool classification') as {
      kind: string;
      detail: string | null;
    }),
  });
});

/** POST /api/agents/sandbox/preflight
 *  body: JSON SandboxPolicy — plans how a spawn would be sandboxed.
 *  No process is spawned; strict policies on non-enforcing hosts plan
 *  to the closed `sandbox_unsupported` outcome. */
router.post('/sandbox/preflight', (req: Request, res: Response) => {
  const policy = req.body ? JSON.stringify(req.body) : '{}';
  const result = parseWasmJson(
    wasm.agent_sandbox_policy_check(policy),
    'sandbox preflight',
  ) as SandboxPreflightResponse;
  // A rejected plan is still a successful call: the plan IS the answer.
  // The closed SpawnOutcome serialises either as a bare variant name or
  // `{variant: {reason: ...}}`; normalise both to name + reason so a
  // surface can badge it without re-parsing.
  let error: string | undefined;
  let detail: string | undefined;
  if (!result.ok && typeof result.error !== 'string') {
    const nested = result.error as Record<string, { reason?: string }> | null | undefined;
    const variant = Object.keys(nested ?? {})[0] ?? 'plan_failed';
    const payload = (nested as Record<string, unknown> | null | undefined)?.[variant];
    detail =
      typeof payload === 'object' && payload ? JSON.stringify(payload) : String(payload ?? '');
    error = variant;
  }
  return res.json({ success: true, ...result, error, detail });
});

// A malformed wasm payload must not leak express' HTML error page into
// a JSON client.
router.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
  res.status(500).json({ success: false, error: err.message });
});

export { router as agentsRouter };
