export const NODE_WIDTH = 200;
export const HEADER_H = 34;
export const ROW_H = 26;

/** signal-1..4 from DESIGN.md — index with (colorIndex - 1) */
export const SIGNAL_HUES = ['#2ECC71', '#FF8A1E', '#FFC933', '#3B9CFF'];

export const hueFor = (colorIndex: number) =>
  SIGNAL_HUES[(colorIndex - 1 + SIGNAL_HUES.length) % SIGNAL_HUES.length];
