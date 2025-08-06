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
      console.log(`🔐 Primary JWT endpoint failed: ${response.status}, trying alternative...`);
      
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
    
    console.log('🔑 JWT token refreshed successfully');
    return jwtToken;
  } catch (error) {
    console.error('❌ Failed to get JWT token:', error);
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
    console.log('🚨 ROUTE HIT! This log should always appear when /api/baserow/* is accessed');
    console.log('🔍 Request method:', req.method);
    console.log('🔍 Request headers:', req.headers);
    
    const baserowPath = req.path.replace('/api/baserow', '');
    const baserowUrl = `https://baserow.app-inventor.org/api${baserowPath}`;
    
    console.log(`🔍 INCOMING REQUEST: ${req.method} ${req.path}`);
    console.log(`🔍 Full URL: ${req.url}`);
    console.log(`🔍 Original URL: ${req.originalUrl}`);
    console.log(`🔍 Baserow path: ${baserowPath}`);
    console.log(`🔍 Baserow URL: ${baserowUrl}`);

    // Check if this is a file upload
    const isFileUpload = req.file || req.path.includes('/user-files/upload-file');
    
    if (isFileUpload && req.file) {
      console.log('📁 File upload detected:', {
        filename: req.file.originalname,
        size: req.file.size,
        mimetype: req.file.mimetype
      });
      
      // Handle file upload with FormData
      const FormData = (await import('form-data')).default;
      const formData = new FormData();
      formData.append('file', req.file.buffer, {
        filename: req.file.originalname,
        contentType: req.file.mimetype
      });

      const headers = {
        'Authorization': `Token ${process.env.BASEROW_API_TOKEN}`,
        ...formData.getHeaders()
      };

      console.log('📤 Sending to Baserow with form data...');
      
      // Use axios for better form-data handling
      const axios = (await import('axios')).default;
      
      try {
        const response = await axios.post(baserowUrl, formData, { headers });
        
        console.log('✅ Baserow response status:', response.status);
        console.log('📦 Baserow response data:', response.data);
        console.log('📊 Response data type:', typeof response.data);
        
        // Ensure we return the response in the same format as Baserow
        try {
          res.status(response.status).json(response.data);
          console.log('📤 Response sent successfully to frontend');
        } catch (sendError) {
          console.error('❌ Error sending response to frontend:', sendError);
          res.status(500).json({ 
            error: 'Response sending failed', 
            message: sendError.message 
          });
        }
        return;
      } catch (axiosError) {
        console.error('❌ Axios error during file upload:', axiosError.message);
        if (axiosError.response) {
          console.error('🔍 Error response status:', axiosError.response.status);
          console.error('🔍 Error response data:', axiosError.response.data);
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

    // Clean up headers - remove problematic ones
    const originalHeaders = Object.keys(req.headers);
    console.log('🔍 Original headers:', originalHeaders);
    
    // Keep only safe headers
    const safeHeaders = ['accept', 'user-agent'];
    const cleanedHeaders = originalHeaders.filter(h => safeHeaders.includes(h.toLowerCase()));
    console.log('🔍 Cleaned headers:', cleanedHeaders);

    // Authentication logic
    const isTableOperation = baserowPath.includes('/fields/table/') || 
                            baserowPath.includes('/import/') || 
                            (req.method === 'POST' && baserowPath.includes('/tables/database/')) ||
                            baserowPath.includes('/fields/') || // Field operations like PATCH /database/fields/47018/
                            baserowPath.includes('/database/fields/'); // All field operations
    const isRowOperation = req.method === 'POST' && baserowPath.includes('/rows/');

    if (isTableOperation) {
      console.log('🔑 Added JWT authorization for table operation');
      const jwt = await getValidJwtToken();
      headers['Authorization'] = `JWT ${jwt}`;
    } else {
      console.log('🔑 Added API token authorization');
      headers['Authorization'] = `Token ${process.env.BASEROW_API_TOKEN}`;
    }

    // Build final headers
    cleanedHeaders.forEach(headerName => {
      headers[headerName] = req.headers[headerName];
    });

    console.log('🔍 Final headers being sent:', headers);

    const fetchOptions = {
      method: req.method,
      headers: headers
    };

    // Add body for non-GET requests
    if (req.method !== 'GET' && req.body && Object.keys(req.body).length > 0) {
      console.log('📝 Setting JSON content-type and body');
      headers['Content-Type'] = 'application/json';
      fetchOptions.body = JSON.stringify(req.body);
      
      // Debug row operations
      if (isRowOperation) {
        console.log('🔍 ROW OPERATION DATA:');
        console.log('📋 Request body:', req.body);
        console.log('📊 Body length:', JSON.stringify(req.body).length);
        console.log('📈 Object keys:', Object.keys(req.body));
      }
    }

    console.log(`🔄 Proxying ${req.method} ${baserowUrl}`);
    
    const response = await fetch(baserowUrl, fetchOptions);
    const data = await response.text();
    
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
    console.error('❌ Proxy error:', error);
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
    console.error('❌ File upload error:', error);
    res.status(500).json({ 
      error: 'File upload error', 
      message: error.message 
    });
  }
});

// Start server
app.listen(PORT, () => {
  console.log(`🚀 Secure Baserow proxy server running on port ${PORT}`);
  console.log(`🔒 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`🌐 Allowed origins: ${allowedOrigins.join(', ')}`);
  
  // Validate configuration
  if (!process.env.BASEROW_API_TOKEN) {
    console.warn('⚠️  Warning: BASEROW_API_TOKEN not set');
  }
  if (!process.env.BASEROW_USERNAME || !process.env.BASEROW_PASSWORD) {
    console.warn('⚠️  Warning: BASEROW_USERNAME or BASEROW_PASSWORD not set');
  }
});
