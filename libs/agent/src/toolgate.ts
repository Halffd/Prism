/**
 * The tool gate, bound to the core wasm.
 *
 * The core owns the three rules (clamp the advertised surface, repair a
 * model-produced argument, classify the observation) — `gated_execute`
 * in `prism-core` is the authority. This module is the same gate over
 * the wasm, so the TypeScript agent loop enforces exactly what the CLI,
 * the desktop app and the API enforce.
 */
import {
  classifyToolObservation,
  clampToolCall,
  loadCore,
  repairToolInput,
  type WasmCore,
} from '@prism/ai-core';

/** The gate's view of one tool call. */
export interface ToolGate {
  /** Normalise a model-produced argument into the plain string the
   *  tools take. `notes` names every change applied. */
  repair(rawInput: string): { input: string; notes: string[] };
  /** The fail-closed reason when the tool is not advertised, or `null`
   *  when the call may run. */
  clamp(advertised: string[], tool: string): string | null;
  /** Classify an observation; `detail` is the actionable advice the
   *  core appends to the observation text. */
  classify(observation: string): { kind: string; detail: string | null };
}

/** Bind the gate to a core. */
export function bindToolGate(core: WasmCore): ToolGate {
  return {
    repair: (rawInput) => repairToolInput(core, rawInput),
    clamp: (advertised, tool) => {
      const result = clampToolCall(core, advertised, tool);
      return result.ok ? null : (result.error ?? 'tool_clamped');
    },
    classify: (observation) => classifyToolObservation(core, observation),
  };
}

/**
 * Load the gate. A host without the core wasm runs ungated: the gate is
 * an extra boundary in front of the executor, not the only one — the
 * executor's own "not a recognized tool" answer still holds.
 */
export async function loadToolGate(): Promise<ToolGate | null> {
  try {
    return bindToolGate(await loadCore());
  } catch (e) {
    console.warn('tool gate unavailable, running ungated:', e);
    return null;
  }
}
