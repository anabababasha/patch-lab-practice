import type { Design, NodeInstance, ParamSpec } from '../lib/types';

/** Musical division table: label → length in beats (quarter notes). */
export const DIVISIONS: Array<{ label: string; beats: number }> = [
  { label: '1/1', beats: 4 },
  { label: '1/2·', beats: 3 },
  { label: '1/2', beats: 2 },
  { label: '1/4·', beats: 1.5 },
  { label: '1/4', beats: 1 },
  { label: '1/8·', beats: 0.75 },
  { label: '1/8', beats: 0.5 },
  { label: '1/16', beats: 0.25 },
  { label: '1/8T', beats: 1 / 3 },
  { label: '1/16T', beats: 1 / 6 },
  { label: '1/32', beats: 0.125 },
];

/** `{paramId}_div` select options: 0 = Auto, 1 = Free, 2+ = DIVISIONS[v - 2]. */
export const DIVISION_OPTIONS = ['Auto', 'Free', ...DIVISIONS.map((d) => d.label)];

/**
 * Effective division for a syncable param, or null when effectively free.
 * Explicit division (≥2) and explicit Free (1) ALWAYS win; Auto (0) follows
 * the session Sync switch at the param's registry defaultDiv.
 */
export function divisionFor(
  divValue: number,
  spec: ParamSpec,
  sessionSync: boolean,
): { label: string; beats: number } | null {
  if (!spec.sync) return null;
  const v = Math.round(divValue);
  if (v >= 2) return DIVISIONS[Math.min(v - 2, DIVISIONS.length - 1)] ?? null;
  if (v === 1) return null;
  return sessionSync ? DIVISIONS[spec.sync.defaultDiv] ?? null : null;
}

/** BPM + division → value in the param's own unit, clamped to registry range. */
export function syncedValue(spec: ParamSpec, beats: number, bpm: number): number {
  const seconds = (beats * 60) / bpm;
  const raw = spec.sync?.kind === 'hz' ? 1 / seconds : seconds * 1000;
  return Math.min(spec.max, Math.max(spec.min, raw));
}

/**
 * The value a unit should receive for this param right now. While effectively
 * synced the stored free value is untouched — switching back to Free restores
 * it exactly. Units stay unaware of sync: they keep receiving plain Hz/ms.
 */
export function resolveParamValue(
  node: NodeInstance,
  spec: ParamSpec,
  design: Design,
  bpm: number,
): number {
  const stored = node.params[spec.id] ?? spec.default;
  if (!spec.sync) return stored;
  const div = divisionFor(
    node.params[`${spec.id}_div`] ?? 0,
    spec,
    design.settings?.sync ?? false,
  );
  return div ? syncedValue(spec, div.beats, bpm) : stored;
}
