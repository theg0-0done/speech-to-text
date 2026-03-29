/// <reference path="./speech.d.ts" />
// SpeechEngine wraps the Web Speech API into a clean, typed class.

export interface SpeechEngineCallbacks {
  onInterim: (text: string) => void;
  onFinal: (text: string) => void;
  onError: (msg: string) => void;
  onEnd: () => void;
}

export class SpeechEngine {
  private recognition: SpeechRecognition | null = null;
  private callbacks: SpeechEngineCallbacks;
  private lang: string;
  private active = false;

  constructor(lang: string, callbacks: SpeechEngineCallbacks) {
    this.lang = lang;
    this.callbacks = callbacks;
    this.init();
  }

  start(): void {
    if (!this.recognition) {
      this.callbacks.onError('Web Speech API is not supported in this browser. Please use Chrome.');
      return;
    }
    if (this.active) return;
    this.active = true;
    this.recognition.start();
  }

  stop(): void {
    if (!this.recognition || !this.active) return;
    this.active = false;
    this.recognition.stop();
  }

  setLanguage(lang: string): void {
    this.lang = lang;
    if (this.recognition) {
      this.recognition.lang = lang;
    }
  }

  get isActive(): boolean {
    return this.active;
  }

  private init(): void {
    const Constructor =
      window.SpeechRecognition ?? window.webkitSpeechRecognition;

    if (!Constructor) {
      return;
    }

    const rec = new Constructor();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = this.lang;
    rec.maxAlternatives = 1;

    rec.onresult = (event: SpeechRecognitionEvent) => {
      let interimTranscript = '';
      let finalTranscript = '';

      for (let i = event.resultIndex; i < event.results.length; i++) {
        const result = event.results[i];
        const text = result[0].transcript;
        if (result.isFinal) {
          finalTranscript += text;
        } else {
          interimTranscript += text;
        }
      }

      if (finalTranscript) this.callbacks.onFinal(finalTranscript);
      if (interimTranscript) this.callbacks.onInterim(interimTranscript);
    };

    rec.onerror = (event: SpeechRecognitionErrorEvent) => {
      this.active = false;
      // 'aborted' fires when stop() is called — not a real error
      if (event.error === 'aborted') return;
      const messages: Record<string, string> = {
        'no-speech': 'No speech detected. Please try again.',
        'audio-capture': 'Microphone not found or inaccessible.',
        'not-allowed': 'Microphone access was denied. Please allow mic access and try again.',
        'network': 'A network error occurred.',
        'service-not-allowed': 'Speech service not allowed.',
      };
      this.callbacks.onError(messages[event.error] ?? `Speech error: ${event.error}`);
    };

    rec.onend = () => {
      this.active = false;
      this.callbacks.onEnd();
    };

    this.recognition = rec;
  }
}
