export type MidiDeviceId = 'all' | string;

export interface MidiInputInfo {
  id: string;
  name: string;
}

export interface MidiStatus {
  state: 'not_enabled' | 'enabled' | 'unavailable';
  inputCount: number;
}

interface MidiRegistration {
  getDevice: () => MidiDeviceId;
  getChannel: () => number;
  onNote: (note: number, velocity: number) => void;
}

type InputListener = {
  input: MIDIInput;
  handler: EventListener;
};

class MidiService {
  private access: MIDIAccess | null = null;
  private pending: Promise<void> | null = null;
  private status: MidiStatus = { state: 'not_enabled', inputCount: 0 };
  private registrations = new Map<string, MidiRegistration>();
  private attachedInputs = new Map<string, InputListener>();
  private listeners = new Set<() => void>();
  onToast: ((msg: string) => void) | null = null;

  enable(): Promise<void> {
    if (this.access) return Promise.resolve();
    if (this.pending) return this.pending;

    const request = this.getRequest();
    if (!request) {
      this.status = { state: 'unavailable', inputCount: 0 };
      this.notify();
      return Promise.resolve();
    }

    let timeoutId: number | undefined;
    const timeout = new Promise<MIDIAccess>((_, reject) => {
      timeoutId = window.setTimeout(() => reject(new Error('MIDI permission timed out')), 10000);
    });

    this.pending = Promise.race([request(), timeout])
      .then((access) => {
        this.access = access;
        this.status = { state: 'enabled', inputCount: access.inputs.size };
        access.addEventListener('statechange', this.handleStateChange);
        this.refreshInputs();
      })
      .catch(() => {
        this.status = { state: 'not_enabled', inputCount: 0 };
        this.onToast?.('MIDI permission was not granted.');
        this.notify();
      })
      .finally(() => {
        window.clearTimeout(timeoutId);
        this.pending = null;
      });

    return this.pending;
  }

  getInputs(): MidiInputInfo[] {
    if (!this.access) return [];
    return Array.from(this.access.inputs.values()).map((input) => ({
      id: input.id,
      name: input.name?.trim() || 'MIDI input',
    }));
  }

  getDeviceOptions(): string[] {
    return ['All', ...this.getInputs().map((input) => input.name)];
  }

  getStatus(): MidiStatus {
    if (!this.getRequest()) return { state: 'unavailable', inputCount: 0 };
    if (this.access) return { state: 'enabled', inputCount: this.access.inputs.size };
    return this.status;
  }

  deviceIdAtIndex(index: number): MidiDeviceId {
    if (index <= 0) return 'all';
    return this.getInputs()[index - 1]?.id ?? 'all';
  }

  register(nodeId: string, registration: MidiRegistration) {
    this.registrations.set(nodeId, registration);
    if (this.access) this.refreshInputs();
  }

  unregister(nodeId: string) {
    this.registrations.delete(nodeId);
  }

  prune(liveIds: Set<string>) {
    for (const nodeId of this.registrations.keys()) {
      if (!liveIds.has(nodeId)) this.registrations.delete(nodeId);
    }
  }

  subscribe(cb: () => void) {
    this.listeners.add(cb);
    cb();
    return () => {
      this.listeners.delete(cb);
    };
  }

  private getRequest() {
    if (typeof navigator === 'undefined') return null;
    const nav = navigator as Navigator & {
      requestMIDIAccess?: (options?: MIDIOptions) => Promise<MIDIAccess>;
    };
    return typeof nav.requestMIDIAccess === 'function'
      ? nav.requestMIDIAccess.bind(nav)
      : null;
  }

  private handleStateChange = () => {
    this.refreshInputs();
  };

  private refreshInputs() {
    if (!this.access) return;

    const current = new Set<string>();
    for (const input of this.access.inputs.values()) {
      current.add(input.id);
      if (this.attachedInputs.has(input.id)) continue;
      const handler = ((event: Event) => {
        this.handleMidiMessage(input.id, event as MIDIMessageEvent);
      }) as EventListener;
      input.addEventListener('midimessage', handler);
      this.attachedInputs.set(input.id, { input, handler });
    }

    for (const [id, attached] of this.attachedInputs.entries()) {
      if (current.has(id)) continue;
      attached.input.removeEventListener('midimessage', attached.handler);
      this.attachedInputs.delete(id);
    }

    this.status = { state: 'enabled', inputCount: this.access.inputs.size };
    this.notify();
  }

  private handleMidiMessage(inputId: string, event: MIDIMessageEvent) {
    const data = event.data;
    if (!data || data.length < 3) return;

    const status = data[0];
    const command = status & 0xf0;
    const channel = (status & 0x0f) + 1;
    const note = data[1];
    const velocity = data[2];

    if (command !== 0x90 || velocity <= 0) return;

    for (const registration of this.registrations.values()) {
      const device = registration.getDevice();
      if (device !== 'all' && device !== inputId) continue;
      const wantedChannel = registration.getChannel();
      if (wantedChannel !== 0 && wantedChannel !== channel) continue;
      registration.onNote(note, velocity / 127);
    }
  }

  private notify() {
    for (const cb of this.listeners) cb();
  }
}

export const midiService = new MidiService();
