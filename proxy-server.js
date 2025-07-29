import express from 'express';
import cors from 'cors';
import fetch from 'node-fetch';
import { URL } from 'url';

const app = express();
const PORT = process.env.PORT || 3001;

// Enable CORS for your frontend
app.use(cors({
  origin: ['http://localhost:8080', 'http://localhost:5173', 'http://localhost:3000'],
  credentials: true
}));

// Parse JSON bodies
app.use(express.json());

// Whitelist of allowed domains for security
const ALLOWED_DOMAINS = [
  'baserow.app-inventor.org',
  'api.baserow.io',
  // Add other trusted Baserow domains here
];

/**
 * Proxy endpoint for fetching Baserow files
 * GET /api/proxy-baserow-file?url=<baserow_file_url>&token=<optional_auth_token>
 */
app.get('/api/proxy-baserow-file', async (req, res) => {
  try {
    const { url: fileUrl, token } = req.query;

    // Validate required parameters
    if (!fileUrl) {
      return res.status(400).json({ 
        error: 'Missing required parameter: url' 
      });
    }

    // Parse and validate the URL
    let parsedUrl;
    try {
      parsedUrl = new URL(fileUrl);
    } catch (error) {
      return res.status(400).json({ 
        error: 'Invalid URL format' 
      });
    }

    // Security check: Only allow whitelisted domains
    if (!ALLOWED_DOMAINS.includes(parsedUrl.hostname)) {
      console.warn(`🚨 Blocked request to unauthorized domain: ${parsedUrl.hostname}`);
      return res.status(403).json({ 
        error: `Domain not allowed: ${parsedUrl.hostname}` 
      });
    }

    // Validate that it's a file URL (contains /media/ or similar patterns)
    if (!parsedUrl.pathname.includes('/media/') && !parsedUrl.pathname.includes('/user_files/')) {
      console.warn(`🚨 Blocked non-file URL: ${parsedUrl.pathname}`);
      return res.status(403).json({ 
        error: 'URL does not appear to be a file download URL' 
      });
    }

    console.log(`🔄 Proxying file request: ${fileUrl}`);

    // Prepare headers for the upstream request
    const headers = {
      'User-Agent': 'Baserow-File-Proxy/1.0',
    };

    // Add authorization if token is provided
    if (token) {
      headers['Authorization'] = `Token ${token}`;
    }

    // Fetch the file from Baserow
    const response = await fetch(fileUrl, {
      method: 'GET',
      headers: headers,
      timeout: 300000, // 5 minute timeout
    });

    if (!response.ok) {
      console.error(`❌ Upstream request failed: ${response.status} ${response.statusText}`);
      return res.status(response.status).json({
        error: `Failed to fetch file: ${response.status} ${response.statusText}`,
        upstream_status: response.status
      });
    }

    // Get content type and size
    const contentType = response.headers.get('content-type') || 'application/octet-stream';
    const contentLength = response.headers.get('content-length');
    
    console.log(`✅ File fetched successfully: ${contentType}, ${contentLength ? `${(contentLength / 1024 / 1024).toFixed(2)}MB` : 'unknown size'}`);

    // Set appropriate response headers
    res.setHeader('Content-Type', contentType);
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
    
    if (contentLength) {
      res.setHeader('Content-Length', contentLength);
    }

    // Handle CSV files specifically
    if (contentType.includes('text/csv') || fileUrl.endsWith('.csv')) {
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', 'inline');
    }

    // Stream the response body directly to the client
    response.body.pipe(res);

  } catch (error) {
    console.error('❌ Proxy error:', error);
    
    // Handle specific error types
    if (error.code === 'ENOTFOUND') {
      return res.status(404).json({
        error: 'File server not found',
        details: error.message
      });
    } else if (error.code === 'ETIMEDOUT') {
      return res.status(408).json({
        error: 'Request timeout',
        details: 'File download took too long'
      });
    } else {
      return res.status(500).json({
        error: 'Internal proxy error',
        details: error.message
      });
    }
  }
});

// Health check endpoint
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'ok', 
    timestamp: new Date().toISOString(),
    service: 'baserow-file-proxy'
  });
});

// Error handling middleware
app.use((error, req, res, next) => {
  console.error('❌ Server error:', error);
  res.status(500).json({
    error: 'Internal server error',
    details: error.message
  });
});

// Start the server
app.listen(PORT, () => {
  console.log(`🚀 Baserow File Proxy Server running on port ${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/api/health`);
  console.log(`🔗 Proxy endpoint: http://localhost:${PORT}/api/proxy-baserow-file`);
  console.log(`✅ CORS enabled for local development`);
});

export default app;
