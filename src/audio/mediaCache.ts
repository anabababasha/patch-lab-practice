/**
 * Decoded media buffers and the mic stream live OUTSIDE the audio units,
 * because units are disposed and recreated on every structural rebuild.
 */

export interface MediaEntry {
  buffer: AudioBuffer;
  name: string;
}

export const mediaCache = new Map<string, MediaEntry>(); // nodeId -> entry

/* ------------------------------------------------------------- mic */

class MicManager {
  stream: MediaStream | null = null;
  private pending: Promise<MediaStream> | null = null;
  onDenied: ((msg: string) => void) | null = null;
  onGranted: (() => void) | null = null;

  /** Request the mic once; subsequent calls reuse the stream. */
  request(): Promise<MediaStream> {
    if (this.stream) return Promise.resolve(this.stream);
    if (this.pending) return this.pending;
    this.pending = navigator.mediaDevices
      .getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      })
      .then((s) => {
        this.stream = s;
        this.pending = null;
        this.onGranted?.();
        return s;
      })
      .catch((err) => {
        this.pending = null;
        this.onDenied?.(
          err?.name === 'NotAllowedError'
            ? 'Microphone access was denied — allow it in the browser and try again.'
            : 'Could not open the microphone.',
        );
        throw err;
      });
    return this.pending;
  }
}

export const micManager = new MicManager();
