import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { fileURLToPath } from 'url';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;
const MAX_UPLOAD_MB = parseInt(process.env.MAX_UPLOAD_MB || '500', 10); // configurable, default 500MB
const SERVE_FRONTEND = process.env.SERVE_FRONTEND === 'true';

// CORS configuration
// Allow specified origins from env; otherwise accept common localhost and LAN dev ports
const defaultOrigins = [
  'http://localhost:5173', 'http://127.0.0.1:5173',
  'http://localhost:4173', 'http://127.0.0.1:4173',
  'http://localhost:8080', 'http://127.0.0.1:8080'
];
const envOrigins = process.env.ALLOWED_ORIGINS?.split(',').map(s => s.trim()).filter(Boolean) || [];
const allowedOrigins = envOrigins.length ? envOrigins : defaultOrigins;

// Use a function to allow same-network hosts on common dev ports
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) return callback(null, true);
    if (allowedOrigins.includes(origin)) return callback(null, true);
    try {
      const url = new URL(origin);
      const isHttp = url.protocol === 'http:' || url.protocol === 'https:';
      const allowedPorts = new Set(['8080', '5173', '4173', '3050', '3051']);
      if (isHttp && allowedPorts.has(url.port || '80')) {
        return callback(null, true);
      }
    } catch (e) {}
    return callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

// Keep JSON/urlencoded limits modest; large CSV files go through multipart uploads, not JSON
app.use(express.json({ limit: process.env.MAX_JSON_BODY || '10mb' }));
app.use(express.urlencoded({ extended: true, limit: process.env.MAX_JSON_BODY || '10mb' }));

// Configure multer for large file uploads using disk storage (safer than memory for 500MB)
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const tempUploadDir = process.env.UPLOAD_TMP_DIR || path.join(os.tmpdir(), 'column-mapper-uploads');
if (!fs.existsSync(tempUploadDir)) {
  fs.mkdirSync(tempUploadDir, { recursive: true });
}
const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, tempUploadDir),
  filename: (req, file, cb) => {
    const unique = Date.now() + '-' + Math.round(Math.random() * 1e9);
    cb(null, unique + '-' + file.originalname);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: MAX_UPLOAD_MB * 1024 * 1024 }
});

// Store JWT token in memory (will be refreshed as needed)
let jwtToken = process.env.BASEROW_JWT_TOKEN || '';
let jwtExpiry = 0;

// Helper function to get fresh JWT token
async function getFreshJwtToken() {
  try {
    // Try the correct JWT endpoint first
    let response = await fetch('https://baserow.app-inventor.org/api/user/token-auth/', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: process.env.BASEROW_USERNAME,
        password: process.env.BASEROW_PASSWORD
      })
    });

    if (!response.ok) {
      // Try alternative endpoint
      response = await fetch('https://baserow.app-inventor.org/api/auth/token/', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          username: process.env.BASEROW_USERNAME,
          password: process.env.BASEROW_PASSWORD
        })
      });
    }

    if (!response.ok) {
      throw new Error(`JWT auth failed: ${response.status}`);
    }

    const data = await response.json();
    jwtToken = data.access_token || data.token;
    jwtExpiry = Date.now() + (55 * 60 * 1000); // Refresh 5 minutes before expiry
    return jwtToken;
  } catch (error) {
    throw error;
  }
}

// Helper function to get valid JWT token
async function getValidJwtToken() {
  if (!jwtToken || Date.now() > jwtExpiry) {
    await getFreshJwtToken();
  }
  return jwtToken;
}

// Proxy all Baserow API calls
app.all('/api/baserow/*', upload.single('file'), async (req, res) => {
  try {
    const baserowPath = req.path.replace('/api/baserow', '');
    const baserowUrl = `https://baserow.app-inventor.org/api${baserowPath}`;
    // Check if this is a file upload
    const isFileUpload = req.file || req.path.includes('/user-files/upload-file');
    
    if (isFileUpload && req.file) {
      // Stream file from disk via FormData
      const FormData = (await import('form-data')).default;
      const formData = new FormData();
      formData.append('file', fs.createReadStream(req.file.path), {
        filename: req.file.originalname,
        contentType: req.file.mimetype
      });
      if (req.body) {
        Object.keys(req.body).forEach(key => {
          if (req.body[key] !== undefined && req.body[key] !== null) {
            formData.append(key, req.body[key]);
          }
        });
      }
      const headers = { 'Authorization': `Token ${process.env.BASEROW_API_TOKEN}`, ...formData.getHeaders() };
      const axios = (await import('axios')).default;
      try {
        const upstream = await axios.post(baserowUrl, formData, { headers, maxContentLength: Infinity, maxBodyLength: Infinity });
        res.status(upstream.status).json(upstream.data);
      } catch (err) {
        if (err.response) {
          res.status(err.response.status).json(err.response.data);
        } else {
          res.status(500).json({ error: 'File upload failed', message: err.message });
        }
      } finally {
        if (req.file?.path) fs.unlink(req.file.path, () => {});
      }
      return;
    }

    // Regular API request handling
    let headers = {
      'accept': req.headers.accept || '*/*',
      'user-agent': req.headers['user-agent'] || 'Proxy-Server'
    };

    // Keep only safe headers
    const safeHeaders = ['accept', 'user-agent'];
    const cleanedHeaders = Object.keys(req.headers).filter(h => safeHeaders.includes(h.toLowerCase()));

    // Authentication logic
    // Treat any table/field management endpoints as JWT-protected operations.
    // This includes GET/POST/DELETE on /database/tables/... and all /fields/... endpoints.
    const isTableOperation =
      baserowPath.includes('/fields/table/') ||
      baserowPath.includes('/import/') ||
      baserowPath.includes('/database/fields/') ||
      baserowPath.includes('/fields/') ||
      baserowPath.includes('/database/tables/') ||
      baserowPath.includes('/tables/');
    const isRowOperation = req.method === 'POST' && baserowPath.includes('/rows/');

    if (isTableOperation) {
      const jwt = await getValidJwtToken();
      headers['Authorization'] = `JWT ${jwt}`;
    } else {
      headers['Authorization'] = `Token ${process.env.BASEROW_API_TOKEN}`;
    }

    // Build final headers
    cleanedHeaders.forEach(headerName => {
      headers[headerName] = req.headers[headerName];
    });

    const fetchOptions = {
      method: req.method,
      headers: headers
    };

    // Add body for non-GET requests
    if (req.method !== 'GET' && req.body && Object.keys(req.body).length > 0) {
      headers['Content-Type'] = 'application/json';
      fetchOptions.body = JSON.stringify(req.body);
      
      if (isRowOperation && baserowPath.includes('/rows/table/')) {
      }
    }
    
    let response = await fetch(baserowUrl, fetchOptions);
    
    // If we get 401 on a table operation, refresh token and retry once
    if (!response.ok && response.status === 401 && isTableOperation) {
      try {
        // Force refresh the JWT token
        jwtToken = '';
        jwtExpiry = 0;
        const freshJwt = await getValidJwtToken();
        
        // Update headers with fresh token
        fetchOptions.headers['Authorization'] = `JWT ${freshJwt}`;
        
        // Retry the request
        response = await fetch(baserowUrl, fetchOptions);
        
        if (response.ok) {
        } else {
        }
      } catch (retryError) {
      }
    }
    
    const data = await response.text();
    
    if (isRowOperation && baserowPath.includes('/rows/table/')) {
      if (!response.ok) {
      } else {
      }
    }
    
    // Forward status and headers
    res.status(response.status);
    
    // Forward relevant headers
    ['content-type', 'content-length'].forEach(header => {
      if (response.headers.get(header)) {
        res.set(header, response.headers.get(header));
      }
    });

    res.send(data);
  } catch (error) {
    res.status(500).json({ 
      error: 'Proxy server error', 
      message: error.message 
    });
  } finally {
    // Cleanup any temp file if present and not already removed
    if (req.file?.path && fs.existsSync(req.file.path)) {
      fs.unlink(req.file.path, () => {});
    }
  }
});

// Configuration endpoint used by the frontend to get static IDs
app.get('/api/config', (req, res) => {
  res.json({
    tableId: process.env.BASEROW_SOURCE_TABLE_ID || '787',
    targetTableId: process.env.BASEROW_TARGET_TABLE_ID || '790',
    databaseId: process.env.BASEROW_DATABASE_ID || '207'
  });
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    hasApiToken: !!process.env.BASEROW_API_TOKEN,
    hasCredentials: !!(process.env.BASEROW_USERNAME && process.env.BASEROW_PASSWORD)
  });
});

// Alias health endpoint expected by remote deploy environment
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    path: '/api/health',
    hasApiToken: !!process.env.BASEROW_API_TOKEN,
    hasCredentials: !!(process.env.BASEROW_USERNAME && process.env.BASEROW_PASSWORD)
  });
});

// File upload endpoint with proxy
app.post('/api/upload-file', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) return res.status(400).json({ error: 'No file uploaded' });
    res.json({
      filename: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype,
      maxUploadMB: MAX_UPLOAD_MB,
      message: 'File received successfully'
    });
  } catch (error) {
    res.status(500).json({ error: 'File upload error', message: error.message });
  } finally {
    if (req.file?.path) fs.unlink(req.file.path, () => {});
  }
});

// Optionally serve built frontend (enable with SERVE_FRONTEND=true)
if (SERVE_FRONTEND) {
  const frontendDist = process.env.FRONTEND_DIST_PATH || path.resolve(__dirname, '../dist');
  if (fs.existsSync(frontendDist)) {
    app.use(express.static(frontendDist));
    // SPA fallback (ignore API routes)
    app.get(/^(?!\/api\/).+/, (req, res, next) => {
      const indexFile = path.join(frontendDist, 'index.html');
      if (fs.existsSync(indexFile)) {
        res.sendFile(indexFile);
      } else {
        next();
      }
    });
  }
}

// Start server
app.listen(PORT, '0.0.0.0', () => {
  const masked = (v) => v ? '***set***' : 'MISSING';
  console.log(`[startup] Column Mapper backend listening on :${PORT}`);
  console.log(`[startup] Upload tmp dir: ${tempUploadDir} (max ${MAX_UPLOAD_MB}MB per file)`);
  console.log(`[startup] Frontend serving: ${SERVE_FRONTEND ? 'ENABLED' : 'disabled'} `);
  console.log(`[startup] Baserow API token: ${masked(process.env.BASEROW_API_TOKEN)}`);
  console.log(`[startup] Credentials: user=${process.env.BASEROW_USERNAME ? 'set' : 'missing'} pass=${process.env.BASEROW_PASSWORD ? 'set' : 'missing'}`);
});
