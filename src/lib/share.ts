import * as LZString from 'lz-string';

const SHARE_PREFIX = '#d=';
const codec = (LZString as { default?: typeof LZString }).default ?? LZString;

export function designToUrl(design: unknown, baseUrl?: string): string {
  const payload = codec.compressToEncodedURIComponent(JSON.stringify(design));
  const base =
    baseUrl ??
    (typeof location === 'undefined'
      ? ''
      : `${location.origin}${location.pathname}`);
  return `${base}${SHARE_PREFIX}${payload}`;
}

export function urlToDesign(hash: string): unknown | null {
  try {
    const fragment = hash.startsWith('#') ? hash : `#${hash}`;
    if (!fragment.startsWith(SHARE_PREFIX)) return null;
    const payload = fragment.slice(SHARE_PREFIX.length);
    if (!payload) return null;
    const json = codec.decompressFromEncodedURIComponent(payload);
    if (!json) return null;
    return JSON.parse(json);
  } catch {
    return null;
  }
}
