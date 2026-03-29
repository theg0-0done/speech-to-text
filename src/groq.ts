import type { SpeechEngineCallbacks } from './speech';

export interface GroqExtraCallbacks {
  onChunkStart: (counter: number) => void;
  onDetectedLanguage: (lang: string) => void;
  onChunkError: (msg: string) => void;
}

export class GroqEngine {
  private callbacks: SpeechEngineCallbacks;
  private extraCallbacks: GroqExtraCallbacks;
  private lang: string;
  private active = false;
  private stream: MediaStream | null = null;
  private mediaRecorder: MediaRecorder | null = null;
  private chunkCounter = 0;
  private apiKey: string;
  private chunkTimer: number | null = null;

  constructor(lang: string, callbacks: SpeechEngineCallbacks, extraCallbacks: GroqExtraCallbacks) {
    this.lang = lang;
    this.callbacks = callbacks;
    this.extraCallbacks = extraCallbacks;
    this.apiKey = import.meta.env.VITE_GROQ_API_KEY || '';
  }

  async start(): Promise<void> {
    if (!this.apiKey) {
      this.callbacks.onError('Add your Groq API key to the .env file to use this app. Get a free key at console.groq.com');
      return;
    }
    if (this.active) return;
    this.active = true;
    this.chunkCounter = 0;

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      this.startRecordingChunk();
    } catch (err: any) {
      this.active = false;
      this.callbacks.onError('Microphone access was denied or failed. Please allow mic access and try again.');
    }
  }

  stop(): void {
    if (!this.active) return;
    this.active = false;
    
    if (this.chunkTimer) {
      clearTimeout(this.chunkTimer as number);
      this.chunkTimer = null;
    }

    if (this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
      this.mediaRecorder.stop();
    } else {
      this.cleanupStream();
      this.callbacks.onEnd();
    }
  }

  setLanguage(lang: string): void {
    this.lang = lang;
  }

  get isActive(): boolean {
    return this.active;
  }

  private startRecordingChunk = () => {
    if (!this.active || !this.stream) return;
    
    this.mediaRecorder = new MediaRecorder(this.stream);
    let chunkData: Blob | null = null;

    this.mediaRecorder.ondataavailable = (e) => {
      if (e.data.size > 0) {
        chunkData = e.data;
      }
    };

    this.mediaRecorder.onstop = () => {
      if (chunkData && chunkData.size > 0) {
        this.processChunk(chunkData, this.chunkCounter);
      }
      if (this.active) {
        this.startRecordingChunk();
      } else {
        this.cleanupStream();
        this.callbacks.onEnd();
      }
    };

    this.mediaRecorder.start();
    this.chunkCounter++;
    this.extraCallbacks.onChunkStart(this.chunkCounter);

    // Stop and finalize the current chunk after 2 seconds
    this.chunkTimer = window.setTimeout(() => {
      if (this.active && this.mediaRecorder && this.mediaRecorder.state !== 'inactive') {
        this.mediaRecorder.stop();
      }
    }, 2000);
  };

  private cleanupStream() {
    if (this.stream) {
      this.stream.getTracks().forEach(track => track.stop());
      this.stream = null;
    }
  }

  private async processChunk(blob: Blob, chunkNumber: number) {
    const formData = new FormData();
    // Use an extension that whisper understands
    formData.append('file', blob, 'chunk.webm');
    formData.append('model', 'whisper-large-v3-turbo');
    formData.append('response_format', 'verbose_json');
    
    // Map lang to 2-letter ISO (Web Speech is BCP-47)
    const isoLang = this.lang.split('-')[0];
    formData.append('language', isoLang);

    try {
      const resp = await fetch('https://api.groq.com/openai/v1/audio/transcriptions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${this.apiKey}`
        },
        body: formData
      });

      if (!resp.ok) {
        const errJson = await resp.json().catch(() => ({}));
        throw new Error(errJson.error?.message || `HTTP ${resp.status}`);
      }

      const data = await resp.json();
      if (data.text) {
        this.callbacks.onFinal(data.text);
      }
      if (data.language) {
        this.extraCallbacks.onDetectedLanguage(data.language);
      }
    } catch (err: any) {
      this.extraCallbacks.onChunkError(`Chunk ${chunkNumber} failed: ${err.message}`);
    }
  }
}
