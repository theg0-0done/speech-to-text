// Translation module using local proxy -> MyMemory API

export interface TranslateResult {
  translatedText: string;
  error?: string;
}

/**
 * Translate a chunk of text using local proxy
 * @param text - The text to translate
 * @param sourceLang - ISO 639-1 source language (e.g. "en")
 * @param targetLang - ISO 639-1 target language (e.g. "ar")
 */
export async function translateText(
  text: string,
  sourceLang: string,
  targetLang: string,
): Promise<TranslateResult> {
  if (!text.trim()) return { translatedText: '' };

  console.log(`[Translate] langpair: ${sourceLang}|${targetLang}`);

  try {
    const res = await fetch('https://speechtotext-kvnp.onrender.com/api/translate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, sourceLang, targetLang }),
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

    const data = await res.json();
    if (data.error) {
      return { translatedText: '', error: data.error };
    }

    return { translatedText: data.translatedText || '' };
  } catch (err) {
    console.error('[Translate] API failed:', err);
    return {
      translatedText: '',
      error: 'Translation unavailable',
    };
  }
}
