// UIController manages all DOM interactions.

import { translateText } from './translate';

const TRANSLATE_LS_KEY = 'speech-to-text-translate-enabled';
const TRANSLATE_LANG_LS_KEY = 'speech-to-text-translate-target';

export class UIController {
  private engineSelect: HTMLSelectElement;
  private micBtn: HTMLButtonElement;
  private langSelect: HTMLSelectElement;
  private transcript: HTMLDivElement;
  private copyBtn: HTMLButtonElement;
  private clearBtn: HTMLButtonElement;
  private errorMsg: HTMLDivElement;

  // Translation UI elements
  private translateToggle: HTMLInputElement;
  private translateTargetSelect: HTMLSelectElement;
  private translateTargetGroup: HTMLDivElement;
  private translationPanel: HTMLDivElement;
  private translationBox: HTMLDivElement;
  private translationBadge: HTMLSpanElement;
  private translationSpinner: HTMLSpanElement;
  private copyTranslationBtn: HTMLButtonElement;
  private appEl: HTMLDivElement;

  private translateEnabled = false;

  // Single live interim span — replaced on each interim event
  private interimSpan: HTMLSpanElement | null = null;

  // Track pending translations to show/hide spinner
  private pendingTranslations = 0;

  constructor() {
    this.engineSelect = this.getEl<HTMLSelectElement>('engine-select');
    this.micBtn = this.getEl<HTMLButtonElement>('mic-btn');
    this.langSelect = this.getEl<HTMLSelectElement>('lang-select');
    this.transcript = this.getEl<HTMLDivElement>('transcript');
    this.copyBtn = this.getEl<HTMLButtonElement>('copy-btn');
    this.clearBtn = this.getEl<HTMLButtonElement>('clear-btn');
    this.errorMsg = this.getEl<HTMLDivElement>('error-msg');

    // Translation elements
    this.translateToggle = this.getEl<HTMLInputElement>('translate-toggle');
    this.translateTargetSelect = this.getEl<HTMLSelectElement>('translate-target-select');
    this.translateTargetGroup = this.getEl<HTMLDivElement>('translate-target-group');
    this.translationPanel = this.getEl<HTMLDivElement>('translation-panel');
    this.translationBox = this.getEl<HTMLDivElement>('translation-box');
    this.translationBadge = this.getEl<HTMLSpanElement>('translation-lang-badge');
    this.translationSpinner = this.getEl<HTMLSpanElement>('translation-spinner');
    this.copyTranslationBtn = this.getEl<HTMLButtonElement>('copy-translation-btn');
    this.appEl = document.querySelector('.app') as HTMLDivElement;

    this.copyBtn.addEventListener('click', () => this.copyToClipboard());
    this.clearBtn.addEventListener('click', () => this.clear());
    this.copyTranslationBtn.addEventListener('click', () => this.copyTranslationToClipboard());

    // Restore translate settings from localStorage
    const savedTarget = localStorage.getItem(TRANSLATE_LANG_LS_KEY);
    if (savedTarget) {
      this.translateTargetSelect.value = savedTarget;
    }

    const savedState = localStorage.getItem(TRANSLATE_LS_KEY);
    if (savedState === 'true') {
      this.translateToggle.checked = true;
      this.setTranslateEnabled(true);
    }

    this.translateToggle.addEventListener('change', () => {
      this.setTranslateEnabled(this.translateToggle.checked);
      localStorage.setItem(TRANSLATE_LS_KEY, String(this.translateToggle.checked));
    });

    this.translateTargetSelect.addEventListener('change', () => {
      this.enforceLanguageDifference(true);
      localStorage.setItem(TRANSLATE_LANG_LS_KEY, this.translateTargetSelect.value);
      this.updateTranslationBadge();
    });

    // Update badge on language change
    this.langSelect.addEventListener('change', () => {
      this.enforceLanguageDifference(true);
      this.updateTranslationBadge();
    });

    this.enforceLanguageDifference(false);
    this.updateTranslationBadge();
  }

  private enforceLanguageDifference(showWarning: boolean): void {
    const sourceVal = this.langSelect.value.split('-')[0];
    const targetVal = this.translateTargetSelect.value;
    
    if (sourceVal === targetVal) {
      // automatically change the Translate to dropdown to a different language
      const newTarget = sourceVal === 'en' ? 'ar' : 'en';
      this.translateTargetSelect.value = newTarget;
      localStorage.setItem(TRANSLATE_LANG_LS_KEY, newTarget);
      if (showWarning) {
        this.showToast('Source and target language must be different', true);
      }
    }
  }

  // ---- Translate Toggle ----

  private setTranslateEnabled(enabled: boolean): void {
    this.translateEnabled = enabled;
    if (enabled) {
      this.translationPanel.classList.remove('hidden');
      this.translateTargetGroup.classList.remove('hidden');
      this.appEl.classList.add('translate-on');
    } else {
      this.translationPanel.classList.add('hidden');
      this.translateTargetGroup.classList.add('hidden');
      this.appEl.classList.remove('translate-on');
    }
    this.updateTranslationBadge();
  }

  get isTranslateEnabled(): boolean {
    return this.translateEnabled;
  }

  private updateTranslationBadge(): void {
    const selectedOption = this.translateTargetSelect.options[this.translateTargetSelect.selectedIndex];
    this.translationBadge.textContent = selectedOption.text.toUpperCase();
  }

  // ---- Mic Button ----

  setRecording(active: boolean): void {
    const textEl = document.getElementById('recording-text');
    const dotEl = document.getElementById('recording-dot');

    if (active) {
      this.micBtn.classList.add('recording');
      this.micBtn.setAttribute('aria-pressed', 'true');
      this.micBtn.setAttribute('aria-label', 'Stop recording');
      this.micBtn.classList.remove('loading');
      this.micBtn.disabled = false;
      if (dotEl) dotEl.classList.remove('hidden');
      if (textEl) {
        textEl.textContent = 'Recording...';
        textEl.style.color = '';
      }
    } else {
      this.micBtn.classList.remove('recording');
      this.micBtn.setAttribute('aria-pressed', 'false');
      this.micBtn.setAttribute('aria-label', 'Start recording');
      this.micBtn.classList.remove('loading');
      this.micBtn.disabled = false;
      if (dotEl) dotEl.classList.add('hidden');
    }
  }

  setEngineState(state: 'requesting_mic' | 'connecting' | 'ready' | 'recording' | 'stopped', errorMsg?: string): void {
    const textEl = this.getEl('recording-text');
    const dotEl = this.getEl('recording-dot');

    if (errorMsg) {
      this.micBtn.classList.remove('loading', 'recording');
      this.micBtn.disabled = false;
      this.micBtn.setAttribute('aria-pressed', 'false');
      textEl.textContent = errorMsg;
      textEl.style.color = 'var(--error)';
      dotEl.classList.add('hidden');
      return;
    }

    textEl.style.color = '';

    switch (state) {
      case 'requesting_mic':
        this.micBtn.classList.add('loading');
        this.micBtn.classList.remove('recording');
        this.micBtn.disabled = true;
        textEl.textContent = 'Requesting microphone...';
        dotEl.classList.add('hidden');
        break;
      case 'connecting':
        this.micBtn.classList.add('loading');
        this.micBtn.classList.remove('recording');
        this.micBtn.disabled = true;
        textEl.textContent = 'Connecting...';
        dotEl.classList.add('hidden');
        break;
      case 'ready':
        this.micBtn.classList.add('loading');
        this.micBtn.classList.remove('recording');
        this.micBtn.disabled = true;
        textEl.textContent = 'Ready...';
        dotEl.classList.add('hidden');
        break;
      case 'recording':
        this.setRecording(true);
        textEl.textContent = 'Recording';
        break;
      case 'stopped':
        this.setRecording(false);
        textEl.textContent = 'Stopped';
        setTimeout(() => {
          if (textEl.textContent === 'Stopped') {
             textEl.textContent = 'Recording...';
             this.showStatusContainer(false);
          }
        }, 1500);
        break;
    }
  }

  onMicClick(cb: () => void): void {
    this.micBtn.addEventListener('click', cb);
  }

  // ---- Transcript ----

  appendInterim(text: string): void {
    this.interimSpan?.remove();
    this.interimSpan = document.createElement('span');
    this.interimSpan.className = 'interim';
    this.interimSpan.textContent = text;
    this.transcript.appendChild(this.interimSpan);
    this.scrollToBottom();
  }

  appendFinal(text: string): void {
    this.interimSpan?.remove();
    this.interimSpan = null;

    const span = document.createElement('span');
    span.className = 'final';
    span.textContent = text + ' ';
    this.transcript.appendChild(span);
    this.scrollToBottom();

    // Trigger translation if enabled
    if (this.translateEnabled) {
      this.translateChunk(text);
    }
  }

  appendSpeakerFinal(speaker: string, text: string): void {
    this.interimSpan?.remove();
    this.interimSpan = null;

    const div = document.createElement('div');
    div.className = 'speaker-line speaker-' + speaker;
    
    const nameSpan = document.createElement('strong');
    nameSpan.className = 'speaker-name';
    nameSpan.textContent = 'Speaker ' + speaker + ': ';
    
    const textSpan = document.createElement('span');
    textSpan.className = 'speaker-text final';
    textSpan.textContent = text;

    div.appendChild(nameSpan);
    div.appendChild(textSpan);
    this.transcript.appendChild(div);
    this.scrollToBottom();

    // Trigger translation if enabled (preserve speaker format)
    if (this.translateEnabled) {
      this.translateChunk(text, speaker);
    }
  }

  // ---- Translation ----

  private async translateChunk(text: string, speaker?: string): Promise<void> {
    const sourceLang = this.langSelect.value.split('-')[0];
    const targetLang = this.translateTargetSelect.value;

    this.pendingTranslations++;
    this.translationSpinner.classList.remove('hidden');

    try {
      const result = await translateText(text, sourceLang, targetLang);

      if (result.error) {
        this.showToast(result.error, true);
        return;
      }

      if (result.translatedText) {
        if (speaker) {
          // Preserve speaker format in translation
          const div = document.createElement('div');
          div.className = 'speaker-line speaker-' + speaker;

          const nameSpan = document.createElement('strong');
          nameSpan.className = 'speaker-name';
          nameSpan.textContent = 'Speaker ' + speaker + ': ';

          const textSpan = document.createElement('span');
          textSpan.className = 'speaker-text final';
          textSpan.textContent = result.translatedText;

          div.appendChild(nameSpan);
          div.appendChild(textSpan);
          this.translationBox.appendChild(div);
        } else {
          const span = document.createElement('span');
          span.className = 'final';
          span.textContent = result.translatedText + ' ';
          this.translationBox.appendChild(span);
        }

        this.scrollTranslationToBottom();
      }
    } catch {
      this.showToast('Translation unavailable', true);
    } finally {
      this.pendingTranslations--;
      if (this.pendingTranslations <= 0) {
        this.pendingTranslations = 0;
        this.translationSpinner.classList.add('hidden');
      }
    }
  }

  private scrollTranslationToBottom(): void {
    this.translationBox.scrollTop = this.translationBox.scrollHeight;
  }

  private copyTranslationToClipboard(): void {
    const text = this.translationBox.textContent?.trim() ?? '';
    if (!text) return;

    navigator.clipboard.writeText(text).then(() => {
      const btnText = this.copyTranslationBtn.querySelector('span');
      if (btnText) {
        const original = btnText.textContent;
        btnText.textContent = 'Copied!';
        setTimeout(() => {
          btnText.textContent = original;
        }, 1500);
      }
    }).catch(() => {
      this.showError('Could not copy to clipboard.');
      setTimeout(() => this.hideError(), 2000);
    });
  }

  // ---- Error ----

  showError(msg: string): void {
    this.errorMsg.textContent = msg;
    this.errorMsg.classList.remove('hidden');
  }

  hideError(): void {
    this.errorMsg.textContent = '';
    this.errorMsg.classList.add('hidden');
  }

  // ---- Copy / Clear ----

  copyToClipboard(): void {
    const text = this.transcript.textContent?.trim() ?? '';
    if (!text) return;

    navigator.clipboard.writeText(text).then(() => {
      const original = this.copyBtn.textContent;
      this.copyBtn.textContent = 'Copied!';
      setTimeout(() => {
        this.copyBtn.textContent = original;
      }, 1500);
    }).catch(() => {
      this.showError('Could not copy to clipboard.');
      setTimeout(() => this.hideError(), 2000);
    });
  }

  clear(): void {
    this.transcript.innerHTML = '';
    this.translationBox.innerHTML = '';
    this.interimSpan = null;
    this.hideError();
  }

  // ---- Language ----

  onLanguageChange(cb: (lang: string) => void): void {
    this.langSelect.addEventListener('change', () => {
      cb(this.langSelect.value);
    });
  }

  getCurrentLanguage(): string {
    return this.langSelect.value;
  }

  // ---- Engine ----

  onEngineChange(cb: (engine: string) => void): void {
    this.engineSelect.addEventListener('change', () => {
      cb(this.engineSelect.value);
    });
  }

  getCurrentEngine(): string {
    return this.engineSelect.value;
  }

  // ---- Status & Toasts ----

  showStatusContainer(show: boolean): void {
    const el = this.getEl('status-container');
    if (show) el.classList.remove('hidden');
    else el.classList.add('hidden');
  }

  updateChunkCounter(counter: number): void {
    this.getEl('chunk-counter').textContent = counter.toString();
  }

  showDetectedLanguage(lang: string): void {
    this.getEl('detected-lang-container').classList.remove('hidden');
    this.getEl('detected-lang-value').textContent = lang;
  }

  hideDetectedLanguage(): void {
    this.getEl('detected-lang-container').classList.add('hidden');
    this.getEl('detected-lang-value').textContent = '...';
  }

  showToast(msg: string, isError = false): void {
    const container = this.getEl('toast-container');
    const toast = document.createElement('div');
    toast.className = 'toast' + (isError ? ' toast-error' : '');
    toast.textContent = msg;
    container.appendChild(toast);
    setTimeout(() => {
      toast.classList.add('fade-out');
      setTimeout(() => toast.remove(), 300);
    }, 4000);
  }

  // ---- Private Helpers ----

  private scrollToBottom(): void {
    this.transcript.scrollTop = this.transcript.scrollHeight;
  }

  private getEl<T extends HTMLElement>(id: string): T {
    const el = document.getElementById(id);
    if (!el) throw new Error(`Element #${id} not found in DOM`);
    return el as T;
  }

  public setChunkCounterVisible(visible: boolean) {
    const el = this.getEl('chunk-counter').parentElement;
    if (el) {
      el.style.display = visible ? 'inline' : 'none';
    }
  }

  public disableEngineOption(engineType: string, reason: string) {
    const select = this.engineSelect as HTMLSelectElement;
    for (let i = 0; i < select.options.length; i++) {
      if (select.options[i].value === engineType) {
        select.options[i].disabled = true;
        select.options[i].title = reason;
        console.log(`[UI] Disabled engine option '${engineType}': ${reason}`);
        
        // If it was selected, change selection to Web Speech API
        if (select.value === engineType) {
          select.value = 'web';
          console.log('[UI] Switched selected engine to web');
        }
        break;
      }
    }
  }
}
