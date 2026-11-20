import { defineConfig } from 'vite';

import { phoneAddress } from './scripts/phone-network.mjs';

export default defineConfig({
  define: { __PHONE_DEV_ORIGIN__: JSON.stringify('https://' + (phoneAddress() ?? 'localhost') + ':5174') },
  server: {
    proxy: {
      '/local-api': {
        target: 'http://127.0.0.1:8787',
        changeOrigin: true,
        rewrite: path => path.replace(/^\/local-api/, ''),
        configure(proxy) {
          proxy.on('error', (_error, _request, response) => {
            if (!response.writeHead || response.headersSent || response.writableEnded) return;
            response.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
            response.end(JSON.stringify({ error: 'local_api_unavailable', message: 'ローカルAPIへ接続できません。tarumi-api の npm run dev を確認してください。' }));
          });
        },
      },
    },
  },
});
