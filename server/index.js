import dotenv from 'dotenv';
import express from 'express';
import { createProxyMiddleware } from 'http-proxy-middleware';
import cors from 'cors';

dotenv.config();

const app = express();
app.use(cors());
app.use(express.json());

const TARGET = process.env.BASEROW_TARGET || 'https://baserow.app-inventor.org';
const TOKEN = process.env.BASEROW_API_TOKEN || '';

// Proxy all /api/baserow/* requests to the Baserow target
app.use('/api/baserow', createProxyMiddleware({
  target: TARGET,
  changeOrigin: true,
  pathRewrite: {
    '^/api/baserow': ''
  },
  onProxyReq: (proxyReq, req, res) => {
    // Inject server-side token if provided
    if (TOKEN) {
      proxyReq.setHeader('Authorization', `Token ${TOKEN}`);
    }
  }
}));

// Health
app.get('/health', (req, res) => res.json({ status: 'ok' }));

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Proxy server listening on http://localhost:${PORT} -> ${TARGET}`));
