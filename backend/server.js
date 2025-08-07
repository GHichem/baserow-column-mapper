import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';
import multer from 'multer';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// CORS configuration
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [
  'http://localhost:5173',
  'http://localhost:4173',
  'http://localhost:8080'
];

app.use(cors({
  origin: allowedOrigins,
  credentials: true
}));

app.use(express.json({ limit: '50mb' }));
app.use(express.urlencoded({ extended: true, limit: '50mb' }));

// Configure multer for file uploads
const upload = multer({ 
  storage: multer.memoryStorage(),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB limit
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
      // Handle file upload with FormData
      const FormData = (await import('form-data')).default;
      const formData = new FormData();
      formData.append('file', req.file.buffer, {
        filename: req.file.originalname,
        contentType: req.file.mimetype
      });

      // Add form data if present in request body
      if (req.body) {
        Object.keys(req.body).forEach(key => {
          if (req.body[key] !== undefined && req.body[key] !== null) {
            formData.append(key, req.body[key]);
          }
        });
      }

      const headers = {
        'Authorization': `Token ${process.env.BASEROW_API_TOKEN}`,
        ...formData.getHeaders()
      };
      
      // Use axios for better form-data handling
      const axios = (await import('axios')).default;
      
      try {
        const response = await axios.post(baserowUrl, formData, { headers });
        res.status(response.status).json(response.data);
        return;
      } catch (axiosError) {
        if (axiosError.response) {
          res.status(axiosError.response.status).json(axiosError.response.data);
        } else {
          res.status(500).json({ 
            error: 'File upload failed', 
            message: axiosError.message 
          });
        }
        return;
      }
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
    const isTableOperation = baserowPath.includes('/fields/table/') || 
                            baserowPath.includes('/import/') || 
                            (req.method === 'POST' && baserowPath.includes('/tables/database/')) ||
                            (req.method === 'DELETE' && baserowPath.includes('/tables/')) || // Table deletion
                            baserowPath.includes('/fields/') || // Field operations like PATCH /database/fields/47018/
                            baserowPath.includes('/database/fields/'); // All field operations
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
  }
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

// File upload endpoint with proxy
app.post('/api/upload-file', upload.single('file'), async (req, res) => {
  try {
    if (!req.file) {
      return res.status(400).json({ error: 'No file uploaded' });
    }

    // You can add file processing logic here before forwarding to Baserow
    // For now, we'll just return file info
    res.json({
      filename: req.file.originalname,
      size: req.file.size,
      mimetype: req.file.mimetype,
      message: 'File received successfully'
    });
  } catch (error) {
    res.status(500).json({ 
      error: 'File upload error', 
      message: error.message 
    });
  }
});

// Start server
app.listen(PORT, () => {
  // Validate configuration
  if (!process.env.BASEROW_API_TOKEN) {
  }
  if (!process.env.BASEROW_USERNAME || !process.env.BASEROW_PASSWORD) {
  }
});
