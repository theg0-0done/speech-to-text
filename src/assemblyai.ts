// AssemblyAI real-time streaming engine using the V3 WebSocket API.
// Captures mic audio via AudioWorklet, streams 16-bit PCM at 16 kHz.

import type { SpeechEngineCallbacks } from './speech';

/** Speaker-labeled segment returned from AssemblyAI Turn events */
export interface SpeakerSegment {
  speaker: string;
  text: string;
}

export interface AssemblyAIExtraCallbacks {
  /** Turn received with speaker segments (when diarization is on) */
  onSpeakerTurn: (segments: SpeakerSegment[], isFinal: boolean) => void;
  onSessionStart: () => void;
  onError: (msg: string) => void;
  onStateChange: (state: 'requesting_mic' | 'connecting' | 'ready' | 'recording' | 'stopped', errorMsg?: string) => void;
}

// ---- AudioWorklet inline processor (converted to blob URL) ----
// Buffer ~100ms of audio (1600 samples at 16kHz) before sending.
// AssemblyAI V3 requires chunks between 50ms and 1000ms.
const BUFFER_SIZE = 1600; // 100ms at 16kHz

const WORKLET_CODE = `
class PcmProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._buffer = new Float32Array(${BUFFER_SIZE});
    this._offset = 0;
  }
  process(inputs) {
    const input = inputs[0];
    if (input && input.length > 0) {
      const float32 = input[0];
      for (let i = 0; i < float32.length; i++) {
        this._buffer[this._offset++] = float32[i];
        if (this._offset >= ${BUFFER_SIZE}) {
          // Buffer full — convert to Int16 and send
          const int16 = new Int16Array(${BUFFER_SIZE});
          for (let j = 0; j < ${BUFFER_SIZE}; j++) {
            const s = Math.max(-1, Math.min(1, this._buffer[j]));
            int16[j] = s < 0 ? s * 0x8000 : s * 0x7FFF;
          }
          this.port.postMessage(int16.buffer, [int16.buffer]);
          this._offset = 0;
        }
      }
    }
    return true;
  }
}
registerProcessor('pcm-processor', PcmProcessor);
`;

const SAMPLE_RATE = 16_000;

export class AssemblyAIEngine {
  private callbacks: SpeechEngineCallbacks;
  private extraCallbacks: AssemblyAIExtraCallbacks;
  private lang: string;
  private active = false;
  private ws: WebSocket | null = null;
  private audioCtx: AudioContext | null = null;
  private sourceNode: MediaStreamAudioSourceNode | null = null;
  private workletNode: AudioWorkletNode | null = null;
  private mediaStream: MediaStream | null = null;

  constructor(
    lang: string,
    callbacks: SpeechEngineCallbacks,
    extraCallbacks: AssemblyAIExtraCallbacks,
  ) {
    this.lang = lang;
    this.callbacks = callbacks;
    this.extraCallbacks = extraCallbacks;
    console.log('[AssemblyAIEngine] Initialized with lang:', lang);
  }

  async start(): Promise<void> {
    if (this.active) {
      console.warn('[AssemblyAIEngine] Already active, ignoring start()');
      return;
    }
    this.active = true;

    try {
      console.log('[AssemblyAIEngine] Requesting microphone access...');
      this.extraCallbacks.onStateChange('requesting_mic');
      this.mediaStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          channelCount: 1,
          sampleRate: SAMPLE_RATE,
          echoCancellation: true,
          noiseSuppression: true,
        },
      });
      console.log('[AssemblyAIEngine] Microphone access granted');

      this.audioCtx = new AudioContext({ sampleRate: SAMPLE_RATE });
      console.log('[AssemblyAIEngine] AudioContext created, actual sampleRate:', this.audioCtx.sampleRate);

      const blob = new Blob([WORKLET_CODE], { type: 'application/javascript' });
      const workletUrl = URL.createObjectURL(blob);
      await this.audioCtx.audioWorklet.addModule(workletUrl);
      URL.revokeObjectURL(workletUrl);
      console.log('[AssemblyAIEngine] AudioWorklet module loaded');

      this.sourceNode = this.audioCtx.createMediaStreamSource(this.mediaStream);
      this.workletNode = new AudioWorkletNode(this.audioCtx, 'pcm-processor');

      await this.connectWebSocket();

      this.workletNode.port.onmessage = (ev: MessageEvent<ArrayBuffer>) => {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
          this.ws.send(ev.data);
        }
      };

      this.sourceNode.connect(this.workletNode);
      this.workletNode.connect(this.audioCtx.destination);
      console.log('[AssemblyAIEngine] Audio pipeline connected');
    } catch (err: unknown) {
      this.active = false;
      const msg = err instanceof Error ? err.message : 'Unknown microphone error';
      console.error('[AssemblyAIEngine] Start failed:', err);
      this.extraCallbacks.onStateChange('stopped', `Microphone access was denied or failed: ${msg}`);
      this.callbacks.onError(`Microphone access was denied or failed: ${msg}`);
    }
  }

  stop(): void {
    if (!this.active) {
      console.warn('[AssemblyAIEngine] Not active, ignoring stop()');
      return;
    }
    this.active = false;

    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      console.log('[AssemblyAIEngine] Sending Terminate signal');
      this.ws.send(JSON.stringify({ type: 'Terminate' }));
    }

    this.cleanup();
    this.extraCallbacks.onStateChange('stopped');
    this.callbacks.onEnd();
  }

  setLanguage(lang: string): void {
    console.log('[AssemblyAIEngine] Language changed to:', lang);
    this.lang = lang;
  }

  get isActive(): boolean {
    return this.active;
  }

  private async connectWebSocket(): Promise<void> {
    try {
      console.log('[AssemblyAIEngine] Fetching session token...');
      this.extraCallbacks.onStateChange('connecting');

      // Use relative URL so the Vite dev proxy handles the request
      const res = await fetch('/api/assemblyai-token', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
      });

      if (!res.ok) {
        let errorDetail = '';
        try {
          const errData = await res.json();
          errorDetail = errData.error || errData.details || JSON.stringify(errData);
        } catch {
          errorDetail = `${res.status} ${res.statusText}`;
        }
        console.error('[AssemblyAIEngine] Token fetch failed:', res.status, errorDetail);
        throw new Error(`Token fetch failed: ${errorDetail}`);
      }

      const data = await res.json();
      console.log('[AssemblyAIEngine] Token response keys:', Object.keys(data));

      const token = data.token;
      if (!token) {
        console.error('[AssemblyAIEngine] No token in response:', data);
        throw new Error('No token returned from server');
      }
      console.log('[AssemblyAIEngine] Token received, length:', token.length);

      // Determine which streaming model to use based on language
      const langCode = (this.lang || 'en').split('-')[0];
      const speechModel = langCode === 'en'
        ? 'universal-streaming-english'
        : 'universal-streaming-multilingual';

      const params = new URLSearchParams({
        speech_model: speechModel,
        sample_rate: String(SAMPLE_RATE),
        token,
      });

      const url = `wss://streaming.assemblyai.com/v3/ws?${params.toString()}`;
      console.log('[AssemblyAIEngine] Connecting to WebSocket with model:', speechModel);
      console.log('[AssemblyAIEngine] WebSocket URL (token redacted):', url.replace(token, 'TOKEN_REDACTED'));

      this.ws = new WebSocket(url);
      this.ws.binaryType = 'arraybuffer';

      this.ws.onopen = () => {
        console.log('[AssemblyAIEngine] WebSocket connection established');
      };

      this.ws.onmessage = (ev: MessageEvent) => {
        try {
          const msg = JSON.parse(ev.data as string) as Record<string, unknown>;
          this.handleMessage(msg);
        } catch (e) {
          console.warn('[AssemblyAIEngine] Message parse error:', e, 'Raw data:', ev.data);
        }
      };

      this.ws.onerror = (e) => {
        console.error('[AssemblyAIEngine] WebSocket error event:', e);
        this.extraCallbacks.onError('WebSocket connection error.');
      };

      this.ws.onclose = (ev) => {
        console.log('[AssemblyAIEngine] WebSocket closed — code:', ev.code, 'reason:', ev.reason, 'wasClean:', ev.wasClean);
        if (ev.code !== 1000 && ev.reason) {
          // Non-normal close — show the reason to the user
          console.error('[AssemblyAIEngine] Abnormal close:', ev.reason);
          this.extraCallbacks.onStateChange('stopped', `Connection closed: ${ev.reason}`);
          this.extraCallbacks.onError(`Connection closed: ${ev.reason}`);
        }
        if (this.active) {
          this.active = false;
          this.cleanup();
          this.extraCallbacks.onStateChange('stopped');
          this.callbacks.onEnd();
        }
      };
    } catch (e) {
      console.error('[AssemblyAIEngine] connectWebSocket error:', e);
      this.active = false;
      const msg = e instanceof Error ? e.message : 'WebSocket initialization failed';
      this.extraCallbacks.onStateChange('stopped', msg);
      this.extraCallbacks.onError(msg);
    }
  }

  private handleMessage(data: Record<string, unknown>): void {
    const msgType = data['type'] as string | undefined;
    console.log('[AssemblyAIEngine] Message received, type:', msgType);

    if (msgType === 'Begin') {
      console.log('[AssemblyAIEngine] Session started (V3), id:', data['id']);
      this.extraCallbacks.onStateChange('ready');
      setTimeout(() => {
        if (this.active) this.extraCallbacks.onStateChange('recording');
      }, 500);
      this.extraCallbacks.onSessionStart();
    } else if (msgType === 'Turn') {
      const transcript = (data['transcript'] as string) || '';
      const endOfTurn = data['end_of_turn'] as boolean;
      const words = data['words'] as Array<{ speaker: string; text: string }> | undefined;

      console.log('[AssemblyAIEngine] Turn — endOfTurn:', endOfTurn, 'transcript length:', transcript.length, 'words count:', words?.length ?? 0);

      if (words && words.length > 0) {
        const segments = this.buildSpeakerSegments(words);
        const uniqueSpeakers = new Set(segments.map((s) => s.speaker));

        if (uniqueSpeakers.size > 1) {
          this.extraCallbacks.onSpeakerTurn(segments, endOfTurn === true);
        } else if (endOfTurn) {
          this.callbacks.onFinal(transcript);
        } else {
          this.callbacks.onInterim(transcript);
        }
      } else {
        if (endOfTurn) {
          this.callbacks.onFinal(transcript);
        } else {
          this.callbacks.onInterim(transcript);
        }
      }
    } else if (msgType === 'Termination') {
      console.log('[AssemblyAIEngine] Received Termination message:', data);
    } else if (msgType === 'Error') {
      console.error('[AssemblyAIEngine] API server error:', data['error'] || data);
      const errMsg = (data['error'] as string) || 'Streaming error';
      this.extraCallbacks.onStateChange('stopped', errMsg);
      this.extraCallbacks.onError(errMsg);
    } else {
      console.log('[AssemblyAIEngine] Unhandled message type:', msgType, data);
    }
  }

  private buildSpeakerSegments(words: Array<{ speaker: string; text: string }>): SpeakerSegment[] {
    const segments: SpeakerSegment[] = [];
    let currentSpeaker = '';
    let currentText = '';

    for (const word of words) {
      const spk = word.speaker || 'A';
      if (spk !== currentSpeaker) {
        if (currentText.trim()) {
          segments.push({ speaker: currentSpeaker, text: currentText.trim() });
        }
        currentSpeaker = spk;
        currentText = word.text;
      } else {
        currentText += ' ' + word.text;
      }
    }
    if (currentText.trim()) {
      segments.push({ speaker: currentSpeaker, text: currentText.trim() });
    }
    return segments;
  }

  private cleanup(): void {
    console.log('[AssemblyAIEngine] Cleaning up resources...');
    if (this.workletNode) {
      this.workletNode.disconnect();
      this.workletNode = null;
    }
    if (this.sourceNode) {
      this.sourceNode.disconnect();
      this.sourceNode = null;
    }
    if (this.audioCtx) {
      void this.audioCtx.close();
      this.audioCtx = null;
    }
    if (this.mediaStream) {
      this.mediaStream.getTracks().forEach((t) => t.stop());
      this.mediaStream = null;
    }
    if (this.ws) {
      if (this.ws.readyState === WebSocket.OPEN || this.ws.readyState === WebSocket.CONNECTING) {
        this.ws.close();
      }
      this.ws = null;
    }
    console.log('[AssemblyAIEngine] Cleanup complete');
  }
}
