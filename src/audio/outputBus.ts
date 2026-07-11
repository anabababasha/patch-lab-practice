/**
 * The single gain node between every Master Output and ctx.destination.
 * Owned by the engine (assigned in ensure()); master units read it at build time.
 * Exists so suspend/resume can fade ALL output first — a bare ctx.suspend()
 * freezes the waveform mid-swing, which pops on any hot signal (worst on PA rigs).
 * Leaf module, same pattern as triggerBus: breaks the units → engine circular import.
 */
export const outputBus = { node: null as GainNode | null };
