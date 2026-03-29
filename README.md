# Speech-to-Text App

This app allows you to record speech and transcribe it to text in real-time, using either Groq's Whisper API or the browser's native Web Speech API.

## Setup Instructions

1. **Clone the repo**
   ```bash
   git clone <your-repo-url>
   cd speech-to-text App
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure API Key**
   Create a `.env` file in the root directory and add your Groq API key:
   ```env
   VITE_GROQ_API_KEY=your_key
   ```
   *You can get a free key at [console.groq.com](https://console.groq.com) (no credit card needed).*

4. **Run development servers**
   You must run both the frontend and the proxy server in two separate terminals:

   *Terminal 1 (Proxy Server):*
   ```bash
   npm run server
   ```

   *Terminal 2 (Frontend App):*
   ```bash
   npm run dev
   ```

## Features

- **Groq API**: Transcribes audio using Groq's high-speed Whisper Large v3 Turbo model.
- **Web Speech API Fallback**: Toggle to switch to browser's native speech recognition.
- **Microphone Support**: Capture audio from your microphone or system output.
- **Language Detection**: Automatically output the detected language when using Groq.
- **Dark Modern UI**: Built with a sleek dark theme.
- **Built with**: Vite, TypeScript, and Vanilla CSS.
