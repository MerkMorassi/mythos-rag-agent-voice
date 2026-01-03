
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { runMcpTool } from './mcpProxy';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, (process as any).cwd(), '');
  return {
    plugins: [
        react(),
        {
            name: 'mcp-bridge-middleware',
            configureServer(server) {
                server.middlewares.use('/mcp/execute', async (req, res, next) => {
                    if (req.method === 'POST') {
                        let body = '';
                        req.on('data', chunk => body += chunk.toString());
                        req.on('end', async () => {
                            try {
                                const { server: srv, tool, args } = JSON.parse(body);
                                console.log(`[MCP Bridge] Executing ${tool} on ${srv}`);
                                const result = await runMcpTool(srv, { name: tool, arguments: args });
                                res.setHeader('Content-Type', 'application/json');
                                res.end(JSON.stringify({ status: 'SUCCESS', result }));
                            } catch (e: any) {
                                console.error("[MCP Bridge Error]", e.message);
                                res.statusCode = 500;
                                res.setHeader('Content-Type', 'application/json');
                                res.end(JSON.stringify({ status: 'ERROR', error: e.message }));
                            }
                        });
                    } else {
                        next();
                    }
                });
            }
        }
    ],
    server: {
      port: 4000, 
      strictPort: false, 
      host: true, 
      open: true
    },
    preview: {
      port: 7860, 
      strictPort: true,
      host: true, 
      allowedHosts: ['hf.space', 'localhost']
    },
    define: {
      'process.env.API_KEY': JSON.stringify(env.API_KEY),
      'process.env.OPENL_API_KEY': JSON.stringify(env.OPENL_API_KEY),
      'process.env.HF_TOKEN': JSON.stringify(env.HF_TOKEN)
    }
  };
});
