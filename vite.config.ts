import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  // Load env file based on `mode` in the current working directory.
  // Set the third parameter to '' to load all envs regardless of the `VITE_` prefix.
  const env = loadEnv(mode, process.cwd(), '');

  return {
    plugins: [
      {
        name: 'assemblyai-token-proxy',
        configureServer(server) {
          server.middlewares.use(async (req: any, res: any, next: any) => {
            const reqUrl = req.url || '';
            const pathName = reqUrl.split('?')[0];
            
            if (pathName === '/api/assemblyai-token' && req.method === 'POST') {
              console.log('[AssemblyAITokenProxy] Handling token request...');
              
              // Try to find the API key in all possible places
              const apiKey = env.ASSEMBLYAI_API_KEY || 
                             env.VITE_ASSEMBLYAI_API_KEY || 
                             process.env.ASSEMBLYAI_API_KEY ||
                             process.env.VITE_ASSEMBLYAI_API_KEY;

              if (!apiKey) {
                console.error('[AssemblyAITokenProxy] Error: No API key found in .env or process.env');
                console.error('[AssemblyAITokenProxy] Available ASSEMBLYAI env keys:', Object.keys(env).filter(k => k.includes('ASSEMBLYAI')));
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ 
                  error: 'ASSEMBLYAI_API_KEY is not defined. Add it to your .env file.',
                }));
                return;
              }

              console.log('[AssemblyAITokenProxy] API key found:', apiKey.substring(0, 6) + '...');

              try {
                // V3 token endpoint: GET https://streaming.assemblyai.com/v3/token
                const tokenUrl = `https://streaming.assemblyai.com/v3/token?expires_in_seconds=480`;

                console.log(`[AssemblyAITokenProxy] Fetching token from: ${tokenUrl}`);

                const response = await fetch(tokenUrl, {
                  method: 'GET',
                  headers: {
                    'Authorization': apiKey,
                  },
                });

                const responseText = await response.text();

                if (!response.ok) {
                  console.error(`[AssemblyAITokenProxy] AssemblyAI API error: ${response.status} ${response.statusText}`);
                  console.error(`[AssemblyAITokenProxy] Response body:`, responseText);
                  res.statusCode = response.status;
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ 
                    error: `AssemblyAI API error: ${response.status} ${response.statusText}`, 
                    details: responseText,
                  }));
                  return;
                }

                // Parse the response
                let data;
                try {
                  data = JSON.parse(responseText);
                } catch (parseErr) {
                  console.error('[AssemblyAITokenProxy] Failed to parse response as JSON:', responseText);
                  res.statusCode = 502;
                  res.setHeader('Content-Type', 'application/json');
                  res.end(JSON.stringify({ error: 'Invalid JSON from AssemblyAI', details: responseText }));
                  return;
                }

                console.log('[AssemblyAITokenProxy] Token generated successfully, keys:', Object.keys(data));
                res.statusCode = 200;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify(data));
              } catch (error: any) {
                console.error('[AssemblyAITokenProxy] Unexpected error:', error);
                res.statusCode = 500;
                res.setHeader('Content-Type', 'application/json');
                res.end(JSON.stringify({ 
                  error: 'Internal Server Error during token generation', 
                  message: error.message 
                }));
              }
              return;
            }
            next();
          });
        },
      },
    ],
  };
});
