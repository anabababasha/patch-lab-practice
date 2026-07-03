export const clamp = (v: number, lo: number, hi: number) =>
  Math.min(hi, Math.max(lo, v));

/** dBFS -> linear gain */
export const dbToGain = (db: number) => Math.pow(10, db / 20);

/** linear gain -> dBFS, floored */
export const gainToDb = (g: number, floor = -60) =>
  g <= 0 ? floor : Math.max(floor, 20 * Math.log10(g));

export const formatDb = (v: number) => `${v.toFixed(1)} dB`;

export const formatHz = (v: number) =>
  v >= 1000 ? `${(v / 1000).toFixed(2)} kHz` : `${Math.round(v)} Hz`;

export const formatValue = (v: number, unit: string) => {
  switch (unit) {
    case 'dB':
      return formatDb(v);
    case 'Hz':
      return formatHz(v);
    case 'ms':
      return `${Math.round(v)} ms`;
    case '%':
      return `${Math.round(v)} %`;
    default:
      return v.toFixed(0);
  }
};

/** normalized 0..1 <-> param value, honoring taper */
export const toNorm = (
  v: number,
  min: number,
  max: number,
  taper: 'lin' | 'log' = 'lin',
) =>
  taper === 'log'
    ? Math.log(v / min) / Math.log(max / min)
    : (v - min) / (max - min);

export const fromNorm = (
  t: number,
  min: number,
  max: number,
  taper: 'lin' | 'log' = 'lin',
) => (taper === 'log' ? min * Math.pow(max / min, t) : min + t * (max - min));

export const roundToStep = (v: number, step: number) =>
  Math.round(v / step) * step;
