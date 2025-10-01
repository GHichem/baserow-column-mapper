import { fileStorage, isIndexedDBAvailable } from './fileStorage';
import { API_CONFIG, getApiConfig } from './apiConfig';

interface UploadData {
  vorname: string;
  nachname: string;
  email: string;
  company: string;
  zielgruppe: string;
  file: File;
}

// Configuration - Now using proxy server for secure token handling
const BASEROW_CONFIG = {
  // These will be fetched from proxy server instead of environment variables
  jwtToken: '',
  apiToken: '',
  tableId: '787',
  targetTableId: '790',
  baseUrl: () => {
    const config = getApiConfig();
    return config.isProxyEnabled ? config.proxyBaseUrl : 'https://baserow.app-inventor.org';
  },
  databaseId: '207',
  // These are no longer needed in frontend when using proxy
  username: '',
  password: ''
};

// Helper function to make API calls through proxy or direct
const makeApiCall = async (endpoint: string, options: RequestInit = {}) => {
  const config = getApiConfig();
  
  if (config.isProxyEnabled) {
    // Use proxy server - tokens are handled server-side
    const proxyUrl = `${config.proxyBaseUrl}/api/baserow${endpoint}`;
    return fetch(proxyUrl, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    });
  } else {
    // Direct API call - use API token for most operations
    const directUrl = `https://baserow.app-inventor.org/api${endpoint}`;
    const apiToken = import.meta.env.VITE_BASEROW_API_TOKEN || '';
    
    if (!apiToken) {
      throw new Error('Missing VITE_BASEROW_API_TOKEN in environment variables');
    }
    
    return fetch(directUrl, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Token ${apiToken}`,
        ...options.headers
      }
    });
  }
};

// Helper function for operations that require JWT tokens (like table/database operations)
const makeJWTApiCall = async (endpoint: string, options: RequestInit = {}, retryCount = 0): Promise<Response> => {
  const config = getApiConfig();
  const MAX_RETRIES = 2;
  
  if (config.isProxyEnabled) {
    // Use proxy server - tokens are handled server-side
    const proxyUrl = `${config.proxyBaseUrl}/api/baserow${endpoint}`;
    const response = await fetch(proxyUrl, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        ...options.headers
      }
    });
    
    // If we get a 401 error and haven't exhausted retries, wait and retry
    if (!response.ok && response.status === 401 && retryCount < MAX_RETRIES) {
      // Wait a bit for the server to refresh its token
      await new Promise(resolve => setTimeout(resolve, 1000));
      return makeJWTApiCall(endpoint, options, retryCount + 1);
    }
    
    return response;
  } else {
    // Direct API call - use JWT token for table operations
    const directUrl = `https://baserow.app-inventor.org/api${endpoint}`;
    const token = await getJWTToken();
    return fetch(directUrl, {
      ...options,
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `JWT ${token}`,
        ...options.headers
      }
    });
  }
};

// Helper function for file uploads (special handling for FormData)
const makeFileUploadCall = async (endpoint: string, formData: FormData, signal?: AbortSignal) => {
  const config = getApiConfig();
  if (config.isProxyEnabled) {
    // Use proxy server - tokens are handled server-side
    const proxyUrl = `${config.proxyBaseUrl}/api/baserow${endpoint}`;
    return fetch(proxyUrl, {
      method: 'POST',
      body: formData,
      signal
    });
  } else {
    // Direct API call (fallback for development)
    const directUrl = `https://baserow.app-inventor.org/api${endpoint}`;
    const apiToken = import.meta.env.VITE_BASEROW_API_TOKEN || '';
    return fetch(directUrl, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${apiToken}`,
      },
      body: formData,
      signal
    });
  }
};

// Initialize configuration from proxy server
const initializeConfig = async () => {
  const config = getApiConfig();
  if (config.isProxyEnabled) {
    try {
      const response = await fetch(`${config.proxyBaseUrl}/api/config`);
      if (response.ok) {
        const serverConfig = await response.json();
        BASEROW_CONFIG.tableId = serverConfig.tableId;
        BASEROW_CONFIG.targetTableId = serverConfig.targetTableId;
        BASEROW_CONFIG.databaseId = serverConfig.databaseId;
        console.log('Successfully loaded config from proxy server:', {
          tableId: BASEROW_CONFIG.tableId,
          targetTableId: BASEROW_CONFIG.targetTableId,
          databaseId: BASEROW_CONFIG.databaseId
        });
      } else {
        console.error('Failed to fetch config from proxy server, response not ok:', response.status);
        // Fallback to default values if proxy server config fails
        console.warn('Using default configuration values');
      }
    } catch (error) {
      console.error('Failed to fetch config from proxy server:', error);
      console.warn('Using default configuration values');
    }
  } else {
    console.log('Proxy mode disabled, using default configuration');
  }
};

// Initialize config when module loads
initializeConfig();

// Performance Configuration for Parallel Processing 🚀
const PERFORMANCE_CONFIG = {
  BATCH_SIZE: 200,           // Baserow's API limit per batch
  PARALLEL_BATCHES: 6,       // Process 6 batches concurrently (1200 records at once!)
  PAUSE_BETWEEN_GROUPS: 100, // Brief pause (ms) between parallel groups for API courtesy
  LARGE_FILE_THRESHOLD: 1000 // Files over this many records use parallel processing
};

// Global variable to hold large file content temporarily (avoids storage limitations)
let TEMP_FILE_CONTENT: string | null = null;
let TEMP_FILE_METADATA: { name: string; size: number; recordId: string } | null = null;

// JWT Token caching to avoid re-authentication during long imports
let CACHED_JWT_TOKEN: string | null = null;
let JWT_TOKEN_EXPIRES_AT: number = 0;
const JWT_TOKEN_BUFFER_MS = 10 * 60 * 1000; // Refresh 10 minutes before expiry (increased buffer)

// Enhanced token management for long-running operations
let LAST_TOKEN_REFRESH: number = 0;
const MIN_REFRESH_INTERVAL_MS = 30 * 1000; // Minimum 30 seconds between refresh attempts

// Import cancellation support
let IMPORT_ABORT_CONTROLLER: AbortController | null = null;

// Cancel current import operation
export const cancelImport = () => {
  if (IMPORT_ABORT_CONTROLLER) {
    IMPORT_ABORT_CONTROLLER.abort();
    IMPORT_ABORT_CONTROLLER = null;
    
    // Also reset any global state flags that might prevent clean restart
    BULK_OPERATIONS_DISABLED = false;
    BULK_FAILURE_COUNT = 0;
  }
};

/**
 * Helper function to recover full file content when TEMP_FILE_CONTENT is missing
 * or when we have truncated content after a page refresh.
 * 
 * @param fileInfo - The uploaded file information from sessionStorage
 * @param currentContent - The current content available (may be truncated)
 * @returns Promise<string> - Full file content
 */
export const recoverFullFileContentIfNeeded = async (
  fileInfo: any, 
  currentContent: string
): Promise<string> => {
  // First, check if we already have full content
  const currentLines = currentContent.split(/\r?\n/).filter(line => line.trim());
  
  // Determine if we need to fetch full content
  const needsFullContent = (
    // File was optimized/truncated for storage
    fileInfo.isOptimized ||
    // Total lines indicate truncation
    (fileInfo.totalLines && currentLines.length < fileInfo.totalLines * 0.9) ||
    // Small line count suggests truncation for large files
    (currentLines.length <= 1000 && fileInfo.originalFileSize > 10 * 1024 * 1024) ||
    // Content contains truncation markers
    currentContent.includes('[...CONTENT_TRUNCATED_FOR_STORAGE...]')
  );

  if (!needsFullContent) {
    return currentContent;
  }

  // Step 1: Try to get from IndexedDB storage (fastest)
  if (isIndexedDBAvailable() && fileInfo.recordId) {
    try {
      const storedContent = await fileStorage.getFile(fileInfo.recordId);
      if (storedContent) {
        const storedLines = storedContent.split(/\r?\n/).filter(line => line.trim());
        if (storedLines.length > currentLines.length) {
          return storedContent;
        }
      }
    } catch (error) {
      // IndexedDB access failed, continue to other methods
    }
  }
  
  // Check if we have the file URL to fetch from
  if (!fileInfo.file?.url) {
    return currentContent;
  }

  try {
    // First try direct fetch from Baserow API with JWT token
    
    let response: Response;
    let fetchController = new AbortController();
    let timeoutId = setTimeout(() => fetchController.abort(), 300000); // 5 minute timeout
    
    try {
      // Get fresh JWT token for file access
      const jwtToken = await getJWTToken();
      
      // Try direct access to Baserow file with JWT token
      response = await fetch(fileInfo.file.url, {
        method: 'GET',
        headers: {
          'Authorization': `JWT ${jwtToken}`,
          'Accept': 'text/csv,text/plain,application/octet-stream,*/*',
        },
        signal: fetchController.signal
      });

      clearTimeout(timeoutId);
      
      if (response.ok) {
        // Success
      } else {
        throw new Error(`Direct access failed: ${response.status}`);
      }
    } catch (directError) {
      // Fallback: Try with API token instead of JWT
      clearTimeout(timeoutId);
      
      // Fallback: Try with API token instead of JWT
      fetchController = new AbortController();
      timeoutId = setTimeout(() => fetchController.abort(), 300000);
      
      try {
        const apiToken = import.meta.env.VITE_BASEROW_API_TOKEN || '';
        response = await fetch(fileInfo.file.url, {
          method: 'GET',
          headers: {
            'Authorization': `Token ${apiToken}`,
            'Accept': 'text/csv,text/plain,application/octet-stream,*/*',
          },
          signal: fetchController.signal
        });

        clearTimeout(timeoutId);
        
        if (response.ok) {
          // Success
        } else {
          throw new Error(`API token access failed: ${response.status}`);
        }
      } catch (apiTokenError) {
        // Last resort: Try without authorization (for public files)
        clearTimeout(timeoutId);
        
        // Last resort: Try without authorization (for public files)
        fetchController = new AbortController();
        timeoutId = setTimeout(() => fetchController.abort(), 300000);
        
        response = await fetch(fileInfo.file.url, {
          method: 'GET',
          headers: {
            'Accept': 'text/csv,text/plain,application/octet-stream,*/*',
          },
          signal: fetchController.signal
        });

        clearTimeout(timeoutId);
        
        if (!response.ok) {
          throw new Error(`All direct access methods failed. Status: ${response.status}`);
        }
      }
    }

    if (!response.ok) {
      // Try to get error details from response
      let errorDetails = `${response.status} ${response.statusText}`;
      try {
        const errorBody = await response.text();
        if (errorBody.trim()) {
          errorDetails = errorBody;
        }
      } catch (e) {
        // Response wasn't readable, use status text
      }
      
      throw new Error(`File fetch failed: ${errorDetails}`);
    }

    const fullContent = await response.text();
    const fullLines = fullContent.split(/\r?\n/).filter(line => line.trim());
    
    // Verify that we actually got more content
    if (fullContent.length <= currentContent.length) {
      return currentContent;
    }
    
    return fullContent;
  } catch (error) {
    // Last resort: Try to get the file data from the table row itself
    try {
      const rowResponse = await makeApiCall(`/database/rows/table/${BASEROW_CONFIG.tableId}/${fileInfo.recordId}/?user_field_names=true`);
      
      if (rowResponse.ok) {
        const rowData = await rowResponse.json();
        const fileField = rowData.Datei || rowData.File || rowData.file;
        
        if (fileField && Array.isArray(fileField) && fileField.length > 0) {
          const latestFile = fileField[0];
          // Try downloading with the fresh file URL (direct file download, not through proxy)
          const config = getApiConfig();
          const jwtToken = config.isProxyEnabled ? '' : await getJWTToken();
          const freshResponse = await fetch(latestFile.url, {
            headers: {
              ...(jwtToken ? { 'Authorization': `JWT ${jwtToken}` } : {}),
              'Accept': 'text/csv,text/plain,application/octet-stream,*/*',
            },
          });
          
          if (freshResponse.ok) {
            const freshContent = await freshResponse.text();
            return freshContent;
          }
        }
      }
    } catch (lastResortError) {
    }
    
    // Provide more specific error messages
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
      } else if (error.message.includes('ECONNREFUSED') || error.message.includes('fetch failed')) {
      } else if (error.message.includes('401') || error.message.includes('403')) {
      } else if (error.message.includes('404')) {
      } else {
      }
    }
    // Return the truncated content as fallback
    return currentContent;
  }
};

// Clear cached JWT token
export const clearJWTTokenCache = () => {
  CACHED_JWT_TOKEN = null;
  JWT_TOKEN_EXPIRES_AT = 0;
  LAST_TOKEN_REFRESH = 0;
};

// Check if we have valid authentication credentials
export const validateAuthCredentials = (): boolean => {
  const config = getApiConfig();
  
  if (config.isProxyEnabled) {
    // In proxy mode, credentials are handled server-side
    return true;
  } else {
    // In direct mode, check for API token or username/password
    const hasApiToken = !!(import.meta.env.VITE_BASEROW_API_TOKEN);
    const hasCredentials = !!(import.meta.env.VITE_BASEROW_USERNAME && import.meta.env.VITE_BASEROW_PASSWORD);
    
    if (!hasApiToken && !hasCredentials) {
      return false;
    }
    
    return true;
  }
};

// Function to get a fresh JWT token - now handled by proxy server
const getJWTToken = async (): Promise<string> => {
  const config = getApiConfig();
  if (config.isProxyEnabled) {
    // When using proxy, tokens are handled server-side
    // Just return a placeholder since proxy handles authentication
    return 'PROXY_HANDLED';
  }
  
  // Fallback for direct API access (development mode)
  try {
    const now = Date.now();
    
    // Check if we have a valid cached token with buffer
    if (CACHED_JWT_TOKEN && JWT_TOKEN_EXPIRES_AT > (now + JWT_TOKEN_BUFFER_MS)) {
      const remainingMinutes = Math.round((JWT_TOKEN_EXPIRES_AT - now) / 60000);
      if (remainingMinutes <= 15) {
      }
      return CACHED_JWT_TOKEN;
    }

    // Prevent rapid refresh attempts
    if (LAST_TOKEN_REFRESH && (now - LAST_TOKEN_REFRESH) < MIN_REFRESH_INTERVAL_MS) {
      await new Promise(resolve => setTimeout(resolve, 1000));
    }
    LAST_TOKEN_REFRESH = now;
    
    // Clear old token before requesting new one
    CACHED_JWT_TOKEN = null;
    JWT_TOKEN_EXPIRES_AT = 0;
    
    // For direct access, we'd need credentials from env variables
    const username = import.meta.env.VITE_BASEROW_USERNAME || '';
    const password = import.meta.env.VITE_BASEROW_PASSWORD || '';
    
    if (!username || !password) {
      throw new Error('Missing authentication credentials. Please check VITE_BASEROW_USERNAME and VITE_BASEROW_PASSWORD environment variables.');
    }
    
    const response = await fetch(`https://baserow.app-inventor.org/api/user/token-auth/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: username,
        password: password,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      if (response.status === 401) {
        throw new Error('Authentication failed: Invalid username or password. Please check your credentials.');
      } else if (response.status === 403) {
        throw new Error('Authentication failed: Access forbidden. Please check your account permissions.');
      } else {
        throw new Error(`Authentication failed: ${response.status} - ${errorText}`);
      }
    }

    const data = await response.json();
    
    if (!data.token) {
      throw new Error('No token received from authentication response');
    }
    
    // Cache the token with enhanced expiry handling
    CACHED_JWT_TOKEN = data.token;
    // Set expiry to 50 minutes (conservative estimate for 1-hour tokens)
    JWT_TOKEN_EXPIRES_AT = now + (50 * 60 * 1000); 
    
    const expiresInMinutes = Math.round((JWT_TOKEN_EXPIRES_AT - now) / 60000);
    return CACHED_JWT_TOKEN;
  } catch (error) {
    // Clear cached token on error
    CACHED_JWT_TOKEN = null;
    JWT_TOKEN_EXPIRES_AT = 0;
    LAST_TOKEN_REFRESH = 0;
    
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Authentication failed');
  }
};

// Helper function to ensure fresh token for critical operations
const ensureFreshToken = async (): Promise<string> => {
  const config = getApiConfig();
  
  // In proxy mode, tokens are handled server-side, no client-side token needed
  if (config.isProxyEnabled) {
    return 'PROXY_HANDLED';
  }
  
  const now = Date.now();
  
  // If token is already expired or expires within 15 minutes, get a fresh one
  const CRITICAL_BUFFER_MS = 15 * 60 * 1000; // 15 minutes
  
  if (!CACHED_JWT_TOKEN || JWT_TOKEN_EXPIRES_AT <= now || JWT_TOKEN_EXPIRES_AT <= (now + CRITICAL_BUFFER_MS)) {
    clearJWTTokenCache(); // Clear cache first to ensure fresh token
    return await getJWTToken();
  }
  
  return CACHED_JWT_TOKEN;
};

// Global error handler for token-related issues
const handleAuthError = (error: any, operation: string) => {
  if (error instanceof Error && 
      (error.message.includes('401') || 
       error.message.includes('Authentication failed') || 
       error.message.includes('token') || 
       error.message.includes('expired'))) {
    clearJWTTokenCache();
  }
  throw error;
};

export const uploadToBaserow = async (data: UploadData): Promise<void> => {
  try {
    // Clear any previous temporary file storage
    TEMP_FILE_CONTENT = null;
    TEMP_FILE_METADATA = null;
    // Always create a NEW record for each upload (allow duplicates)

    // First, upload the file to Baserow with timeout handling
    const fileFormData = new FormData();
    fileFormData.append('file', data.file);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000); // Reduced from 5 minutes to 2 minutes

    try {
      const fileUploadResponse = await makeFileUploadCall('/user-files/upload-file/', fileFormData, controller.signal);

      clearTimeout(timeoutId);

      if (!fileUploadResponse.ok) {
        const errorText = await fileUploadResponse.text();
        throw new Error(`Datei-Upload fehlgeschlagen: ${errorText}`);
      }

      const fileUploadResult = await fileUploadResponse.json();
      
      // Process file in chunks for large files with error handling
      let fileContent = '';
      try {
        fileContent = await processFileForStorage(data.file); // Use storage-optimized processing
      } catch (processingError) {
        throw new Error('Fehler beim Verarbeiten der Datei. Die Datei ist möglicherweise zu groß oder beschädigt.');
      }
      
      // Then, create a row in the table with the form data and file reference
      const rowData = {
        field_8123: data.vorname,      // Vorname
        field_8124: data.nachname,     // Nachname  
        field_8127: data.email,        // EMAIL
        field_8125: data.company,      // Company
        field_53605: data.zielgruppe,  // Zielgruppe (new)
        field_8126: [fileUploadResult], // Datei
        field_9206: null,              // CreatedTableId - Will be updated after table creation
      };
      const rowResponse = await makeApiCall(`/database/rows/table/${BASEROW_CONFIG.tableId}/`, {
        method: 'POST',
        body: JSON.stringify(rowData),
      });
      if (!rowResponse.ok) {
        const errorText = await rowResponse.text();
        throw new Error(`Datensatz konnte nicht erstellt werden: ${errorText}`);
      }

      const rowResult = await rowResponse.json();
      // Store file info in session for the mapping page with size check
      const isLargeFile = data.file.size > 10 * 1024 * 1024; // 10MB threshold
      let contentToStore = fileContent;
      
      if (isLargeFile) {
        // For session storage, we'll store the full content but may need to fetch from URL later
        contentToStore = fileContent;
      }
      
      const fileInfo = {
        file: fileUploadResult,
        userData: data,
        fileName: data.file.name,
        fileContent: contentToStore,
        recordId: rowResult.id,
        isLargeFile: isLargeFile,
        originalFileSize: data.file.size,
        fullFileContent: isLargeFile ? null : fileContent // Store full content only for smaller files
      };

      try {
        // Always try to store the full file content first, regardless of size
        const fileInfo = {
          file: fileUploadResult,
          userData: data,
          fileName: data.file.name,
          fileContent: fileContent, // Always include full content initially
          recordId: rowResult.id,
          isLargeFile: isLargeFile,
          originalFileSize: data.file.size,
          fullFileContent: fileContent // Store full content as backup
        };

        const fileInfoString = JSON.stringify(fileInfo);
        
        try {
          // Try to store complete file info first
          // Clear any existing file info to free up storage space
          sessionStorage.removeItem('uploadedFileInfo');
          
          sessionStorage.setItem('uploadedFileInfo', fileInfoString);
        } catch (storageError) {
          // Fallback 1: Store with compressed content (first and last parts)
          const lines = fileContent.split('\n');
          let optimizedContent = '';
          
          if (lines.length > 2000) {
            // Store first 1000 lines + last 100 lines for large files
            const headerLines = lines.slice(0, 1000).join('\n');
            const footerLines = lines.slice(-100).join('\n');
            optimizedContent = headerLines + '\n\n[...CONTENT_TRUNCATED_FOR_STORAGE...]\n\n' + footerLines;
          } else {
            // For smaller files, try storing just the content without full metadata
            optimizedContent = fileContent;
          }
          
          const optimizedFileInfo = {
            file: fileUploadResult,
            userData: data,
            fileName: data.file.name,
            fileContent: optimizedContent,
            recordId: rowResult.id,
            isLargeFile: isLargeFile,
            originalFileSize: data.file.size,
            isOptimized: lines.length > 2000, // Flag to indicate content was compressed
            totalLines: lines.length
          };

          try {
            sessionStorage.setItem('uploadedFileInfo', JSON.stringify(optimizedFileInfo));
            
            // 🆕 IMPORTANT: Store complete file content using IndexedDB for large files
            if (data.file.size > 10 * 1024 * 1024 && isIndexedDBAvailable()) {
              try {
                await fileStorage.storeFile(rowResult.id, fileContent, {
                  name: data.file.name,
                  size: data.file.size,
                  baserowUrl: fileUploadResult?.url || '',
                });
              } catch (indexedDBError) {
                // Fallback to temporary memory
                TEMP_FILE_CONTENT = fileContent;
                TEMP_FILE_METADATA = {
                  name: data.file.name,
                  size: data.file.size,
                  recordId: rowResult.id
                };
              }
            } else if (data.file.size > 10 * 1024 * 1024) {
              // Fallback to temporary memory if IndexedDB is not available
              TEMP_FILE_CONTENT = fileContent;
              TEMP_FILE_METADATA = {
                name: data.file.name,
                size: data.file.size,
                recordId: rowResult.id
              };
            }
            
            if (lines.length > 2000) {
            }
          } catch (secondStorageError) {
            
            // Ultra-minimal storage: Only headers + metadata (for column mapping only)
            const headerOnlyContent = lines.slice(0, 5).join('\n'); // Just first 5 lines for headers
            
            const ultraMinimalFileInfo = {
              file: fileUploadResult,
              userData: data,
              fileName: data.file.name,
              fileContent: headerOnlyContent, // Only headers
              recordId: rowResult.id,
              isLargeFile: true,
              originalFileSize: data.file.size,
              needsReprocessing: true,
              isHeaderOnly: true, // Flag to indicate only headers available
              totalLines: lines.length,
              canImportFromOriginal: true, // 🆕 Flag to indicate we can reprocess from original data
              storageWarning: `Große Datei (${(data.file.size / 1024 / 1024).toFixed(1)}MB) - Spalten-Mapping verfügbar, Import verarbeitet komplette Datei neu.`
            };
            
            try {
              sessionStorage.setItem('uploadedFileInfo', JSON.stringify(ultraMinimalFileInfo));
              
              // 🆕 For very large files, store content using IndexedDB or temporary global variable
              if (data.file.size > 10 * 1024 * 1024) {
                if (isIndexedDBAvailable()) {
                  try {
                    await fileStorage.storeFile(rowResult.id, fileContent, {
                      name: data.file.name,
                      size: data.file.size,
                      baserowUrl: fileUploadResult?.url || '',
                    });
                  } catch (indexedDBError) {
                    // Fallback to temporary memory
                    TEMP_FILE_CONTENT = fileContent;
                    TEMP_FILE_METADATA = {
                      name: data.file.name,
                      size: data.file.size,
                      recordId: rowResult.id
                    };
                  }
                } else {
                  // Fallback to temporary memory if IndexedDB is not available
                  TEMP_FILE_CONTENT = fileContent;
                  TEMP_FILE_METADATA = {
                    name: data.file.name,
                    size: data.file.size,
                    recordId: rowResult.id
                  };
                }
              }
              
              // Show user-friendly info about large file processing
              if (data.file.size > 50 * 1024 * 1024) { // 50MB
              }
              
            } catch (emergencyError) {
              
              // Absolute last resort: Store without any content
              const emergencyFileInfo = {
                file: fileUploadResult,
                userData: data,
                fileName: data.file.name,
                fileContent: '', // No content at all
                recordId: rowResult.id,
                isLargeFile: true,
                originalFileSize: data.file.size,
                needsReprocessing: true,
                requiresFileReupload: true, // Flag indicating file must be re-uploaded
                storageWarning: `Datei zu groß für Browser-Speicher (${(data.file.size / 1024 / 1024).toFixed(1)}MB). Bitte teilen Sie die Datei auf oder verwenden Sie eine kleinere Datei.`
              };
              
              try {
                sessionStorage.setItem('uploadedFileInfo', JSON.stringify(emergencyFileInfo));
                throw new Error(`Datei ist zu groß für den Browser-Speicher (${(data.file.size / 1024 / 1024).toFixed(1)}MB).\n\nBitte verwenden Sie eine kleinere Datei (empfohlen: < 20MB) oder teilen Sie die Datei in kleinere Abschnitte auf.`);
              } catch (absoluteFailure) {
                throw new Error('Die Datei ist viel zu groß für den Browser. Bitte verwenden Sie eine deutlich kleinere Datei (< 10MB).');
              }
            }
          }
        }
      } catch (storageError) {
        throw new Error('Fehler beim Speichern der Datei-Informationen.');
      }

    } catch (uploadError) {
      clearTimeout(timeoutId);
      if (uploadError.name === 'AbortError') {
        throw new Error('Datei-Upload dauerte zu lange. Bitte versuchen Sie es mit einer kleineren Datei.');
      }
      throw uploadError;
    }

  } catch (error) {
    // Provide more specific error messages
    if (error instanceof Error) {
      if (error.message.includes('Failed to fetch')) {
        throw new Error('Netzwerkfehler. Bitte überprüfen Sie Ihre Internetverbindung.');
      } else if (error.message.includes('timeout') || error.message.includes('AbortError')) {
        throw new Error('Die Anfrage dauerte zu lange. Bitte versuchen Sie es mit einer kleineren Datei.');
      } else if (error.message.includes('too large')) {
        throw new Error('Die Datei ist zu groß. Bitte verwenden Sie eine kleinere Datei.');
      } else {
        throw error;
      }
    }
    
    throw new Error('Ein unbekannter Fehler ist aufgetreten. Bitte versuchen Sie es erneut.');
  }
};

// Process file in chunks to handle very large files efficiently
const processFileInChunks = async (file: File, forUploadProcessing: boolean = false): Promise<string> => {
  const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB chunks for better performance with large files
  let content = '';
  let processedSize = 0;
  const maxFileSize = 500 * 1024 * 1024; // Increased to 500MB limit for very large files
  
  try {
    if (file.size > maxFileSize) {
      throw new Error(`Datei zu groß (${(file.size / 1024 / 1024).toFixed(2)}MB). Maximale Größe: ${maxFileSize / 1024 / 1024}MB`);
    }
    
    // For storage optimization (not upload processing), process only what we need for headers + some sample data
    if (!forUploadProcessing && file.size > 100 * 1024 * 1024) { // 100MB threshold for limited processing
      // Read only the first 10MB for headers and sample data for storage
      const essentialChunk = file.slice(0, 10 * 1024 * 1024);
      const essentialContent = await essentialChunk.text();
      
      return essentialContent;
    }
    
    // For large files, use streaming for full processing
    if (file.size > 50 * 1024 * 1024) { // 50MB threshold for streaming
      return await processLargeFileStreaming(file);
    }
    
    // Process file in chunks with improved memory management
    const chunks = [];
    for (let start = 0; start < file.size; start += CHUNK_SIZE) {
      const end = Math.min(start + CHUNK_SIZE, file.size);
      const chunk = file.slice(start, end);
      chunks.push(chunk);
    }
    
    // Process chunks sequentially to avoid memory issues
    for (let i = 0; i < chunks.length; i++) {
      const chunk = chunks[i];
      
      try {
        const chunkText = await chunk.text();
        content += chunkText;
        processedSize += chunk.size;
        
        // Minimal delay between chunks for speed
        if (i < chunks.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 5)); // Reduced from 25ms to 5ms
        }
      } catch (chunkError) {
        throw new Error(`Fehler beim Verarbeiten von Chunk ${i + 1}. Die Datei ist möglicherweise beschädigt.`);
      }
    }
    return content;
    
  } catch (error) {
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Unbekannter Fehler beim Verarbeiten der Datei.');
  }
};

/**
 * Process file for storage in sessionStorage (can be optimized/truncated for large files)
 * This function may return truncated content to save browser storage space.
 */
const processFileForStorage = async (file: File): Promise<string> => {
  return await processFileInChunks(file, false); // false = enable storage optimization
};

/**
 * Process file for import operations (always full content)
 * This function always returns the complete file content, regardless of size.
 */
const processFileForImport = async (file: File): Promise<string> => {
  // For import operations, we need the full file content regardless of size
  const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB chunks
  let content = '';
  let processedSize = 0;
  const maxFileSize = 500 * 1024 * 1024; // 500MB limit
  
  if (file.size > maxFileSize) {
    throw new Error(`Datei zu groß (${(file.size / 1024 / 1024).toFixed(2)}MB). Maximale Größe: ${maxFileSize / 1024 / 1024}MB`);
  }
  // Always use streaming for import to handle large files
  if (file.size > 50 * 1024 * 1024) {
    return await processLargeFileStreaming(file);
  }
  
  // Process file in chunks
  const chunks = [];
  for (let start = 0; start < file.size; start += CHUNK_SIZE) {
    const end = Math.min(start + CHUNK_SIZE, file.size);
    const chunk = file.slice(start, end);
    chunks.push(chunk);
  }
  
  // Process all chunks sequentially
  for (let i = 0; i < chunks.length; i++) {
    const chunk = chunks[i];
    
    try {
      const chunkText = await chunk.text();
      content += chunkText;
      processedSize += chunk.size;
      if (i < chunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 5));
      }
    } catch (chunkError) {
      throw new Error(`Fehler beim Verarbeiten von Chunk ${i + 1} für Import.`);
    }
  }
  return content;
};

// Streaming approach for very large files with explicit UTF-8 decoding
const processLargeFileStreaming = async (file: File): Promise<string> => {
  const STREAM_CHUNK_SIZE = 1024 * 1024; // 1MB streaming chunks
  let content = '';
  let totalProcessed = 0;
  return new Promise((resolve, reject) => {
    try {
      const reader = file.stream().getReader();
      const decoder = new TextDecoder('utf-8'); // Explicitly use UTF-8
      
      const processStream = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            
            if (done) {
              resolve(content);
              break;
            }
            
            const chunk = decoder.decode(value, { stream: true });
            content += chunk;
            totalProcessed += value.length;
            
            // Log progress every 10MB
            if (totalProcessed % (10 * 1024 * 1024) < value.length) {
            }
            
            // Minimal delay to prevent blocking
            await new Promise(resolve => setTimeout(resolve, 1)); // Reduced from 10ms to 1ms
          }
        } catch (error) {
          reject(new Error('Fehler beim Streaming der Datei. Die Datei ist möglicherweise beschädigt.'));
        }
      };
      
      processStream();
    } catch (error) {
      reject(new Error('Fehler beim Einrichten des Datei-Streams.'));
    }
  });
};

// Helper function to find existing records
const findExistingRecord = async (vorname: string, nachname: string, email: string, company: string) => {
  try {
    const response = await makeApiCall(`/database/rows/table/${BASEROW_CONFIG.tableId}/`);

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const existingRecord = data.results?.find((row: any) => 
      row.field_8123?.toLowerCase() === vorname.toLowerCase() &&      // Vorname
      row.field_8124?.toLowerCase() === nachname.toLowerCase() &&     // Nachname
      row.field_8127?.toLowerCase() === email.toLowerCase() &&        // EMAIL
      row.field_8125?.toLowerCase() === company.toLowerCase()         // Company
    );

    return existingRecord || null;
  } catch (error) {
    return null;
  }
};

// Helper: list tables in database to check existing names
const listTablesInDatabase = async (): Promise<Array<{ id: number; name: string }>> => {
  const response = await makeJWTApiCall(`/database/tables/database/${BASEROW_CONFIG.databaseId}/`, {
    method: 'GET',
  });
  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to list tables: ${errorText}`);
  }
  const data = await response.json();
  return Array.isArray(data) ? data : (data.results || []);
};

// Helper: compute next available table name with incremental suffix
const getUniqueTableName = async (baseName: string): Promise<string> => {
  try {
    const tables = await listTablesInDatabase();
    const existingNames = new Set<string>(tables.map(t => t.name));
    if (!existingNames.has(baseName)) return baseName;

    let suffix = 1;
    while (existingNames.has(`${baseName}_${suffix}`)) {
      suffix += 1;
      if (suffix > 9999) break;
    }
    return `${baseName}_${suffix}`;
  } catch {
    // On failure, fallback to baseName to avoid blocking
    return baseName;
  }
};

// Create a new table using appropriate authentication method
export const createNewTable = async (tableName: string, columns: string[]): Promise<string> => {
  let attempt = 0;
  const maxAttempts = 2;
  
  while (attempt < maxAttempts) {
    try {
      // Create table structure
      const tableData = {
        name: tableName
      };

      const tableResponse = await makeJWTApiCall(`/database/tables/database/${BASEROW_CONFIG.databaseId}/`, {
        method: 'POST',
        body: JSON.stringify(tableData),
      });

      if (!tableResponse.ok) {
        const errorText = await tableResponse.text();
        // If it's a 401 (token expired) and we haven't retried yet, clear cache and retry
        if (tableResponse.status === 401 && attempt < maxAttempts - 1) {
          clearJWTTokenCache(); // Clear cache for retry
          attempt++;
          continue;
        }
        
        // For other errors or if retries failed, throw error
        if (tableResponse.status === 401) {
          throw new Error('Authentication failed during table creation. Please check your credentials.');
        } else if (tableResponse.status === 403) {
          throw new Error('Access forbidden during table creation. Please check your permissions.');
        } else {
          throw new Error(`Table creation failed: ${tableResponse.status} - ${errorText}`);
        }
      }

      const tableResult = await tableResponse.json();

      // Minimal wait for table creation
      await new Promise(resolve => setTimeout(resolve, 50));

      // Handle the primary "Name" field and create other columns  
      const config = getApiConfig();
      const jwtToken = config.isProxyEnabled ? 'PROXY_HANDLED' : await getJWTToken(); // Get JWT token for table operations only in direct mode
      await setupTableColumns(tableResult.id, columns, jwtToken);

      return tableResult.id.toString();
      
    } catch (error) {
      // If it's a token-related error and we can retry, continue
      if (error instanceof Error && 
          (error.message.includes('Authentication failed') || error.message.includes('expired')) && 
          attempt < maxAttempts - 1) {
        attempt++;
        continue;
      }
      
      // Otherwise, throw the error
      throw error;
    }
  }
  
  throw new Error('Failed to create table after multiple attempts');
};

// Setup table columns - rename primary field and create others with token refresh
const setupTableColumns = async (tableId: string, columns: string[], initialJwtToken: string) => {
  let jwtToken = initialJwtToken;
  const config = getApiConfig();
  
  const refreshTokenIfNeeded = async (response: Response) => {
    if (response.status === 401) {
      if (!config.isProxyEnabled) {
        clearJWTTokenCache(); // Use proper cache clearing function only in direct mode
        jwtToken = await ensureFreshToken(); // Use ensureFreshToken for consistency
      }
      return true;
    }
    return false;
  };
  
  try {
    // Get current table fields
    let fieldsResponse = await makeJWTApiCall(`/database/fields/table/${tableId}/`, {
      method: 'GET'
    });

    if (!fieldsResponse.ok) {
      const wasRefreshed = await refreshTokenIfNeeded(fieldsResponse);
      if (wasRefreshed) {
        // Retry with fresh token
        fieldsResponse = await makeJWTApiCall(`/database/fields/table/${tableId}/`, {
          method: 'GET'
        });
      }
      
      if (!fieldsResponse.ok) {
        throw new Error('Failed to fetch table fields');
      }
    }

    const fields = await fieldsResponse.json();
    // Find the primary field (cannot be deleted, must exist)
    const primaryField = fields.find((field: any) => field.primary === true);
    
    if (primaryField && columns.length > 0) {
      // Rename the primary field to the first CSV column
      let renameResponse = await makeJWTApiCall(`/database/fields/${primaryField.id}/`, {
        method: 'PATCH',
        body: JSON.stringify({
          name: columns[0]
        }),
      });

      if (!renameResponse.ok) {
        const wasRefreshed = await refreshTokenIfNeeded(renameResponse);
        if (wasRefreshed) {
          // Retry with fresh token
          renameResponse = await makeJWTApiCall(`/database/fields/${primaryField.id}/`, {
            method: 'PATCH',
            body: JSON.stringify({
              name: columns[0]
            }),
          });
        }
      }

      if (renameResponse.ok) {
      } else {
        const errorText = await renameResponse.text();
        throw new Error(`Failed to rename primary field: ${errorText}`);
      }
      
      // Minimal wait after rename
      await new Promise(resolve => setTimeout(resolve, 25)); // Reduced from 100ms to 25ms
    }

    // Delete any other default fields (but not the primary one)
    for (const field of fields) {
      if (field.id !== primaryField?.id && (field.name === 'Notes' || field.name === 'Active')) {
        let deleteResponse = await makeJWTApiCall(`/database/fields/${field.id}/`, {
          method: 'DELETE'
        });
        
        if (!deleteResponse.ok) {
          const wasRefreshed = await refreshTokenIfNeeded(deleteResponse);
          if (wasRefreshed) {
            // Retry with fresh token
            deleteResponse = await makeJWTApiCall(`/database/fields/${field.id}/`, {
              method: 'DELETE'
            });
          }
        }
        
        if (deleteResponse.ok) {
        } else {
          const errorText = await deleteResponse.text();
        }
        
        await new Promise(resolve => setTimeout(resolve, 25)); // Reduced from 100ms to 25ms
      }
    }

    // Create remaining columns (skip the first one since we renamed the primary field to it)
    for (let i = 1; i < columns.length; i++) {
      const columnName = columns[i];
      await createTableColumn(tableId, columnName, jwtToken);
      // Wait between column creations
    }

    // Minimal wait for field operations
    await new Promise(resolve => setTimeout(resolve, 50)); // Reduced from 200ms to 50ms
    
  } catch (error) {
    throw error;
  }
};

// Create a column in the table with token refresh support
const createTableColumn = async (tableId: string, columnName: string, initialJwtToken: string) => {
  let jwtToken = initialJwtToken;
  
  try {
    const columnData = {
      name: columnName,
      type: 'text'
    };

    let columnResponse = await makeJWTApiCall(`/database/fields/table/${tableId}/`, {
      method: 'POST',
      body: JSON.stringify(columnData),
    });

    if (!columnResponse.ok) {
      // Check if it's a token issue
      if (columnResponse.status === 401) {
        const config = getApiConfig();
        if (!config.isProxyEnabled) {
          clearJWTTokenCache(); // Use proper cache clearing function only in direct mode
          jwtToken = await ensureFreshToken(); // Use ensureFreshToken for consistency
        }
        
        // Retry with fresh token
        columnResponse = await makeJWTApiCall(`/database/fields/table/${tableId}/`, {
          method: 'POST',
          body: JSON.stringify(columnData),
        });
      }
      
      if (!columnResponse.ok) {
        const errorText = await columnResponse.text();
        throw new Error(`Failed to create column: ${columnName} - ${errorText}`);
      }
    }
    
    const result = await columnResponse.json();
    return result.id;
  } catch (error) {
    throw error;
  }
};

// Delete a table using fresh JWT token with enhanced token management and retry logic
const deleteTable = async (tableId: string, retryCount = 0) => {
  const MAX_RETRIES = 2;
  const config = getApiConfig();
  
  try {
    // Only get token for direct mode, proxy mode handles authentication server-side
    if (!config.isProxyEnabled) {
      // Always get a fresh token before deletion in direct mode
      const jwtToken = await ensureFreshToken();
    }
    
    const response = await makeJWTApiCall(`/database/tables/${tableId}/`, {
      method: 'DELETE'
    });

    if (response.ok) {
      return;
    } else if (response.status === 401 && retryCount < MAX_RETRIES) {
      if (!config.isProxyEnabled) {
        clearJWTTokenCache(); // Only clear cache in direct mode
      }
      await new Promise(resolve => setTimeout(resolve, 500)); // Brief delay
      return await deleteTable(tableId, retryCount + 1);
    } else if (response.status === 404) {
      return; // Table doesn't exist, which is fine
    } else {
      const errorText = await response.text();
      // Don't throw error for deletion failures - just log and continue
    }
  } catch (error) {
    if (retryCount < MAX_RETRIES) {
      if (!config.isProxyEnabled) {
        clearJWTTokenCache(); // Only clear cache in direct mode
      }
      await new Promise(resolve => setTimeout(resolve, 1000)); // Longer delay on error
      return await deleteTable(tableId, retryCount + 1);
    } else {
      // Don't throw error - deletion failure shouldn't stop the import process
    }
  }
};

// Update record with created table ID
const updateRecordWithTableId = async (recordId: number, tableId: string) => {
  try {
    const response = await makeApiCall(`/database/rows/table/${BASEROW_CONFIG.tableId}/${recordId}/`, {
      method: 'PATCH',
      body: JSON.stringify({
        field_9206: tableId,  // CreatedTableId
      }),
    });

    if (!response.ok) {
    }
  } catch (error) {
  }
};

// Get table schema from Baserow
export const getTableSchema = async (tableId: string) => {
  try {
    const response = await makeApiCall(`/database/fields/table/${tableId}/`);

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch table schema: ${response.status} - ${errorText.substring(0, 100)}`);
    }

    const fields = await response.json();
    
    return fields.map((field: any) => ({
      id: field.id,
      name: field.name,
      type: field.type,
    }));
  } catch (error) {
    throw error;
  }
};

// Parse CSV file to get headers using stored file content
export const parseFileHeaders = async (file: File): Promise<string[]> => {
  try {
    // Get the uploaded file info from session storage
    const uploadedFileInfo = sessionStorage.getItem('uploadedFileInfo');
    if (!uploadedFileInfo) {
      throw new Error('No uploaded file info found');
    }

    const fileInfo = JSON.parse(uploadedFileInfo);
    
    // Use stored file content instead of fetching from URL
    let content = fileInfo.fullFileContent || fileInfo.fileContent;
    // If we have header-only content, use it directly (it should be sufficient for parsing headers)
    if (fileInfo.isHeaderOnly && content) {
    }
    // If we need to reprocess or content is empty/truncated for large files
    else if (!content || fileInfo.needsReprocessing || fileInfo.requiresFileReupload || (fileInfo.isLargeFile && content.length < 1000)) {
      // Check if we're in a situation where file reupload is required
      if (fileInfo.requiresFileReupload) {
        throw new Error(`${fileInfo.storageWarning || 'Datei zu groß für Browser-Speicher'}\n\nBitte laden Sie eine kleinere Datei hoch oder teilen Sie die Datei auf.`);
      }
      
      // For header parsing, we only need the first few lines, so read from the original file
      try {
        const headerChunk = file.slice(0, 1024 * 1024); // First 1MB should contain headers
        content = await headerChunk.text();
      } catch (fileReadError) {
        // If we have optimized content, try to use it for headers
        if (fileInfo.fileContent && (fileInfo.isOptimized || fileInfo.isHeaderOnly)) {
          content = fileInfo.fileContent;
          // Remove the truncation marker if present
          content = content.replace('\n\n[...CONTENT_TRUNCATED_FOR_STORAGE...]\n\n', '\n');
        } else {
          throw new Error('Keine Dateiinhalte verfügbar für die Spalten-Analyse. Bitte laden Sie die Datei erneut hoch oder verwenden Sie eine kleinere Datei.');
        }
      }
    }
    
    if (!content) {
      throw new Error('No file content found for header parsing');
    }
    if (file.name.toLowerCase().endsWith('.csv') || (fileInfo.file?.mime_type?.includes('csv'))) {
      // Parse CSV
      const lines = content.split('\n');
      if (lines.length > 0) {
        const headers = parseCSVLine(lines[0]);
        return headers.filter(header => header.length > 0);
      } else {
        throw new Error('CSV file appears to be empty');
      }
    } else {
      // Only CSV files are supported
      throw new Error('Only CSV files are supported. Please upload a .csv file.');
    }
  } catch (error) {
    throw error;
  }
};

// Enhanced progress callback interface
interface ProgressInfo {
  current: number;
  total: number;
  percentage: number;
  remaining?: number;
  speed?: number;
  estimatedTimeRemaining?: number;
  currentBatch?: number;
  totalBatches?: number;
  failed?: number;
  processing?: 'bulk' | 'standard' | 'individual';
}

// Process the mapped data and create records in new table with progress callback
export const processImportData = async (
  mappings: Record<string, string>, 
  progressCallback?: (progress: ProgressInfo) => void
): Promise<{ total: number, created: number, updated: number, tableId: string, tableName: string, failed?: number, verified?: number }> => {
  const startTime = performance.now();
  
  // Create new AbortController for this import
  IMPORT_ABORT_CONTROLLER = new AbortController();
  
  try {
    // 🚀 IMMEDIATE PROGRESS FEEDBACK - Show loading state right away
    if (progressCallback) {
      progressCallback({
        current: 0,
        total: 1,
        percentage: 0,
        remaining: 1,
        processing: 'standard',
        currentBatch: 0,
        totalBatches: 1
      });
    }
    
    // For import operations that create tables, we need JWT tokens (username/password)
    // For regular data operations, API tokens are sufficient
    const config = getApiConfig();
    
    if (config.isProxyEnabled) {
    } else {
      // Direct mode - need JWT credentials for table creation
      const hasJwtCredentials = !!(import.meta.env.VITE_BASEROW_USERNAME && import.meta.env.VITE_BASEROW_PASSWORD);
      if (!hasJwtCredentials) {
        throw new Error('Import operations require JWT authentication. Please set VITE_BASEROW_USERNAME and VITE_BASEROW_PASSWORD environment variables.');
      }
    }
    
    // Test JWT token early to catch authentication issues (only in direct mode)
    if (!config.isProxyEnabled) {
      try {
        await getJWTToken();
      } catch (authError) {
        throw new Error(`Authentication failed: ${authError instanceof Error ? authError.message : 'Unknown authentication error'}`);
      }
    }
    
    // Get file content from stored info
    const uploadedFileInfo = sessionStorage.getItem('uploadedFileInfo');
    if (!uploadedFileInfo) {
      throw new Error('No uploaded file info found');
    }

    const fileInfo = JSON.parse(uploadedFileInfo);
    const userData = fileInfo.userData;

    // For large files, we need to fetch the entire file content from the uploaded file URL
    let content: string;
    
    // Check if we have complete content in session storage first
    const storedContent = fileInfo.fullFileContent || fileInfo.fileContent || '';
    const storedLines = storedContent.split(/\r?\n/).filter(line => line.trim());
    
    // Check if file requires reupload due to storage limitations
    if (fileInfo.requiresFileReupload) {
      throw new Error(`${fileInfo.storageWarning || 'Datei zu groß für Browser-Speicher'}\n\nUm den Import durchzuführen, teilen Sie bitte die Datei in kleinere Abschnitte auf (empfohlen: < 20MB pro Datei).`);
    }
    
    // Determine if we need to fetch full content
    let needsFullFetch = false;
    
    // Check if we only have headers but can import from original source
    if (fileInfo.isHeaderOnly && fileInfo.canImportFromOriginal) {
      needsFullFetch = true; // Force full fetch from server
    }
    // Check if we only have headers and cannot import
    else if (fileInfo.isHeaderOnly) {
      throw new Error(`${fileInfo.storageWarning || 'Nur Spalten-Mapping verfügbar'}\n\nFür den vollständigen Import benötigen Sie eine kleinere Datei oder müssen die große Datei in kleinere Abschnitte aufteilen.`);
    }
    
    if (fileInfo.isOptimized) {
      needsFullFetch = true;
    } else if (fileInfo.needsReprocessing) {
      needsFullFetch = true;
    } else if (storedLines.length <= 1000 && fileInfo.totalLines && fileInfo.totalLines > storedLines.length) {
      needsFullFetch = true;
    }
    
    // If we need full content for large files, check temporary storage first
    if (needsFullFetch) {  // ✅ FIXED: Check for ANY file needing full fetch, not just header-only
      if (TEMP_FILE_METADATA) {
      }
      
      // First, check if we have the content in temporary memory
      if (TEMP_FILE_CONTENT && TEMP_FILE_METADATA && TEMP_FILE_METADATA.recordId === fileInfo.recordId) {
        content = TEMP_FILE_CONTENT;
        
        // Clear temporary storage to free memory
        TEMP_FILE_CONTENT = null;
        TEMP_FILE_METADATA = null;
      } else {
        // Use the recovery helper to get full content if possible
        content = await recoverFullFileContentIfNeeded(fileInfo, storedContent);
        
        // Clean up any truncation markers
        content = content.replace(/\n\n\[\.\.\.CONTENT_TRUNCATED_FOR_STORAGE\.\.\.\]\n\n/g, '\n');
        
        const recoveredLines = content.split(/\r?\n/).filter(line => line.trim());
        if (fileInfo.totalLines && recoveredLines.length < fileInfo.totalLines * 0.9) {
        } else {
        }
      }
    } else {
      // Use stored content
      content = storedContent.replace(/\n\n\[\.\.\.CONTENT_TRUNCATED_FOR_STORAGE\.\.\.\]\n\n/g, '\n');
      if (fileInfo.isOptimized) {
      }
    }

    if (!content) {
      // Provide helpful error message about large file handling
      let errorMessage = fileInfo.storageWarning 
        ? `Dateiinhalt nicht verfügbar: ${fileInfo.storageWarning}`
        : 'No file content found and unable to fetch from server';
        
      if (fileInfo.requiresFileReupload) {
        errorMessage += '\n\n🔧 LÖSUNG: Teilen Sie die Datei in kleinere Abschnitte auf (< 20MB pro Datei).';
      } else if (fileInfo.isLargeFile && fileInfo.originalFileSize > 50 * 1024 * 1024) {
        errorMessage += `\n\n📊 Dateigröße: ${(fileInfo.originalFileSize / 1024 / 1024).toFixed(1)}MB\n🔧 EMPFEHLUNG: Verwenden Sie kleinere Dateien (< 20MB) für optimale Performance.`;
      }
        
      throw new Error(errorMessage);
    }
    // Improved line splitting and filtering for very large files
    const lines = content
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && !/^["',\s]*$/.test(line));
    // Check for content truncation and warn user
    if (fileInfo.isOptimized && lines.length < (fileInfo.totalLines || 0)) {
    }
    
    // Show success message for large file processing
    if (fileInfo.originalFileSize > 20 * 1024 * 1024 && lines.length > 10000) {
    }
    
    // Detect truncation markers
    if (content.includes('[...CONTENT_TRUNCATED_FOR_STORAGE...]')) {
    }
    
    if (lines.length < 2) {
      throw new Error('File must have at least a header row and one data row');
    }
    
    const headers = parseCSVLine(lines[0]);
    // Get unique mapped columns
    const mappedColumns = [...new Set(Object.values(mappings).filter(col => col !== 'ignore'))];
    if (mappedColumns.length === 0) {
      throw new Error('No columns mapped for import');
    }
    
    // Always create a new table. Name format: {Firma}_{Zielgruppe}_{YYYY-MM-DD}; ensure uniqueness with suffix.
    const company = (userData.company || '').trim();
    const zielgruppe = (userData.zielgruppe || '').trim();
    const dateStr = new Date().toISOString().slice(0, 10);
    const rawBaseName = `${company}_${zielgruppe}_${dateStr}`.replace(/\s+/g, ' ').trim();
    const baseName = rawBaseName.replace(/\s/g, '_');
    const uniqueName = await getUniqueTableName(baseName);
    const tableId = await createNewTable(uniqueName, mappedColumns);
    // Clean up any default rows that Baserow might have added automatically
    // No need to get token for this as verifyRecordsCreated uses makeApiCall
    const defaultRows = await verifyRecordsCreated(tableId);

    if (defaultRows.length > 0) {
      for (const row of defaultRows) {
        await makeApiCall(`/database/rows/table/${tableId}/${row.id}/`, {
          method: 'DELETE'
        });
      }
    }

    // Update the record in table 787 with the new table ID
  await updateRecordWithTableId(fileInfo.recordId, tableId);
    
    // Get fresh field mappings after table setup
    const fieldMappings = await getFieldMappings(tableId, mappedColumns);
    // For proxy mode, tokens are handled server-side, no need to get JWT token
    const jwtToken = config.isProxyEnabled ? 'PROXY_HANDLED' : await ensureFreshToken();
    
    if (!config.isProxyEnabled) {
    }

    // Process data rows with streaming approach for very large files
    const totalDataRows = lines.length - 1;
    const isVeryLargeFile = totalDataRows > PERFORMANCE_CONFIG.LARGE_FILE_THRESHOLD; // Use parallel processing for files over threshold
    
    // Initialize progress dialog with actual file data immediately
    if (progressCallback && totalDataRows > 0) {
      progressCallback({
        current: 0,
        total: totalDataRows,
        percentage: 0,
        remaining: totalDataRows,
        processing: isVeryLargeFile ? 'bulk' : 'standard',
        currentBatch: 1,
        totalBatches: Math.ceil(totalDataRows / (isVeryLargeFile ? 200 : 200))
      });
    }
    
    let importResults: { attempted: number, created: number, failed: number, failedRecords: any[] };
    
    if (isVeryLargeFile) {
      importResults = await processVeryLargeFileData(lines, headers, mappings, mappedColumns, fieldMappings, tableId, jwtToken, progressCallback);
    } else {
      importResults = await processStandardFileData(lines, headers, mappings, mappedColumns, fieldMappings, tableId, jwtToken, progressCallback);
    }

    // Print comprehensive summary
    if (importResults.failed > 0) {
      const errorCounts: Record<string, number> = {};
      importResults.failedRecords.forEach(failed => {
        const errorKey = failed.error?.substring(0, 100) || 'Unknown error';
        errorCounts[errorKey] = (errorCounts[errorKey] || 0) + 1;
      });
      
      Object.entries(errorCounts).forEach(([error, count]) => {
      });
      
      // Show sample failed record data
      if (importResults.failedRecords.length > 0) {
        const sampleFailed = importResults.failedRecords[0];
      }
    }

    // Reduced delay for faster verification
    await new Promise(resolve => setTimeout(resolve, 500)); // Reduced from 2000ms to 500ms

    // Verify records were actually created
    const verificationRows = await verifyRecordsCreated(tableId);
    if (importResults.created !== verificationRows.length) {
    } else {
    }
    
    const endTime = performance.now();
    const totalTime = ((endTime - startTime) / 1000).toFixed(2);
    // Clean up IndexedDB storage after successful import
    if (isIndexedDBAvailable() && fileInfo.recordId) {
      try {
        await fileStorage.deleteFile(fileInfo.recordId);
      } catch (cleanupError) {
      }
    }
    
    return { 
      total: importResults.attempted, 
      created: importResults.created, 
      updated: 0, 
      tableId, 
  tableName: uniqueName,
      failed: importResults.failed,
      verified: verificationRows.length
    };
  } catch (error) {
    const endTime = performance.now();
    const totalTime = ((endTime - startTime) / 1000).toFixed(2);
    throw error;
  }
};

// Optimized processing for very large files with PARALLEL BATCH PROCESSING! 🚀
const processVeryLargeFileData = async (
  lines: string[], 
  headers: string[], 
  mappings: Record<string, string>, 
  mappedColumns: string[], 
  fieldMappings: Record<string, number>, 
  tableId: string, 
  jwtToken: string,
  progressCallback?: (progress: ProgressInfo) => void
): Promise<{ attempted: number, created: number, failed: number, failedRecords: any[] }> => {
  const startTime = performance.now();
  let attempted = 0;
  let created = 0;
  let totalFailed = 0;
  const allFailedRecords: any[] = [];
  const BATCH_SIZE = PERFORMANCE_CONFIG.BATCH_SIZE; // Baserow's API limit per batch
  const PARALLEL_BATCHES = PERFORMANCE_CONFIG.PARALLEL_BATCHES; // Process multiple batches concurrently!
  
  // First, prepare all data records
  const allRecords: any[] = [];
  for (let i = 1; i < lines.length; i++) {
    // Check for cancellation
    if (IMPORT_ABORT_CONTROLLER?.signal.aborted) {
      throw new Error('Import cancelled by user');
    }
    
    const line = lines[i].trim();

    // Skip empty lines
    if (!line || /^["',\s]*$/.test(line)) {
      continue;
    }

    const values = parseCSVLine(line);
    
    // Skip if all values are empty
    if (values.every(v => !v || (typeof v === 'string' && v.trim() === ''))) {
      continue;
    }

    // Map values to Baserow fields
    const mappedData: any = {};
    let hasValidData = false;

    headers.forEach((header, index) => {
      const cleanHeader = header.trim().replace(/"/g, '');
      const targetColumn = mappings[cleanHeader];

      if (targetColumn && targetColumn !== 'ignore' && values[index] !== undefined) {
        const fieldId = fieldMappings[targetColumn];
        
        // Safety check for missing field mappings
        if (fieldId === undefined) {
          return;
        }
        
        const value = typeof values[index] === 'string' ? values[index].trim() : values[index];

        if (fieldId && value !== '') {
          mappedData[`field_${fieldId}`] = value;
          hasValidData = true;
        }
      }
    });

    if (hasValidData && Object.keys(mappedData).length > 0) {
      allRecords.push(mappedData);
      attempted++;
    }
  }
  // Split records into batches of 200
  const batches: any[][] = [];
  for (let i = 0; i < allRecords.length; i += BATCH_SIZE) {
    batches.push(allRecords.slice(i, i + BATCH_SIZE));
  }
  // Process batches in parallel groups
  for (let i = 0; i < batches.length; i += PARALLEL_BATCHES) {
    // Check for cancellation
    if (IMPORT_ABORT_CONTROLLER?.signal.aborted) {
      throw new Error('Import cancelled by user');
    }

    // Refresh token every 10 batch groups to prevent expiration during very long imports
    if (i > 0 && i % (PARALLEL_BATCHES * 10) === 0) {
      try {
        await ensureFreshToken();
      } catch (tokenError) {
        // Continue with existing token if refresh fails
      }
    }

    // Get the next group of batches to process in parallel
    const currentBatchGroup = batches.slice(i, i + PARALLEL_BATCHES);
    const batchPromises = currentBatchGroup.map(async (batch, batchIndex) => {
      const globalBatchIndex = i + batchIndex + 1;
      try {
        const batchResults = await processBatchRecords(batch, tableId, jwtToken);
        return batchResults;
      } catch (error) {
        return { 
          success: 0, 
          failed: batch.length, 
          failedRecords: batch.map(record => ({ data: record, error: error instanceof Error ? error.message : 'Unknown error' }))
        };
      }
    });

    // Wait for all batches in this group to complete
    const groupResults = await Promise.all(batchPromises);
    
    // Aggregate results
    for (const result of groupResults) {
      created += result.success;
      totalFailed += result.failed;
      allFailedRecords.push(...result.failedRecords);
    }

    // Calculate progress and performance
    const processedRecords = created + totalFailed;
    const percentage = (processedRecords / allRecords.length) * 100;
    const elapsedTime = (performance.now() - startTime) / 1000;
    const recordsPerSecond = processedRecords / Math.max(elapsedTime, 1);
    const remaining = allRecords.length - processedRecords;
    const estimatedRemainingTime = remaining / Math.max(recordsPerSecond, 1);
    // Call progress callback
    if (progressCallback) {
      progressCallback({
        current: processedRecords,
        total: allRecords.length,
        percentage: Math.round(percentage),
        remaining: remaining,
        speed: Math.round(recordsPerSecond),
        estimatedTimeRemaining: Math.round(estimatedRemainingTime),
        currentBatch: Math.min(i + PARALLEL_BATCHES, batches.length),
        totalBatches: batches.length,
        failed: totalFailed,
        processing: 'bulk'
      });
    }

    // Brief pause between parallel groups to be API-friendly
    if (i + PARALLEL_BATCHES < batches.length) {
      await new Promise(resolve => setTimeout(resolve, PERFORMANCE_CONFIG.PAUSE_BETWEEN_GROUPS));
    }
  }

  const endTime = performance.now();
  const totalTime = (endTime - startTime) / 1000;
  return { attempted, created, failed: totalFailed, failedRecords: allFailedRecords };
};

// Standard processing for smaller files
const processStandardFileData = async (
  lines: string[], 
  headers: string[], 
  mappings: Record<string, string>, 
  mappedColumns: string[], 
  fieldMappings: Record<string, number>, 
  tableId: string, 
  jwtToken: string,
  progressCallback?: (progress: ProgressInfo) => void
): Promise<{ attempted: number, created: number, failed: number, failedRecords: any[] }> => {
  const recordsToCreate = [];
  let attempted = 0;
  
  for (let i = 1; i < lines.length; i++) {
    // Check for cancellation
    if (IMPORT_ABORT_CONTROLLER?.signal.aborted) {
      throw new Error('Import cancelled by user');
    }
    
    const line = lines[i].trim();

    if (!line || /^["',\s]*$/.test(line)) {
      continue;
    }

    const values = parseCSVLine(line);
    
    if (values.every(v => !v || (typeof v === 'string' && v.trim() === ''))) {
      continue;
    }

    const mappedData: any = {};

    headers.forEach((header, index) => {
      const cleanHeader = header.trim().replace(/"/g, '');
      const targetColumn = mappings[cleanHeader];

      if (targetColumn && targetColumn !== 'ignore' && values[index] !== undefined) {
        const fieldId = fieldMappings[targetColumn];
        
        // Safety check for missing field mappings
        if (fieldId === undefined) {
          return;
        }
        
        const value = typeof values[index] === 'string' ? values[index].trim() : values[index];

        if (fieldId && value !== '') {
          mappedData[`field_${fieldId}`] = value;
        }
      }
    });

    if (Object.keys(mappedData).length > 0) {
      recordsToCreate.push(mappedData);
      attempted++;
    }
  }
  // Create records in batches with correct batch size for Baserow API
  // Baserow batch API limit is 200 records per batch
  const BATCH_SIZE = 200; // Fixed: Baserow's batch API maximum
  let created = 0;
  let totalFailed = 0;
  const allFailedRecords: any[] = [];
  
  for (let i = 0; i < recordsToCreate.length; i += BATCH_SIZE) {
    const batch = recordsToCreate.slice(i, i + BATCH_SIZE);
    const batchResults = await processBatchRecords(batch, tableId, jwtToken);
    created += batchResults.success;
    totalFailed += batchResults.failed;
    allFailedRecords.push(...batchResults.failedRecords);
    
    const percentage = ((created / recordsToCreate.length) * 100);
    // Call progress callback with detailed information
    if (progressCallback) {
      const remaining = recordsToCreate.length - created;
      const batchNumber = Math.floor(i / BATCH_SIZE) + 1;
      const totalBatches = Math.ceil(recordsToCreate.length / BATCH_SIZE);
      
      progressCallback({
        current: created,
        total: recordsToCreate.length,
        percentage: Math.round(percentage),
        remaining: remaining,
        currentBatch: batchNumber,
        totalBatches: totalBatches,
        failed: totalFailed,
        processing: 'standard'
      });
    }
    
    // Ultra-fast processing - minimal delay between batches
    if (i + BATCH_SIZE < recordsToCreate.length) {
      // Only delay if bulk operations are failing frequently
      if (totalFailed > 0 && (totalFailed / (i + BATCH_SIZE)) > 0.1) {
        await new Promise(resolve => setTimeout(resolve, 25)); // Slow down only if high failure rate
      }
      // No delay for successful bulk operations - maximum speed!
    }
  }

  return { attempted, created, failed: totalFailed, failedRecords: allFailedRecords };
};

// Global flag to track bulk operation failures and batch size  
let BULK_OPERATIONS_DISABLED = false;
let BULK_FAILURE_COUNT = 0;
let CURRENT_BATCH_SIZE = 200; // Start with Baserow's documented limit

// Process a batch of records with enhanced token management
const processBatchRecords = async (batch: any[], tableId: string, jwtToken: string): Promise<{ success: number, failed: number, failedRecords: any[] }> => {
  // Always ensure we have a fresh token for batch operations
  let currentToken: string;
  try {
    currentToken = await ensureFreshToken();
  } catch (tokenError) {
    throw new Error(`Token refresh failed: ${tokenError instanceof Error ? tokenError.message : 'Unknown token error'}`);
  }
  
  // Skip bulk if it's been disabled due to repeated failures
  if (!BULK_OPERATIONS_DISABLED) {
    // Try bulk creation first (much faster)
    try {
      // First, try with user_field_names: true (might allow column names instead of field_IDs)
      let bulkPayload = {
        items: batch,
        user_field_names: true
      };
      
      const bulkResponse = await makeApiCall(`/database/rows/table/${tableId}/batch/`, {
        method: 'POST',
        body: JSON.stringify(bulkPayload),
      });

      if (bulkResponse.ok) {
        const bulkResult = await bulkResponse.json();
        // Reset failure count on success
        BULK_FAILURE_COUNT = 0;
        return { 
          success: batch.length, 
          failed: 0, 
          failedRecords: [] 
        };
      } else {
        const errorText = await bulkResponse.text();
        
        // Handle token expiry specifically
        if (bulkResponse.status === 401) {
          clearJWTTokenCache(); // Clear cache before refresh
          currentToken = await getJWTToken();
          
          // Retry with fresh token
          const retryBulkResponse = await makeApiCall(`/database/rows/table/${tableId}/batch/`, {
            method: 'POST',
            body: JSON.stringify(bulkPayload),
          });
          
          if (retryBulkResponse.ok) {
            const retryBulkResult = await retryBulkResponse.json();
            BULK_FAILURE_COUNT = 0;
            return { 
              success: batch.length, 
              failed: 0, 
              failedRecords: [] 
            };
          }
        }
        // Check if it's a batch size issue
        if (errorText.includes('max_length') || errorText.includes('200 elements')) {
        }
        
        // Try without user_field_names flag
        bulkPayload = { items: batch, user_field_names: false };
        
        const retryResponse = await makeApiCall(`/database/rows/table/${tableId}/batch/`, {
          method: 'POST',
          body: JSON.stringify(bulkPayload),
        });
        
        if (retryResponse.ok) {
          const retryResult = await retryResponse.json();
          BULK_FAILURE_COUNT = 0; // Reset on success
          return { 
            success: batch.length, 
            failed: 0, 
            failedRecords: [] 
          };
        } else {
          const retryErrorText = await retryResponse.text();
          // Check if it's a batch size issue
          if (retryErrorText.includes('max_length') || retryErrorText.includes('200 elements')) {
            if (CURRENT_BATCH_SIZE > 100) {
              CURRENT_BATCH_SIZE = 100;
            }
          }
          
          BULK_FAILURE_COUNT++;
          
          // Disable bulk operations if they fail too many times  
          if (BULK_FAILURE_COUNT >= 3) {
            BULK_OPERATIONS_DISABLED = true;
          }
        }
      }
    } catch (bulkError) {
      BULK_FAILURE_COUNT++;
      if (BULK_FAILURE_COUNT >= 3) {
        BULK_OPERATIONS_DISABLED = true;
      }
    }
  }

  // Fallback to individual creation with MAXIMUM SPEED concurrency
  const CONCURRENT_REQUESTS = 150; // Ultra-high concurrency for maximum speed - browser limit ~150-200
  let successCount = 0;
  let failedCount = 0;
  const failedRecords: any[] = [];
  
  // Process records in concurrent groups
  for (let i = 0; i < batch.length; i += CONCURRENT_REQUESTS) {
    const concurrentBatch = batch.slice(i, i + CONCURRENT_REQUESTS);
    
    const promises = concurrentBatch.map((recordData, index) => 
      createRecordInNewTable(tableId, recordData, currentToken) // Use fresh token
        .then(() => ({ success: true, recordData: null, error: null }))
        .catch(error => {
          return { success: false, recordData, error: error.message };
        })
    );
    
    const results = await Promise.all(promises);
    
    results.forEach(result => {
      if (result.success) {
        successCount++;
      } else {
        failedCount++;
        failedRecords.push({
          data: result.recordData,
          error: result.error || 'Unknown error'
        });
      }
    });
    
    // No delay for ultra-speed - maximum concurrent throughput
    if (i + CONCURRENT_REQUESTS < batch.length) {
      // No delay at all for maximum speed!
    }
  }
  return { success: successCount, failed: failedCount, failedRecords };
};

// Get field mappings (column name to field ID) after table setup
const getFieldMappings = async (tableId: string, columnNames: string[]): Promise<Record<string, number>> => {
  try {
    const response = await makeJWTApiCall(`/database/fields/table/${tableId}/`, {
      method: 'GET'
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(`Failed to fetch updated field mappings: ${errorText}`);
    }

    const fields = await response.json();
    const mappings: Record<string, number> = {};
    
    // Map column names to field IDs
    fields.forEach((field: any) => {
      if (columnNames.includes(field.name)) {
        mappings[field.name] = field.id;
      }
    });
    // Verify we have mappings for all columns
    const missingMappings = columnNames.filter(col => !mappings[col]);
    if (missingMappings.length > 0) {
      throw new Error(`Missing field mappings for columns: ${missingMappings.join(', ')}`);
    }
    
    return mappings;
  } catch (error) {
    throw error;
  }
};

// Helper function to properly parse CSV lines with improved handling for large files
const parseCSVLine = (line: string): string[] => {
  // Handle empty lines
  if (!line || line.trim() === '') {
    return [];
  }
  
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  let i = 0;
  
  while (i < line.length) {
    const char = line[i];
    const nextChar = line[i + 1];
    
    if (char === '"') {
      if (inQuotes && nextChar === '"') {
        // Escaped quote
        current += '"';
        i += 2;
        continue;
      } else {
        // Start or end of quoted field
        inQuotes = !inQuotes;
        i++;
        continue;
      }
    }
    
    if (char === ',' && !inQuotes) {
      // Field separator
      result.push(current.trim());
      current = '';
      i++;
      continue;
    }
    
    // Regular character
    current += char;
    i++;
  }
  
  // Add the last field
  result.push(current.trim());
  
  return result;
};

// Enhanced record creation with robust token refresh
const createRecordInNewTable = async (tableId: string, recordData: any, jwtToken?: string, retryCount = 0) => {
  const MAX_RETRIES = 1; // Allow one retry for token expiration
  
  try {
    const createResponse = await makeApiCall(`/database/rows/table/${tableId}/`, {
      method: 'POST',
      body: JSON.stringify(recordData),
    });
    
    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      
      // Handle token expiry for 401 errors
      if (createResponse.status === 401 && retryCount < MAX_RETRIES) {
        return await createRecordInNewTable(tableId, recordData, jwtToken, retryCount + 1);
      }
      
      throw new Error(`HTTP ${createResponse.status}: ${errorText}`);
    }
    
    return await createResponse.json();
    
  } catch (error) {
    // Only retry on token errors
    if (error instanceof Error && error.message.includes('401') && retryCount < MAX_RETRIES) {
      const freshToken = await getJWTToken();
      return await createRecordInNewTable(tableId, recordData, freshToken, retryCount + 1);
    }
    throw error;
  }
};

// Helper function to verify records were created
export const verifyRecordsCreated = async (tableId: string): Promise<any[]> => {
  try {
    const jwtToken = await getJWTToken();
    const allRecords: any[] = [];
    const LIMIT = 1000;
    const MAX_ITERATIONS = 100; // Safeguard against infinite loops
    let offset = 0;
    let hasMoreRecords = true;
    let iterations = 0;

    while (hasMoreRecords && iterations < MAX_ITERATIONS) {
      const response = await makeApiCall(`/database/rows/table/${tableId}/?limit=${LIMIT}&offset=${offset}`, {
        method: 'GET'
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Failed to fetch table rows: ${errorText}`);
      }

      const data = await response.json();
      const batchRecords = data.results || [];
      
      // Add current batch to all records
      allRecords.push(...batchRecords);
      // Check if we have more records to fetch
      hasMoreRecords = batchRecords.length === LIMIT;
      offset += LIMIT;
      iterations++;
      
      // Small delay between requests to be respectful to the API
      if (hasMoreRecords) {
        await new Promise(resolve => setTimeout(resolve, 100));
      }
    }

    if (iterations >= MAX_ITERATIONS) {
    }
    return allRecords;
  } catch (error) {
    throw error;
  }
};
