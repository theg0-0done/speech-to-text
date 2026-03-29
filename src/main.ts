// Entry point — wires SpeechEngine, GroqEngine, AssemblyAIEngine and UIController together.

import { SpeechEngine } from './speech';
import { GroqEngine } from './groq';
import { AssemblyAIEngine } from './assemblyai';
import type { SpeakerSegment } from './assemblyai';
import { UIController } from './ui';

console.log('[App] Initializing Speech-to-Text application...');

const ui = new UIController();

let engine: SpeechEngine | GroqEngine | AssemblyAIEngine | null = null;
let isRecording = false;

function createEngine(engineType: string, lang: string): SpeechEngine | GroqEngine | AssemblyAIEngine {
  console.log('[App] Creating engine:', engineType, 'lang:', lang);
  
  const callbacks = {
    onInterim(text: string) {
      ui.hideError();
      ui.appendInterim(text);
    },
    onFinal(text: string) {
      ui.hideError();
      ui.appendFinal(text);
    },
    onError(msg: string) {
      console.error('[App] Engine error:', msg);
      isRecording = false;
      ui.setRecording(false);
      ui.showStatusContainer(false);
      ui.showError(msg);
    },
    onEnd() {
      console.log('[App] Engine ended, isRecording was:', isRecording);
      if (isRecording) {
        isRecording = false;
        ui.setRecording(false);
        ui.showStatusContainer(false);
      }
    },
  };

  if (engineType === 'assemblyai') {
    return new AssemblyAIEngine(lang, callbacks, {
      onSpeakerTurn(segments: SpeakerSegment[], isFinal: boolean) {
        ui.hideError();
        // Clear any previous interim spans since we render the whole chunk here
        if (isFinal) {
          segments.forEach(seg => ui.appendSpeakerFinal(seg.speaker, seg.text));
        } else {
          // For interim showing speakers, we'll just show the latest text or as normal interim
          const fullText = segments.map(s => `Speaker ${s.speaker}: ${s.text}`).join(' | ');
          ui.appendInterim(fullText);
        }
      },
      onSessionStart() {
        ui.hideError();
      },
      onError(msg: string) {
        ui.showToast(msg);
      },
      onStateChange(state, errorMsg) {
        ui.setEngineState(state, errorMsg);
        if (state === 'stopped' || errorMsg) {
          isRecording = false;
        }
      }
    });
  } else if (engineType === 'groq') {
    return new GroqEngine(lang, callbacks, {
      onChunkStart(counter: number) {
        ui.updateChunkCounter(counter);
      },
      onDetectedLanguage(lang: string) {
        ui.showDetectedLanguage(lang);
      },
      onChunkError(msg: string) {
        ui.showToast(msg);
      }
    });
  } else {
    return new SpeechEngine(lang, callbacks);
  }
}

ui.onMicClick(() => {
  if (!isRecording) {
    ui.hideError();
    ui.hideDetectedLanguage();
    if (!engine) {
      engine = createEngine(ui.getCurrentEngine(), ui.getCurrentLanguage());
    }
    isRecording = true;
    ui.setRecording(true);
    
    if (ui.getCurrentEngine() === 'groq') {
      ui.showStatusContainer(true);
      ui.updateChunkCounter(0);
      ui.setChunkCounterVisible(true);
    } else if (ui.getCurrentEngine() === 'assemblyai') {
      ui.showStatusContainer(true);
      ui.setChunkCounterVisible(false); // hide chunk
    }
    engine.start();
  } else {
    isRecording = false;
    ui.setRecording(false);
    if (ui.getCurrentEngine() !== 'assemblyai') {
       ui.showStatusContainer(false);
    }
    engine?.stop();
  }
});

ui.onLanguageChange((lang: string) => {
  if (isRecording) {
    engine?.stop();
    engine = createEngine(ui.getCurrentEngine(), lang);
    engine.start();
  } else {
    engine = createEngine(ui.getCurrentEngine(), lang);
  }
});

ui.onEngineChange((engineType: string) => {
  if (isRecording) {
    engine?.stop();
    engine = createEngine(engineType, ui.getCurrentLanguage());
    engine.start();
    
    if (engineType === 'groq') {
      ui.showStatusContainer(true);
      ui.hideDetectedLanguage();
      ui.updateChunkCounter(0);
      ui.setChunkCounterVisible(true);
    } else if (engineType === 'assemblyai') {
      ui.showStatusContainer(true);
      ui.hideDetectedLanguage();
      ui.setChunkCounterVisible(false);
    } else {
      ui.showStatusContainer(false);
    }
  } else {
    engine = createEngine(engineType, ui.getCurrentLanguage());
  }
});

if (!import.meta.env.VITE_ASSEMBLYAI_API_KEY) {
  ui.disableEngineOption('assemblyai', 'Add VITE_ASSEMBLYAI_API_KEY to .env to use this engine');
}

if (!import.meta.env.VITE_GROQ_API_KEY) {
  ui.disableEngineOption('groq', 'Add VITE_GROQ_API_KEY to .env to use this engine');
}

// Pre-create engine at load so first mic click is instant
engine = createEngine(ui.getCurrentEngine(), ui.getCurrentLanguage());

