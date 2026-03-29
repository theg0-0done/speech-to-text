import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app = express();
const PORT = 3001;

app.use(cors({
  origin: 'http://localhost:5173'
}));

app.use(express.json());

// MyMemory Translation proxy endpoint
app.post('/api/translate', async (req, res) => {
  try {
    const { text, sourceLang, targetLang } = req.body;
    if (!text) return res.json({ translatedText: '' });
    
    // MyMemory API doesn't require an API key
    const url = `https://api.mymemory.translated.net/get?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent(sourceLang)}|${encodeURIComponent(targetLang)}`;
    
    const response = await fetch(url);
    const data = await response.json();
    
    if (data.responseData && data.responseData.translatedText) {
      res.json({ translatedText: data.responseData.translatedText });
    } else {
      res.status(500).json({ error: 'Translation API failed', details: data });
    }
  } catch (error: any) {
    console.error('[Server] Error in translation:', error?.message || error);
    res.status(500).json({ error: 'Internal Server Error', message: error?.message });
  }
});

// AssemblyAI V3 streaming token endpoint
app.post('/api/assemblyai-token', async (_req, res) => {
  try {
    const apiKey = process.env.ASSEMBLYAI_API_KEY || process.env.VITE_ASSEMBLYAI_API_KEY || '';
    
    if (!apiKey) {
      console.error('[Server] No ASSEMBLYAI_API_KEY found in environment');
      return res.status(500).json({ error: 'ASSEMBLYAI_API_KEY is not configured' });
    }

    console.log('[Server] Using API key:', `${apiKey.substring(0, 6)}...`);

    // V3 token endpoint: GET https://streaming.assemblyai.com/v3/token
    const tokenUrl = 'https://streaming.assemblyai.com/v3/token?expires_in_seconds=480';
    console.log('[Server] Fetching token from:', tokenUrl);

    const response = await fetch(tokenUrl, {
      method: 'GET',
      headers: {
        'Authorization': apiKey,
      },
    });

    const responseText = await response.text();

    if (!response.ok) {
      console.error(`[Server] AssemblyAI API error: ${response.status} ${response.statusText}`);
      console.error('[Server] Response body:', responseText);
      return res.status(response.status).json({ 
        error: `AssemblyAI API error: ${response.status}`,
        details: responseText,
      });
    }

    let data;
    try {
      data = JSON.parse(responseText);
    } catch (parseErr) {
      console.error('[Server] Failed to parse AssemblyAI response:', responseText);
      return res.status(502).json({ error: 'Invalid JSON from AssemblyAI' });
    }

    console.log('[Server] Token generated successfully');
    res.json(data);
  } catch (error: any) {
    console.error('[Server] Error fetching AssemblyAI token:', error?.message || error);
    res.status(500).json({ error: 'Internal Server Error', message: error?.message });
  }
});

app.listen(PORT, () => {
  console.log(`Proxy server running on http://localhost:${PORT}`);
});
