interface UploadData {
  vorname: string;
  nachname: string;
  email: string;
  company: string;
  file: File;
}

// Configuration - Load from environment variables for security
const BASEROW_CONFIG = {
  jwtToken: import.meta.env.VITE_BASEROW_JWT_TOKEN || '',
  apiToken: import.meta.env.VITE_BASEROW_API_TOKEN || '',
  tableId: '787',
  targetTableId: '790',
  baseUrl: 'https://baserow.app-inventor.org',
  databaseId: '207',
  // JWT Authentication credentials - Load from environment
  username: import.meta.env.VITE_BASEROW_USERNAME || '',
  password: import.meta.env.VITE_BASEROW_PASSWORD || ''
};

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
const JWT_TOKEN_BUFFER_MS = 5 * 60 * 1000; // Refresh 5 minutes before expiry

// Import cancellation support
let IMPORT_ABORT_CONTROLLER: AbortController | null = null;

// Cancel current import operation
export const cancelImport = () => {
  if (IMPORT_ABORT_CONTROLLER) {
    console.log('🛑 Cancelling import operation...');
    IMPORT_ABORT_CONTROLLER.abort();
    IMPORT_ABORT_CONTROLLER = null;
    
    // Also reset any global state flags that might prevent clean restart
    BULK_OPERATIONS_DISABLED = false;
    BULK_FAILURE_COUNT = 0;
    console.log('✅ Import cancelled and global state reset');
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
    console.log('✅ Current content appears complete, no recovery needed');
    return currentContent;
  }

  console.log('🔄 Content recovery needed - fetching full file content');
  
  // Check if we have the file URL to fetch from
  if (!fileInfo.file?.url) {
    console.warn('⚠️ No file URL available for content recovery');
    console.warn('💡 Using truncated content - this will result in incomplete import');
    return currentContent;
  }

  try {
    console.log('🌐 Fetching full file content via proxy server...');
    
    // Use proxy server to avoid CORS issues
    const proxyBaseUrl = 
      import.meta.env.VITE_PROXY_SERVER_URL || 
      (window.location.hostname === 'localhost' ? 'http://localhost:3001' : 
       `${window.location.protocol}//${window.location.host}`);
    
    const proxyUrl = `${proxyBaseUrl}/api/proxy-baserow-file?url=${encodeURIComponent(fileInfo.file.url)}&token=${encodeURIComponent(BASEROW_CONFIG.apiToken)}`;
    
    // Fetch the full file content via proxy with proper headers and timeout
    const fetchController = new AbortController();
    const timeoutId = setTimeout(() => fetchController.abort(), 300000); // 5 minute timeout
    
    const response = await fetch(proxyUrl, {
      method: 'GET',
      headers: {
        'Accept': 'text/csv,text/plain,application/octet-stream,*/*',
      },
      signal: fetchController.signal
    });

    clearTimeout(timeoutId);

    if (!response.ok) {
      // Try to get error details from proxy response
      let errorDetails = `${response.status} ${response.statusText}`;
      try {
        const errorBody = await response.json();
        errorDetails = errorBody.error || errorDetails;
        
        // Handle specific proxy error codes
        if (errorBody.code === 'DOMAIN_NOT_ALLOWED') {
          throw new Error(`Security: File URL domain is not whitelisted in proxy server`);
        } else if (errorBody.code === 'AUTH_FAILED') {
          throw new Error(`Authentication failed - invalid API token`);
        } else if (errorBody.code === 'FILE_NOT_FOUND') {
          throw new Error(`File not found on Baserow server`);
        } else if (errorBody.code === 'TIMEOUT') {
          throw new Error(`File download timed out - file may be very large`);
        }
      } catch (e) {
        // Response wasn't JSON, use status text
      }
      
      throw new Error(`Proxy request failed: ${errorDetails}`);
    }

    // Get content type to ensure we're handling text correctly
    const contentType = response.headers.get('content-type') || '';

    const fullContent = await response.text();
    const fullLines = fullContent.split(/\r?\n/).filter(line => line.trim());
    
    console.log('✅ Successfully recovered full file content via proxy!');
    
    // Verify that we actually got more content
    if (fullContent.length <= currentContent.length) {
      console.warn('⚠️ Fetched content is not larger than current content - using current content');
      return currentContent;
    }
    
    return fullContent;
    
  } catch (error) {
    console.error('❌ Failed to recover full file content:', error);
    
    // Provide more specific error messages
    if (error instanceof Error) {
      if (error.name === 'AbortError') {
        console.warn('⏰ File recovery timed out - file may be very large');
      } else if (error.message.includes('ECONNREFUSED') || error.message.includes('fetch failed')) {
        console.warn('🔌 Proxy server is not running or unreachable');
        console.warn('💡 Please start the proxy server: npm run proxy:start');
      } else if (error.message.includes('401') || error.message.includes('403')) {
        console.warn('🔐 Authentication failed for file recovery - token may be invalid');
      } else if (error.message.includes('404')) {
        console.warn('📁 File not found on server - it may have been deleted');
      } else if (error.message.includes('Domain not allowed')) {
        console.warn('🚨 Security: File URL domain is not whitelisted in proxy server');
      } else {
        console.warn(`🔧 Network or server error: ${error.message}`);
      }
    }
    
    console.warn('⚠️ Falling back to truncated content - import will be incomplete');
    console.warn('💡 SOLUTION 1: Start proxy server and try again');
    console.warn('💡 SOLUTION 2: Re-upload the file and import immediately without navigating away');
    
    // Return the truncated content as fallback
    return currentContent;
  }
};

// Clear cached JWT token (useful for debugging or manual refresh)
export const clearJWTTokenCache = () => {
  CACHED_JWT_TOKEN = null;
  JWT_TOKEN_EXPIRES_AT = 0;
};

// Check if we have valid authentication credentials
export const validateAuthCredentials = (): boolean => {
  const hasCredentials = !!(BASEROW_CONFIG.username && BASEROW_CONFIG.password);
  if (!hasCredentials) {
    console.error('❌ Missing authentication credentials in environment variables');
  }
  return hasCredentials;
};

// Debug function to check authentication status
export const getAuthStatus = () => {
  const now = Date.now();
  return {
    hasCredentials: !!(BASEROW_CONFIG.username && BASEROW_CONFIG.password),
    hasCachedToken: !!CACHED_JWT_TOKEN,
    tokenExpiresAt: new Date(JWT_TOKEN_EXPIRES_AT).toISOString(),
    tokenExpiresIn: Math.max(0, JWT_TOKEN_EXPIRES_AT - now),
    isTokenExpired: JWT_TOKEN_EXPIRES_AT <= (now + JWT_TOKEN_BUFFER_MS),
    username: BASEROW_CONFIG.username ? `${BASEROW_CONFIG.username.substring(0, 3)}***` : 'NOT_SET',
    hasPassword: !!BASEROW_CONFIG.password,
    tokenCacheStatus: {
      cached: !!CACHED_JWT_TOKEN,
      expiresInMinutes: Math.round(Math.max(0, JWT_TOKEN_EXPIRES_AT - now) / 60000),
      willExpireSoon: JWT_TOKEN_EXPIRES_AT <= (now + JWT_TOKEN_BUFFER_MS),
      bufferMinutes: JWT_TOKEN_BUFFER_MS / 60000
    }
  };
};

// Enhanced debugging function to log token status before operations
const logTokenStatus = (operation: string) => {
  const status = getAuthStatus();
  // Only log if there are issues
  if (status.isTokenExpired || status.tokenCacheStatus.willExpireSoon) {
    console.log(`🔍 Token Status before ${operation}:`, {
      hasCachedToken: status.hasCachedToken,
      expiresInMinutes: status.tokenCacheStatus.expiresInMinutes,
      willExpireSoon: status.tokenCacheStatus.willExpireSoon,
      isExpired: status.isTokenExpired
    });
  }
};

// Function to get a fresh JWT token
// Function to get a fresh JWT token with caching for performance
const getJWTToken = async (): Promise<string> => {
  try {
    // Check if we have a valid cached token
    const now = Date.now();
    if (CACHED_JWT_TOKEN && JWT_TOKEN_EXPIRES_AT > (now + JWT_TOKEN_BUFFER_MS)) {
      return CACHED_JWT_TOKEN;
    }

    console.log('🔑 Fetching fresh JWT token...');
    
    // Validate that we have credentials
    if (!BASEROW_CONFIG.username || !BASEROW_CONFIG.password) {
      throw new Error('Missing authentication credentials. Please check VITE_BASEROW_USERNAME and VITE_BASEROW_PASSWORD environment variables.');
    }
    
    const response = await fetch(`${BASEROW_CONFIG.baseUrl}/api/user/token-auth/`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        username: BASEROW_CONFIG.username,
        password: BASEROW_CONFIG.password,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('JWT authentication failed:', errorText);
      
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
    
    // Cache the token with expiry (JWT tokens typically last 1 hour = 3600 seconds)
    CACHED_JWT_TOKEN = data.token;
    JWT_TOKEN_EXPIRES_AT = now + (3600 * 1000); // 1 hour from now
    
    return CACHED_JWT_TOKEN;
  } catch (error) {
    console.error('Error getting JWT token:', error);
    // Clear cached token on error
    CACHED_JWT_TOKEN = null;
    JWT_TOKEN_EXPIRES_AT = 0;
    
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Authentication failed');
  }
};

export const uploadToBaserow = async (data: UploadData): Promise<void> => {
  try {
    console.log('Starting upload process for file:', data.file.name);
    
    // Clear any previous temporary file storage
    TEMP_FILE_CONTENT = null;
    TEMP_FILE_METADATA = null;
    
    // Check for existing record first
    const existingRecord = await findExistingRecord(data.vorname, data.nachname, data.email, data.company);
    
    if (existingRecord) {
      // Update existing record and delete old table if exists
      console.log('Found existing record, updating instead of creating new one');
      
      // Delete old table if it exists - with safety check
      if ('CreatedTableId' in existingRecord && existingRecord.CreatedTableId) {
        await deleteTable(existingRecord.CreatedTableId);
      }
      
      const updateResponse = await fetch(`${BASEROW_CONFIG.baseUrl}/api/database/rows/table/${BASEROW_CONFIG.tableId}/${existingRecord.id}/?user_field_names=true`, {
        method: 'PATCH',
        headers: {
          'Authorization': `Token ${BASEROW_CONFIG.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          Vorname: data.vorname,
          Nachname: data.nachname,
          EMAIL: data.email,
          Company: data.company,
          Dateiname: data.file.name,
          CreatedTableId: null, // Will be updated after new table creation
        }),
      });

      if (!updateResponse.ok) {
        throw new Error('Failed to update existing record');
      }

      const updateResult = await updateResponse.json();
      console.log('Successfully updated existing record:', updateResult);
      
        // Store file info for mapping page - process file in chunks for large files
        try {
          const fileContent = await processFileForStorage(data.file); // Use storage-optimized processing
          
          // For very large files, store only header information instead of full content
          const isLargeFile = data.file.size > 10 * 1024 * 1024; // 10MB threshold
          let contentToStore = fileContent;
          
          const fileInfo = {
            file: { url: existingRecord.Datei?.[0]?.url || '' },
            userData: data,
            fileName: data.file.name,
            fileContent: contentToStore,
            recordId: existingRecord.id,
          isLargeFile: isLargeFile,
          originalFileSize: data.file.size,
          fullFileContent: fileContent // Always store full content as backup
        };
        
        try {
          const fileInfoString = JSON.stringify(fileInfo);
          
          // Clear any existing file info to free up storage space
          sessionStorage.removeItem('uploadedFileInfo');
          
          sessionStorage.setItem('uploadedFileInfo', fileInfoString);
        } catch (storageError) {
          // Use same fallback strategy as new records
          const lines = fileContent.split('\n');
          let optimizedContent = '';
          
          if (lines.length > 2000) {
            const headerLines = lines.slice(0, 1000).join('\n');
            const footerLines = lines.slice(-100).join('\n');
            optimizedContent = headerLines + '\n\n[...CONTENT_TRUNCATED_FOR_STORAGE...]\n\n' + footerLines;
          } else {
            optimizedContent = fileContent;
          }
          
          const optimizedFileInfo = {
            ...fileInfo,
            fileContent: optimizedContent,
            isOptimized: lines.length > 2000,
            totalLines: lines.length
          };
          
          try {
            sessionStorage.setItem('uploadedFileInfo', JSON.stringify(optimizedFileInfo));
            
            // 🆕 CRITICAL: Store complete file content in temporary memory for existing record optimized path
            if (data.file.size > 10 * 1024 * 1024 && typeof fileContent === 'string') {
              TEMP_FILE_CONTENT = fileContent; // Store the COMPLETE content, not optimized
              TEMP_FILE_METADATA = {
                name: data.file.name,
                size: data.file.size,
                recordId: existingRecord.id
              };
            }
            
            if (lines.length > 2000) {
              console.warn('⚠️ Large existing file content was truncated for storage.');
            }
          } catch (finalError) {
            // Ultra-minimal storage: Only headers + metadata (for column mapping only)
            const headerOnlyContent = lines.slice(0, 5).join('\n'); // Just first 5 lines for headers
            
            const ultraMinimalFileInfo = {
              file: fileInfo.file,
              userData: fileInfo.userData,
              fileName: fileInfo.fileName,
              fileContent: headerOnlyContent, // Only headers
              recordId: fileInfo.recordId,
              isLargeFile: true,
              originalFileSize: fileInfo.originalFileSize,
              needsReprocessing: true,
              isHeaderOnly: true, // Flag to indicate only headers available
              totalLines: lines.length,
              canImportFromOriginal: true, // 🆕 Flag to indicate we can reprocess from original data
              storageWarning: `Große Datei (${(fileInfo.originalFileSize / 1024 / 1024).toFixed(1)}MB) - Spalten-Mapping verfügbar, Import verarbeitet komplette Datei neu.`
            };
            
            try {
              sessionStorage.setItem('uploadedFileInfo', JSON.stringify(ultraMinimalFileInfo));
              
              // 🆕 CRITICAL: Store complete file content in temporary memory for existing records too  
              if (data.file.size > 10 * 1024 * 1024 && typeof fileContent === 'string') { // 10MB threshold
                TEMP_FILE_CONTENT = fileContent;
                TEMP_FILE_METADATA = {
                  name: data.file.name,
                  size: data.file.size,
                  recordId: existingRecord.id
                };
              }
            } catch (emergencyError) {
              
              // Absolute last resort: Store without any content
              const emergencyFileInfo = {
                file: fileInfo.file,
                userData: fileInfo.userData,
                fileName: fileInfo.fileName,
                fileContent: '', // No content
                recordId: fileInfo.recordId,
                isLargeFile: true,
                originalFileSize: fileInfo.originalFileSize,
                needsReprocessing: true,
                requiresFileReupload: true, // Flag indicating file must be re-uploaded
                storageWarning: `Datei zu groß für Browser-Speicher (${(fileInfo.originalFileSize / 1024 / 1024).toFixed(1)}MB). Bitte verwenden Sie eine kleinere Datei.`
              };
              
              sessionStorage.setItem('uploadedFileInfo', JSON.stringify(emergencyFileInfo));
            }
          }
        }
        
      } catch (processingError) {
        console.error('Error processing file content:', processingError);
        throw new Error('Fehler beim Verarbeiten der Datei. Die Datei ist möglicherweise zu groß oder beschädigt.');
      }
      
      return;
    }

    // First, upload the file to Baserow with timeout handling
    console.log('Uploading file to Baserow...');
    const fileFormData = new FormData();
    fileFormData.append('file', data.file);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 120000); // Reduced from 5 minutes to 2 minutes

    try {
      const fileUploadResponse = await fetch(`${BASEROW_CONFIG.baseUrl}/api/user-files/upload-file/`, {
        method: 'POST',
        headers: {
          'Authorization': `Token ${BASEROW_CONFIG.apiToken}`,
        },
        body: fileFormData,
        signal: controller.signal,
      });

      clearTimeout(timeoutId);

      if (!fileUploadResponse.ok) {
        const errorText = await fileUploadResponse.text();
        console.error('File upload failed:', errorText);
        throw new Error(`Datei-Upload fehlgeschlagen: ${errorText}`);
      }

      const fileUploadResult = await fileUploadResponse.json();
      console.log('File uploaded successfully:', fileUploadResult);
      
      // Process file in chunks for large files with error handling
      console.log('Processing file content for storage...');
      let fileContent = '';
      try {
        fileContent = await processFileForStorage(data.file); // Use storage-optimized processing
        console.log('File content processed successfully, length:', fileContent.length);
      } catch (processingError) {
        console.error('Error processing file content:', processingError);
        throw new Error('Fehler beim Verarbeiten der Datei. Die Datei ist möglicherweise zu groß oder beschädigt.');
      }
      
      // Then, create a row in the table with the form data and file reference
      console.log('Creating database record...');
      const rowData = {
        Vorname: data.vorname,
        Nachname: data.nachname,
        EMAIL: data.email,
        Company: data.company,
        Datei: [fileUploadResult],
        Dateiname: data.file.name,
        CreatedTableId: null, // Will be updated after table creation
      };

      const rowResponse = await fetch(`${BASEROW_CONFIG.baseUrl}/api/database/rows/table/${BASEROW_CONFIG.tableId}/?user_field_names=true`, {
        method: 'POST',
        headers: {
          'Authorization': `Token ${BASEROW_CONFIG.apiToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(rowData),
      });

      if (!rowResponse.ok) {
        const errorText = await rowResponse.text();
        console.error('Row creation failed:', errorText);
        console.error('Response status:', rowResponse.status);
        throw new Error(`Datensatz konnte nicht erstellt werden: ${errorText}`);
      }

      const rowResult = await rowResponse.json();
      console.log('Successfully created row:', rowResult);
      
      // Store file info in session for the mapping page with size check
      const isLargeFile = data.file.size > 10 * 1024 * 1024; // 10MB threshold
      let contentToStore = fileContent;
      
      if (isLargeFile) {
        console.log('Large file detected, but storing full content for processing...');
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
            
            // 🆕 IMPORTANT: Store complete file content in temporary memory even for optimized storage
            if (data.file.size > 10 * 1024 * 1024) { // 10MB threshold
              TEMP_FILE_CONTENT = fileContent; // Store the COMPLETE file content, not the optimized version
              TEMP_FILE_METADATA = {
                name: data.file.name,
                size: data.file.size,
                recordId: rowResult.id
              };
            }
            
            if (lines.length > 2000) {
              console.warn('⚠️ Large file content was truncated for storage. Column mapping will work, but full import may re-process file.');
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
              
              // 🆕 For very large files, store content in temporary global variable to bypass storage limits
              if (data.file.size > 10 * 1024 * 1024) { // 10MB threshold
                TEMP_FILE_CONTENT = fileContent;
                TEMP_FILE_METADATA = {
                  name: data.file.name,
                  size: data.file.size,
                  recordId: rowResult.id
                };
              }
              
              // Show user-friendly info about large file processing
              if (data.file.size > 50 * 1024 * 1024) { // 50MB
                console.warn(`� LARGE FILE INFO: File size (${(data.file.size / 1024 / 1024).toFixed(2)}MB) will be processed during import.`);
                console.warn('⚡ PERFORMANCE: Import may take longer due to file size, but all data will be processed.');
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
        console.error('Error in storage handling:', storageError);
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
    console.error('Baserow upload error:', error);
    
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
        console.error('Error processing chunk:', chunkError);
        throw new Error(`Fehler beim Verarbeiten von Chunk ${i + 1}. Die Datei ist möglicherweise beschädigt.`);
      }
    }
    
    console.log(`✅ Successfully processed file: ${(processedSize / 1024 / 1024).toFixed(2)}MB`);
    return content;
    
  } catch (error) {
    console.error('Error in processFileInChunks:', error);
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
  console.log('🔄 Processing file for import - ensuring full content...');
  
  const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB chunks
  let content = '';
  let processedSize = 0;
  const maxFileSize = 500 * 1024 * 1024; // 500MB limit
  
  if (file.size > maxFileSize) {
    throw new Error(`Datei zu groß (${(file.size / 1024 / 1024).toFixed(2)}MB). Maximale Größe: ${maxFileSize / 1024 / 1024}MB`);
  }
  
  console.log(`Processing FULL file for import: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)}MB)`);
  
  // Always use streaming for import to handle large files
  if (file.size > 50 * 1024 * 1024) {
    console.log('Using streaming approach for large file import');
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
      
      console.log(`Import processing chunk ${i + 1}/${chunks.length}: ${(processedSize / 1024 / 1024).toFixed(2)}MB / ${(file.size / 1024 / 1024).toFixed(2)}MB`);
      
      if (i < chunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 5));
      }
    } catch (chunkError) {
      console.error('Error processing chunk for import:', chunkError);
      throw new Error(`Fehler beim Verarbeiten von Chunk ${i + 1} für Import.`);
    }
  }
  
  console.log(`✅ Successfully processed FULL file for import: ${(processedSize / 1024 / 1024).toFixed(2)}MB`);
  return content;
};

// Streaming approach for very large files with explicit UTF-8 decoding
const processLargeFileStreaming = async (file: File): Promise<string> => {
  const STREAM_CHUNK_SIZE = 1024 * 1024; // 1MB streaming chunks
  let content = '';
  let totalProcessed = 0;
  
  console.log('Processing large file with streaming approach');
  
  return new Promise((resolve, reject) => {
    try {
      const reader = file.stream().getReader();
      const decoder = new TextDecoder('utf-8'); // Explicitly use UTF-8
      
      const processStream = async () => {
        try {
          while (true) {
            const { done, value } = await reader.read();
            
            if (done) {
              console.log(`Streaming complete. Total processed: ${(totalProcessed / 1024 / 1024).toFixed(2)}MB`);
              resolve(content);
              break;
            }
            
            const chunk = decoder.decode(value, { stream: true });
            content += chunk;
            totalProcessed += value.length;
            
            // Log progress every 10MB
            if (totalProcessed % (10 * 1024 * 1024) < value.length) {
              console.log(`Streaming progress: ${(totalProcessed / 1024 / 1024).toFixed(2)}MB processed`);
            }
            
            // Minimal delay to prevent blocking
            await new Promise(resolve => setTimeout(resolve, 1)); // Reduced from 10ms to 1ms
          }
        } catch (error) {
          console.error('Error in streaming:', error);
          reject(new Error('Fehler beim Streaming der Datei. Die Datei ist möglicherweise beschädigt.'));
        }
      };
      
      processStream();
    } catch (error) {
      console.error('Error setting up stream:', error);
      reject(new Error('Fehler beim Einrichten des Datei-Streams.'));
    }
  });
};

// Helper function to find existing records
const findExistingRecord = async (vorname: string, nachname: string, email: string, company: string) => {
  try {
    const response = await fetch(`${BASEROW_CONFIG.baseUrl}/api/database/rows/table/${BASEROW_CONFIG.tableId}/?user_field_names=true`, {
      headers: {
        'Authorization': `Token ${BASEROW_CONFIG.apiToken}`,
      },
    });

    if (!response.ok) {
      return null;
    }

    const data = await response.json();
    const existingRecord = data.results?.find((row: any) => 
      row.Vorname?.toLowerCase() === vorname.toLowerCase() &&
      row.Nachname?.toLowerCase() === nachname.toLowerCase() &&
      row.EMAIL?.toLowerCase() === email.toLowerCase() &&
      row.Company?.toLowerCase() === company.toLowerCase()
    );

    return existingRecord || null;
  } catch (error) {
    console.error('Error checking for existing records:', error);
    return null;
  }
};

// Create a new table using fresh JWT token with retry logic
export const createNewTable = async (tableName: string, columns: string[]): Promise<string> => {
  let attempt = 0;
  const maxAttempts = 2;
  
  while (attempt < maxAttempts) {
    try {
      // Log token status before operation
      logTokenStatus('table creation');
      
      // Get fresh JWT token for each attempt
      console.log(`🔑 Getting JWT token for table creation (attempt ${attempt + 1}/${maxAttempts})`);
      const jwtToken = await getJWTToken();
      
      // Create table structure
      const tableData = {
        name: tableName
      };

      console.log('Creating table with name:', tableName);
      const tableResponse = await fetch(`${BASEROW_CONFIG.baseUrl}/api/database/tables/database/${BASEROW_CONFIG.databaseId}/`, {
        method: 'POST',
        headers: {
          'Authorization': `JWT ${jwtToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(tableData),
      });

      if (!tableResponse.ok) {
        const errorText = await tableResponse.text();
        console.error('Table creation failed:', errorText);
        console.error('Response status:', tableResponse.status);
        
        // If it's a 401 (token expired) and we haven't retried yet, clear cache and retry
        if (tableResponse.status === 401 && attempt < maxAttempts - 1) {
          console.log('🔄 Token expired during table creation, clearing cache and retrying...');
          CACHED_JWT_TOKEN = null;
          JWT_TOKEN_EXPIRES_AT = 0;
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
      console.log('Table created successfully:', tableResult);

      // Minimal wait for table creation
      await new Promise(resolve => setTimeout(resolve, 50)); // Reduced from 150ms to 50ms

      // Handle the primary "Name" field and create other columns
      await setupTableColumns(tableResult.id, columns, jwtToken);

      return tableResult.id.toString();
      
    } catch (error) {
      console.error(`Error creating table (attempt ${attempt + 1}):`, error);
      
      // If it's a token-related error and we can retry, continue
      if (error instanceof Error && 
          (error.message.includes('Authentication failed') || error.message.includes('expired')) && 
          attempt < maxAttempts - 1) {
        console.log('🔄 Retrying table creation due to authentication error...');
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
  
  const refreshTokenIfNeeded = async (response: Response) => {
    if (response.status === 401) {
      console.log('🔄 Token expired during column setup, getting fresh token...');
      CACHED_JWT_TOKEN = null;
      JWT_TOKEN_EXPIRES_AT = 0;
      jwtToken = await getJWTToken();
      return true;
    }
    return false;
  };
  
  try {
    console.log('Setting up table columns for table:', tableId, 'with columns:', columns);
    
    // Get current table fields
    let fieldsResponse = await fetch(`${BASEROW_CONFIG.baseUrl}/api/database/fields/table/${tableId}/`, {
      headers: {
        'Authorization': `JWT ${jwtToken}`,
      },
    });

    if (!fieldsResponse.ok) {
      const wasRefreshed = await refreshTokenIfNeeded(fieldsResponse);
      if (wasRefreshed) {
        // Retry with fresh token
        fieldsResponse = await fetch(`${BASEROW_CONFIG.baseUrl}/api/database/fields/table/${tableId}/`, {
          headers: {
            'Authorization': `JWT ${jwtToken}`,
          },
        });
      }
      
      if (!fieldsResponse.ok) {
        throw new Error('Failed to fetch table fields');
      }
    }

    const fields = await fieldsResponse.json();
    console.log('Current table fields:', fields);
    
    // Find the primary field (cannot be deleted, must exist)
    const primaryField = fields.find((field: any) => field.primary === true);
    
    if (primaryField && columns.length > 0) {
      // Rename the primary field to the first CSV column
      console.log(`Renaming primary field ${primaryField.name} to ${columns[0]}`);
      
      let renameResponse = await fetch(`${BASEROW_CONFIG.baseUrl}/api/database/fields/${primaryField.id}/`, {
        method: 'PATCH',
        headers: {
          'Authorization': `JWT ${jwtToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: columns[0]
        }),
      });

      if (!renameResponse.ok) {
        const wasRefreshed = await refreshTokenIfNeeded(renameResponse);
        if (wasRefreshed) {
          // Retry with fresh token
          renameResponse = await fetch(`${BASEROW_CONFIG.baseUrl}/api/database/fields/${primaryField.id}/`, {
            method: 'PATCH',
            headers: {
              'Authorization': `JWT ${jwtToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({
              name: columns[0]
            }),
          });
        }
      }

      if (renameResponse.ok) {
        console.log('Successfully renamed primary field to:', columns[0]);
      } else {
        const errorText = await renameResponse.text();
        console.error('Failed to rename primary field:', errorText);
        throw new Error(`Failed to rename primary field: ${errorText}`);
      }
      
      // Minimal wait after rename
      await new Promise(resolve => setTimeout(resolve, 25)); // Reduced from 100ms to 25ms
    }

    // Delete any other default fields (but not the primary one)
    for (const field of fields) {
      if (field.id !== primaryField?.id && (field.name === 'Notes' || field.name === 'Active')) {
        console.log(`Deleting default field: ${field.name}`);
        
        let deleteResponse = await fetch(`${BASEROW_CONFIG.baseUrl}/api/database/fields/${field.id}/`, {
          method: 'DELETE',
          headers: {
            'Authorization': `JWT ${jwtToken}`,
          },
        });
        
        if (!deleteResponse.ok) {
          const wasRefreshed = await refreshTokenIfNeeded(deleteResponse);
          if (wasRefreshed) {
            // Retry with fresh token
            deleteResponse = await fetch(`${BASEROW_CONFIG.baseUrl}/api/database/fields/${field.id}/`, {
              method: 'DELETE',
              headers: {
                'Authorization': `JWT ${jwtToken}`,
              },
            });
          }
        }
        
        if (deleteResponse.ok) {
          console.log('Successfully deleted field:', field.name);
        } else {
          const errorText = await deleteResponse.text();
          console.log('Could not delete field (expected for some default fields):', field.name, errorText);
        }
        
        await new Promise(resolve => setTimeout(resolve, 25)); // Reduced from 100ms to 25ms
      }
    }

    // Create remaining columns (skip the first one since we renamed the primary field to it)
    for (let i = 1; i < columns.length; i++) {
      const columnName = columns[i];
      console.log(`Creating column: ${columnName}`);
      
      await createTableColumn(tableId, columnName, jwtToken);
      // Wait between column creations
    }

    // Minimal wait for field operations
    console.log('Waiting briefly for all field operations to complete...');
    await new Promise(resolve => setTimeout(resolve, 50)); // Reduced from 200ms to 50ms
    
  } catch (error) {
    console.error('Error setting up table columns:', error);
    throw error;
  }
};

// Create a column in the table with token refresh support
const createTableColumn = async (tableId: string, columnName: string, initialJwtToken: string) => {
  let jwtToken = initialJwtToken;
  
  try {
    console.log(`Creating column: ${columnName} in table ${tableId}`);
    
    const columnData = {
      name: columnName,
      type: 'text'
    };

    let columnResponse = await fetch(`${BASEROW_CONFIG.baseUrl}/api/database/fields/table/${tableId}/`, {
      method: 'POST',
      headers: {
        'Authorization': `JWT ${jwtToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(columnData),
    });

    if (!columnResponse.ok) {
      // Check if it's a token issue
      if (columnResponse.status === 401) {
        console.log('🔄 Token expired during column creation, getting fresh token...');
        CACHED_JWT_TOKEN = null;
        JWT_TOKEN_EXPIRES_AT = 0;
        jwtToken = await getJWTToken();
        
        // Retry with fresh token
        columnResponse = await fetch(`${BASEROW_CONFIG.baseUrl}/api/database/fields/table/${tableId}/`, {
          method: 'POST',
          headers: {
            'Authorization': `JWT ${jwtToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(columnData),
        });
      }
      
      if (!columnResponse.ok) {
        const errorText = await columnResponse.text();
        console.error('Column creation failed for:', columnName, errorText);
        throw new Error(`Failed to create column: ${columnName} - ${errorText}`);
      }
    }
    
    const result = await columnResponse.json();
    console.log('Successfully created column:', columnName, 'with ID:', result.id);
    return result.id;
  } catch (error) {
    console.error('Error creating column:', columnName, error);
    throw error;
  }
};

// Delete a table using fresh JWT token
const deleteTable = async (tableId: string) => {
  try {
    const jwtToken = await getJWTToken();
    
    const response = await fetch(`${BASEROW_CONFIG.baseUrl}/api/database/tables/${tableId}/`, {
      method: 'DELETE',
      headers: {
        'Authorization': `JWT ${jwtToken}`,
      },
    });

    if (response.ok) {
      console.log('Old table deleted successfully:', tableId);
    }
  } catch (error) {
    console.error('Error deleting table:', error);
  }
};

// Update record with created table ID
const updateRecordWithTableId = async (recordId: number, tableId: string) => {
  try {
    const response = await fetch(`${BASEROW_CONFIG.baseUrl}/api/database/rows/table/${BASEROW_CONFIG.tableId}/${recordId}/?user_field_names=true`, {
      method: 'PATCH',
      headers: {
        'Authorization': `Token ${BASEROW_CONFIG.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        CreatedTableId: tableId,
      }),
    });

    if (!response.ok) {
      console.error('Failed to update record with table ID');
    }
  } catch (error) {
    console.error('Error updating record with table ID:', error);
  }
};

// Get table schema from Baserow
export const getTableSchema = async (tableId: string) => {
  try {
    const response = await fetch(`${BASEROW_CONFIG.baseUrl}/api/database/fields/table/${tableId}/`, {
      headers: {
        'Authorization': `Token ${BASEROW_CONFIG.apiToken}`,
      },
    });

    if (!response.ok) {
      throw new Error('Failed to fetch table schema');
    }

    const fields = await response.json();
    return fields.map((field: any) => ({
      id: field.id,
      name: field.name,
      type: field.type,
    }));
  } catch (error) {
    console.error('Error fetching table schema:', error);
    throw error;
  }
};

// Parse CSV/Excel file to get headers using stored file content
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
    
    console.log(`📊 HEADER PARSING - Content Analysis:`);
    console.log(`Has fullFileContent: ${!!fileInfo.fullFileContent}`);
    console.log(`Has fileContent: ${!!fileInfo.fileContent}`);
    console.log(`Content length: ${content?.length || 0} characters`);
    console.log(`Is optimized storage: ${!!fileInfo.isOptimized}`);
    console.log(`Is header-only storage: ${!!fileInfo.isHeaderOnly}`);
    console.log(`Requires file reupload: ${!!fileInfo.requiresFileReupload}`);
    console.log(`Total lines in file: ${fileInfo.totalLines || 'unknown'}`);
    console.log(`Storage warning: ${fileInfo.storageWarning || 'none'}`);
    
    // If we have header-only content, use it directly (it should be sufficient for parsing headers)
    if (fileInfo.isHeaderOnly && content) {
      console.log('✅ Using header-only content for column parsing');
      console.log(`Header-only content preview: ${content.substring(0, 200)}`);
    }
    // If we need to reprocess or content is empty/truncated for large files
    else if (!content || fileInfo.needsReprocessing || fileInfo.requiresFileReupload || (fileInfo.isLargeFile && content.length < 1000)) {
      console.log('🔄 Content missing or incomplete, attempting to get headers from original file...');
      
      // Check if we're in a situation where file reupload is required
      if (fileInfo.requiresFileReupload) {
        throw new Error(`${fileInfo.storageWarning || 'Datei zu groß für Browser-Speicher'}\n\nBitte laden Sie eine kleinere Datei hoch oder teilen Sie die Datei auf.`);
      }
      
      // For header parsing, we only need the first few lines, so read from the original file
      try {
        console.log('📖 Reading header chunk from original file object...');
        const headerChunk = file.slice(0, 1024 * 1024); // First 1MB should contain headers
        content = await headerChunk.text();
        console.log('✅ Successfully read headers from original file chunk');
        console.log(`Header chunk length: ${content.length} characters`);
      } catch (fileReadError) {
        console.error('❌ Failed to read from original file:', fileReadError.message);
        
        // If we have optimized content, try to use it for headers
        if (fileInfo.fileContent && (fileInfo.isOptimized || fileInfo.isHeaderOnly)) {
          console.log('🔄 Falling back to stored content for headers...');
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

    console.log('📝 Header content preview:', content.substring(0, 200));
    
    if (file.name.toLowerCase().endsWith('.csv') || (fileInfo.file?.mime_type?.includes('csv'))) {
      // Parse CSV
      const lines = content.split('\n');
      if (lines.length > 0) {
        const headers = parseCSVLine(lines[0]);
        console.log('Parsed headers:', headers);
        return headers.filter(header => header.length > 0);
      } else {
        throw new Error('CSV file appears to be empty');
      }
    } else {
      // For Excel files, we'll need a more sophisticated approach
      // For now, let's assume the user will upload CSV files
      throw new Error('Excel files not yet supported for header parsing');
    }
  } catch (error) {
    console.error('Error parsing file headers:', error);
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
    console.log('🚀 ULTRA-FAST IMPORT PROCESS STARTED');
    console.log('Starting import process with mappings:', mappings);
    
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
    
    // Validate authentication credentials before starting
    if (!validateAuthCredentials()) {
      throw new Error('Missing authentication credentials. Please check your environment variables (VITE_BASEROW_USERNAME and VITE_BASEROW_PASSWORD).');
    }
    
    // Test JWT token early to catch authentication issues
    console.log('🔑 Validating authentication...');
    try {
      await getJWTToken();
      console.log('✅ Authentication validated successfully');
    } catch (authError) {
      console.error('❌ Authentication failed:', authError);
      throw new Error(`Authentication failed: ${authError instanceof Error ? authError.message : 'Unknown authentication error'}`);
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
      console.log('🔄 HEADER-ONLY MODE: Will fetch full content from server for complete import');
      needsFullFetch = true; // Force full fetch from server
    }
    // Check if we only have headers and cannot import
    else if (fileInfo.isHeaderOnly) {
      console.warn('🚨 HEADER-ONLY MODE: Only column mapping available, full import requires file reprocessing');
      throw new Error(`${fileInfo.storageWarning || 'Nur Spalten-Mapping verfügbar'}\n\nFür den vollständigen Import benötigen Sie eine kleinere Datei oder müssen die große Datei in kleinere Abschnitte aufteilen.`);
    }
    
    if (fileInfo.isOptimized) {
      console.log('🔍 Optimized storage detected - content was truncated for storage');
      needsFullFetch = true;
    } else if (fileInfo.needsReprocessing) {
      console.log('🔍 Reprocessing flag set - content may be incomplete');
      needsFullFetch = true;
    } else if (storedLines.length <= 1000 && fileInfo.totalLines && fileInfo.totalLines > storedLines.length) {
      console.log('� Stored lines count suggests truncation');
      needsFullFetch = true;
    }
    
    // If we need full content for large files, check temporary storage first
    if (needsFullFetch) {  // ✅ FIXED: Check for ANY file needing full fetch, not just header-only
      console.log('🔄 Large file detected - checking temporary storage for full content');
      console.log(`🔄 DEBUG: needsFullFetch=${needsFullFetch}, isHeaderOnly=${fileInfo.isHeaderOnly}, isOptimized=${fileInfo.isOptimized}`);
      console.log(`🔄 DEBUG: TEMP_FILE_CONTENT exists: ${!!TEMP_FILE_CONTENT}`);
      console.log(`🔄 DEBUG: TEMP_FILE_METADATA exists: ${!!TEMP_FILE_METADATA}`);
      console.log(`🔄 DEBUG: TEMP_FILE_CONTENT length: ${TEMP_FILE_CONTENT?.length || 0}`);
      if (TEMP_FILE_METADATA) {
        console.log(`🔄 DEBUG: TEMP recordId: ${TEMP_FILE_METADATA.recordId}, fileInfo recordId: ${fileInfo.recordId}`);
      }
      
      // First, check if we have the content in temporary memory
      if (TEMP_FILE_CONTENT && TEMP_FILE_METADATA && TEMP_FILE_METADATA.recordId === fileInfo.recordId) {
        console.log('✅ Found complete file content in temporary memory!');
        console.log(`📊 Using ${(TEMP_FILE_CONTENT.length / 1024 / 1024).toFixed(2)}MB from temporary storage`);
        content = TEMP_FILE_CONTENT;
        
        // Clear temporary storage to free memory
        TEMP_FILE_CONTENT = null;
        TEMP_FILE_METADATA = null;
        console.log('🧹 Cleared temporary file storage');
      } else {
        // Use the recovery helper to get full content if possible
        console.log('🔄 Attempting to recover full file content...');
        content = await recoverFullFileContentIfNeeded(fileInfo, storedContent);
        
        // Clean up any truncation markers
        content = content.replace(/\n\n\[\.\.\.CONTENT_TRUNCATED_FOR_STORAGE\.\.\.\]\n\n/g, '\n');
        
        const recoveredLines = content.split(/\r?\n/).filter(line => line.trim());
        if (fileInfo.totalLines && recoveredLines.length < fileInfo.totalLines * 0.9) {
          console.warn(`⚠️ WARNING: Only ${recoveredLines.length} of ${fileInfo.totalLines} total lines available`);
          console.warn('💡 SOLUTION: For complete import of very large files, re-upload and import immediately without navigating away.');
        } else {
          console.log(`✅ Content recovery successful: ${recoveredLines.length} lines available for import`);
        }
      }
    } else {
      // Use stored content
      content = storedContent.replace(/\n\n\[\.\.\.CONTENT_TRUNCATED_FOR_STORAGE\.\.\.\]\n\n/g, '\n');
      console.log('✅ Using stored content');
      
      if (fileInfo.isOptimized) {
        console.warn('⚠️ Using optimized (truncated) content. Import may be incomplete.');
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
    
    console.log('Processing file content with length:', content.length);
    
    // Improved line splitting and filtering for very large files
    const lines = content
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && !/^["',\s]*$/.test(line));

    console.log('📊 DETAILED FILE ANALYSIS:');
    console.log(`Raw content length: ${content.length} characters`);
    console.log(`Total lines after processing: ${lines.length}`);
    console.log(`First few characters: "${content.substring(0, 100)}..."`);
    console.log(`Sample lines count check - Line 999: ${lines[999] ? 'EXISTS' : 'MISSING'}`);
    console.log(`Sample lines count check - Line 1000: ${lines[1000] ? 'EXISTS' : 'MISSING'}`);
    console.log(`Sample lines count check - Line 1500: ${lines[1500] ? 'EXISTS' : 'MISSING'}`);
    
    // Check for content truncation and warn user
    if (fileInfo.isOptimized && lines.length < (fileInfo.totalLines || 0)) {
      console.warn('⚠️ CONTENT TRUNCATION DETECTED');
      console.warn(`📊 Processing ${lines.length} lines out of ${fileInfo.totalLines} total lines`);
      console.warn('💡 This may result in incomplete import. Consider using smaller file chunks.');
    }
    
    // Show success message for large file processing
    if (fileInfo.originalFileSize > 20 * 1024 * 1024 && lines.length > 10000) {
      console.log(`🎉 SUCCESS: Large file (${(fileInfo.originalFileSize / 1024 / 1024).toFixed(1)}MB, ${lines.length.toLocaleString()} lines) loaded successfully!`);
      console.log('⚡ Import will process all data - this may take a few minutes for very large files.');
    }
    
    // Detect truncation markers
    if (content.includes('[...CONTENT_TRUNCATED_FOR_STORAGE...]')) {
      console.warn('⚠️ File content contains truncation markers - some data may be missing');
    }
    
    if (lines.length < 2) {
      throw new Error('File must have at least a header row and one data row');
    }
    
    const headers = parseCSVLine(lines[0]);
    console.log('Parsed headers:', headers);
    
    // Get unique mapped columns
    const mappedColumns = [...new Set(Object.values(mappings).filter(col => col !== 'ignore'))];
    console.log('Mapped columns for new table:', mappedColumns);
    
    if (mappedColumns.length === 0) {
      throw new Error('No columns mapped for import');
    }
    
    // Always create a new table for each import to avoid column conflicts and data clearing overhead
    console.log('� Creating new table (fresh import approach)...');
    
    // Delete any existing table first to clean up old data
    const existingRecord = await findExistingRecord(userData.vorname, userData.nachname, userData.email, userData.company);
    if (existingRecord && existingRecord.CreatedTableId) {
      console.log('🗑️ Deleting previous table to make space for new import...');
      await deleteTable(existingRecord.CreatedTableId);
    }
    
    // Create new table with current timestamp for uniqueness
    const tableName = `${userData.company}_${userData.vorname}_${userData.nachname}_${new Date().toISOString().slice(0, 16).replace('T', '_').replace(':', '-')}`;
    console.log('📋 Creating new table with name:', tableName);
    
    const tableId = await createNewTable(tableName, mappedColumns);
    console.log('✅ Table created with ID:', tableId);
    
    // Clean up any default rows that Baserow might have added automatically
    const cleanupToken = await getJWTToken();
    const defaultRows = await verifyRecordsCreated(tableId);

    if (defaultRows.length > 0) {
      console.warn(`🚨 Found ${defaultRows.length} default rows – cleaning up...`);
      for (const row of defaultRows) {
        await fetch(`${BASEROW_CONFIG.baseUrl}/api/database/rows/table/${tableId}/${row.id}/`, {
          method: 'DELETE',
          headers: {
            'Authorization': `JWT ${cleanupToken}`
          }
        });
      }
      console.log(`✅ Deleted ${defaultRows.length} default rows from new table`);
    }

    // Update the record in table 787 with the new table ID
    await updateRecordWithTableId(fileInfo.recordId, tableId);
    
    // Get fresh field mappings after table setup
    const fieldMappings = await getFieldMappings(tableId, mappedColumns);
    console.log('Field mappings after table setup:', fieldMappings);
    
    // Get fresh JWT token for record creation
    const jwtToken = await getJWTToken();

    // Process data rows with streaming approach for very large files
    console.log('Starting to import', lines.length - 1, 'data rows');
    
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
      console.log(`🚀 Large file detected (${totalDataRows} rows) - using PARALLEL BATCH processing with ${PERFORMANCE_CONFIG.PARALLEL_BATCHES} concurrent batches`);
      importResults = await processVeryLargeFileData(lines, headers, mappings, mappedColumns, fieldMappings, tableId, jwtToken, progressCallback);
    } else {
      console.log(`📋 Standard file processing (${totalDataRows} rows) - using sequential processing`);
      importResults = await processStandardFileData(lines, headers, mappings, mappedColumns, fieldMappings, tableId, jwtToken, progressCallback);
    }

    // Print comprehensive summary
    console.log('\n🎯 IMPORT SUMMARY:');
    console.log(`📊 Attempted: ${importResults.attempted}`);
    console.log(`✅ Created: ${importResults.created}`);
    console.log(`❌ Failed: ${importResults.failed}`);
    
    if (importResults.failed > 0) {
      console.log('\n🔍 FAILURE ANALYSIS:');
      const errorCounts: Record<string, number> = {};
      importResults.failedRecords.forEach(failed => {
        const errorKey = failed.error?.substring(0, 100) || 'Unknown error';
        errorCounts[errorKey] = (errorCounts[errorKey] || 0) + 1;
      });
      
      Object.entries(errorCounts).forEach(([error, count]) => {
        console.log(`  • ${error}: ${count} records`);
      });
      
      // Show sample failed record data
      if (importResults.failedRecords.length > 0) {
        console.log('\n🔍 Sample failed record:');
        const sampleFailed = importResults.failedRecords[0];
        console.log(`  Data: ${JSON.stringify(sampleFailed.data).substring(0, 200)}...`);
        console.log(`  Error: ${sampleFailed.error}`);
      }
    }

    // Reduced delay for faster verification
    console.log('\n⏳ Waiting 0.5 seconds for Baserow to flush data...');
    await new Promise(resolve => setTimeout(resolve, 500)); // Reduced from 2000ms to 500ms

    // Verify records were actually created
    console.log('Verifying records were created...');
    const verificationRows = await verifyRecordsCreated(tableId);
    
    console.log(`\n🔍 VERIFICATION RESULTS:`);
    console.log(`Import reported created: ${importResults.created}`);
    console.log(`Verification found: ${verificationRows.length}`);
    
    if (importResults.created !== verificationRows.length) {
      console.warn(`⚠️  MISMATCH: Expected ${importResults.created}, but found ${verificationRows.length} records!`);
    } else {
      console.log(`✅ SUCCESS: All ${importResults.created} records verified successfully!`);
    }
    
    const endTime = performance.now();
    const totalTime = ((endTime - startTime) / 1000).toFixed(2);
    console.log(`\n⚡ TOTAL IMPORT TIME: ${totalTime} seconds`);
    console.log(`📊 SPEED: ${(importResults.created / parseFloat(totalTime)).toFixed(1)} records/second`);
    
    return { 
      total: importResults.attempted, 
      created: importResults.created, 
      updated: 0, 
      tableId, 
      tableName,
      failed: importResults.failed,
      verified: verificationRows.length
    };
  } catch (error) {
    const endTime = performance.now();
    const totalTime = ((endTime - startTime) / 1000).toFixed(2);
    console.error(`💥 IMPORT FAILED after ${totalTime} seconds`);
    console.error('Error processing import data:', error);
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
  console.log('🚀 Processing very large file with PARALLEL BATCH approach');
  
  const startTime = performance.now();
  let attempted = 0;
  let created = 0;
  let totalFailed = 0;
  const allFailedRecords: any[] = [];
  const BATCH_SIZE = PERFORMANCE_CONFIG.BATCH_SIZE; // Baserow's API limit per batch
  const PARALLEL_BATCHES = PERFORMANCE_CONFIG.PARALLEL_BATCHES; // Process multiple batches concurrently!
  
  // First, prepare all data records
  const allRecords: any[] = [];
  
  console.log('📊 Preparing records for parallel processing...');
  for (let i = 1; i < lines.length; i++) {
    // Check for cancellation
    if (IMPORT_ABORT_CONTROLLER?.signal.aborted) {
      console.log('🛑 Import cancelled by user during preparation');
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
          console.warn(`Warning: Field mapping not found for column "${targetColumn}". Skipping this column.`);
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

  console.log(`✅ Prepared ${allRecords.length} records for import`);
  console.log(`🚀 Starting PARALLEL batch processing with ${PARALLEL_BATCHES} concurrent batches`);

  // Split records into batches of 200
  const batches: any[][] = [];
  for (let i = 0; i < allRecords.length; i += BATCH_SIZE) {
    batches.push(allRecords.slice(i, i + BATCH_SIZE));
  }

  console.log(`📦 Created ${batches.length} batches of up to ${BATCH_SIZE} records each`);

  // Process batches in parallel groups
  for (let i = 0; i < batches.length; i += PARALLEL_BATCHES) {
    // Check for cancellation
    if (IMPORT_ABORT_CONTROLLER?.signal.aborted) {
      console.log('🛑 Import cancelled by user during parallel processing');
      throw new Error('Import cancelled by user');
    }

    // Get the next group of batches to process in parallel
    const currentBatchGroup = batches.slice(i, i + PARALLEL_BATCHES);
    const batchPromises = currentBatchGroup.map(async (batch, batchIndex) => {
      const globalBatchIndex = i + batchIndex + 1;
      console.log(`� Processing batch ${globalBatchIndex}/${batches.length} (${batch.length} records) in parallel...`);
      
      try {
        const batchResults = await processBatchRecords(batch, tableId, jwtToken);
        console.log(`✅ Batch ${globalBatchIndex} completed: ${batchResults.success} created, ${batchResults.failed} failed`);
        return batchResults;
      } catch (error) {
        console.error(`❌ Batch ${globalBatchIndex} failed:`, error);
        return { 
          success: 0, 
          failed: batch.length, 
          failedRecords: batch.map(record => ({ data: record, error: error instanceof Error ? error.message : 'Unknown error' }))
        };
      }
    });

    // Wait for all batches in this group to complete
    console.log(`⏳ Processing ${currentBatchGroup.length} batches in parallel...`);
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

    console.log(`📈 Progress: ${created} created, ${totalFailed} failed (${percentage.toFixed(1)}% complete)`);
    console.log(`⚡ Speed: ${Math.round(recordsPerSecond)} records/second`);
    
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
  console.log(`🎉 PARALLEL PROCESSING COMPLETE!`);
  console.log(`⚡ Total time: ${totalTime.toFixed(2)} seconds`);
  console.log(`🚀 Average speed: ${Math.round(created / totalTime)} records/second`);
  console.log(`📊 Peak throughput: ~${PARALLEL_BATCHES * BATCH_SIZE} records processed concurrently`);

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
  console.log('Processing with standard approach');
  
  const recordsToCreate = [];
  let attempted = 0;
  
  for (let i = 1; i < lines.length; i++) {
    // Check for cancellation
    if (IMPORT_ABORT_CONTROLLER?.signal.aborted) {
      console.log('🛑 Import cancelled by user during standard file processing');
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
          console.warn(`Warning: Field mapping not found for column "${targetColumn}". Skipping this column.`);
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

  console.log(`📊 Total records to create: ${attempted}`);

  // Create records in batches with correct batch size for Baserow API
  // Baserow batch API limit is 200 records per batch
  const BATCH_SIZE = 200; // Fixed: Baserow's batch API maximum
  let created = 0;
  let totalFailed = 0;
  const allFailedRecords: any[] = [];
  
  for (let i = 0; i < recordsToCreate.length; i += BATCH_SIZE) {
    const batch = recordsToCreate.slice(i, i + BATCH_SIZE);
    console.log(`🚀 Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(recordsToCreate.length / BATCH_SIZE)}...`);
    
    const batchResults = await processBatchRecords(batch, tableId, jwtToken);
    created += batchResults.success;
    totalFailed += batchResults.failed;
    allFailedRecords.push(...batchResults.failedRecords);
    
    const percentage = ((created / recordsToCreate.length) * 100);
    console.log(`📈 Progress: ${created}/${recordsToCreate.length} created, ${totalFailed} failed (${percentage.toFixed(1)}%)`);
    
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

// Process a batch of records with true bulk operations for maximum speed
const processBatchRecords = async (batch: any[], tableId: string, jwtToken: string): Promise<{ success: number, failed: number, failedRecords: any[] }> => {
  console.log(`🚀 Processing batch of ${batch.length} records with ${BULK_OPERATIONS_DISABLED ? 'individual (bulk disabled)' : 'bulk'} operation...`);
  
  // Check if token might be expired and refresh if needed
  const now = Date.now();
  let currentToken = jwtToken;
  if (JWT_TOKEN_EXPIRES_AT <= (now + JWT_TOKEN_BUFFER_MS)) {
    console.log('🔄 JWT token close to expiry, refreshing...');
    try {
      currentToken = await getJWTToken();
      console.log('✅ Token refreshed successfully for batch processing');
    } catch (tokenError) {
      console.error('❌ Failed to refresh token for batch processing:', tokenError);
      throw new Error(`Token refresh failed: ${tokenError instanceof Error ? tokenError.message : 'Unknown token error'}`);
    }
  }
  
  // Skip bulk if it's been disabled due to repeated failures
  if (!BULK_OPERATIONS_DISABLED) {
    console.log('Sample record for bulk API:', JSON.stringify(batch[0], null, 2));
    
    // Try bulk creation first (much faster)
    try {
      // First, try with user_field_names: true (might allow column names instead of field_IDs)
      let bulkPayload = {
        items: batch,
        user_field_names: true
      };
      
      const bulkResponse = await fetch(`${BASEROW_CONFIG.baseUrl}/api/database/rows/table/${tableId}/batch/`, {
        method: 'POST',
        headers: {
          'Authorization': `JWT ${currentToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(bulkPayload),
      });

      if (bulkResponse.ok) {
        const bulkResult = await bulkResponse.json();
        console.log(`✅ Bulk creation successful: ${batch.length} records created`);
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
          console.warn('🔑 Token expired during bulk operation, getting fresh token...');
          currentToken = await getJWTToken();
          
          // Retry with fresh token
          const retryBulkResponse = await fetch(`${BASEROW_CONFIG.baseUrl}/api/database/rows/table/${tableId}/batch/`, {
            method: 'POST',
            headers: {
              'Authorization': `JWT ${currentToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(bulkPayload),
          });
          
          if (retryBulkResponse.ok) {
            const retryBulkResult = await retryBulkResponse.json();
            console.log(`✅ Bulk creation successful after token refresh: ${batch.length} records created`);
            BULK_FAILURE_COUNT = 0;
            return { 
              success: batch.length, 
              failed: 0, 
              failedRecords: [] 
            };
          }
        }
        
        console.warn(`⚠️ Bulk creation failed (${bulkResponse.status}): ${errorText}`);
        
        // Check if it's a batch size issue
        if (errorText.includes('max_length') || errorText.includes('200 elements')) {
          console.warn('🔍 Detected batch size limit issue - this batch is too large');
          console.warn(`📊 Current batch size: ${batch.length} records`);
          console.warn('💡 Will fall back to individual processing for this batch');
        }
        
        // Try without user_field_names flag
        console.log('Retrying bulk operation without user_field_names flag...');
        bulkPayload = { items: batch, user_field_names: false };
        
        const retryResponse = await fetch(`${BASEROW_CONFIG.baseUrl}/api/database/rows/table/${tableId}/batch/`, {
          method: 'POST',
          headers: {
            'Authorization': `JWT ${currentToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(bulkPayload),
        });
        
        if (retryResponse.ok) {
          const retryResult = await retryResponse.json();
          console.log(`✅ Bulk creation successful on retry: ${batch.length} records created`);
          BULK_FAILURE_COUNT = 0; // Reset on success
          return { 
            success: batch.length, 
            failed: 0, 
            failedRecords: [] 
          };
        } else {
          const retryErrorText = await retryResponse.text();
          console.warn(`⚠️ Bulk creation retry also failed (${retryResponse.status}): ${retryErrorText}`);
          
          // Check if it's a batch size issue
          if (retryErrorText.includes('max_length') || retryErrorText.includes('200 elements')) {
            console.warn('🔍 Detected batch size limit issue - bulk operations may need smaller batches');
            if (CURRENT_BATCH_SIZE > 100) {
              CURRENT_BATCH_SIZE = 100;
              console.warn(`📉 Reducing batch size to ${CURRENT_BATCH_SIZE} for future batches`);
            }
          }
          
          BULK_FAILURE_COUNT++;
          
          // Disable bulk operations if they fail too many times  
          if (BULK_FAILURE_COUNT >= 3) {
            BULK_OPERATIONS_DISABLED = true;
            console.warn(`🚫 Bulk operations disabled after ${BULK_FAILURE_COUNT} failures. Switching to individual processing for remaining batches.`);
          }
        }
      }
    } catch (bulkError) {
      console.warn('⚠️ Bulk creation error, falling back to individual creation:', bulkError.message);
      BULK_FAILURE_COUNT++;
      if (BULK_FAILURE_COUNT >= 3) {
        BULK_OPERATIONS_DISABLED = true;
        console.warn(`🚫 Bulk operations disabled after ${BULK_FAILURE_COUNT} failures.`);
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
          console.error(`❌ Failed record ${i + index + 1}:`, error.message);
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
  
  console.log(`✅ Individual creation complete: ${successCount} successful, ${failedCount} failed`);
  return { success: successCount, failed: failedCount, failedRecords };
};

// Get field mappings (column name to field ID) after table setup
const getFieldMappings = async (tableId: string, columnNames: string[]): Promise<Record<string, number>> => {
  try {
    console.log('Fetching field mappings for table:', tableId, 'columns:', columnNames);
    const jwtToken = await getJWTToken();
    
    const response = await fetch(`${BASEROW_CONFIG.baseUrl}/api/database/fields/table/${tableId}/`, {
      headers: {
        'Authorization': `JWT ${jwtToken}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error('Failed to fetch field mappings:', errorText);
      throw new Error(`Failed to fetch updated field mappings: ${errorText}`);
    }

    const fields = await response.json();
    console.log('Current table fields for mapping:', fields);
    
    const mappings: Record<string, number> = {};
    
    // Map column names to field IDs
    fields.forEach((field: any) => {
      if (columnNames.includes(field.name)) {
        mappings[field.name] = field.id;
        console.log(`Mapped column "${field.name}" to field ID ${field.id}`);
      }
    });
    
    console.log('Final field mappings:', mappings);
    
    // Verify we have mappings for all columns
    const missingMappings = columnNames.filter(col => !mappings[col]);
    if (missingMappings.length > 0) {
      console.error('Missing field mappings for columns:', missingMappings);
      throw new Error(`Missing field mappings for columns: ${missingMappings.join(', ')}`);
    }
    
    return mappings;
  } catch (error) {
    console.error('Error getting field mappings:', error);
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

// Ultra-fast record creation with optimized retry handling
const createRecordInNewTable = async (tableId: string, recordData: any, jwtToken: string, retryCount = 0) => {
  const MAX_RETRIES = 0; // No retries for maximum speed
  
  try {
    const createResponse = await fetch(`${BASEROW_CONFIG.baseUrl}/api/database/rows/table/${tableId}/`, {
      method: 'POST',
      headers: {
        'Authorization': `JWT ${jwtToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(recordData),
    });
    
    if (!createResponse.ok) {
      const errorText = await createResponse.text();
      
      // Only handle token expiry for 401 errors - skip other retries for speed
      if (createResponse.status === 401 && retryCount === 0) {
        console.log('🔑 Token expired in individual creation, getting fresh token...');
        const freshToken = await getJWTToken();
        return await createRecordInNewTable(tableId, recordData, freshToken, 1);
      }
      
      throw new Error(`HTTP ${createResponse.status}: ${errorText}`);
    }
    
    return await createResponse.json();
    
  } catch (error) {
    throw error; // No retries for maximum speed
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
      console.log(`Fetching records batch ${iterations + 1} (offset: ${offset}, limit: ${LIMIT})...`);
      
      const response = await fetch(`${BASEROW_CONFIG.baseUrl}/api/database/rows/table/${tableId}/?limit=${LIMIT}&offset=${offset}`, {
        headers: {
          'Authorization': `JWT ${jwtToken}`,
        },
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error('Failed to fetch table rows:', errorText);
        throw new Error(`Failed to fetch table rows: ${errorText}`);
      }

      const data = await response.json();
      const batchRecords = data.results || [];
      
      // Add current batch to all records
      allRecords.push(...batchRecords);
      
      console.log(`Fetched ${batchRecords.length} rows in this batch. Total fetched so far: ${allRecords.length} rows`);
      
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
      console.warn(`⚠️ Maximum iterations (${MAX_ITERATIONS}) reached. There might be more records to fetch.`);
    }

    console.log(`✅ Verification complete. Total records retrieved from table ${tableId}: ${allRecords.length}`);
    return allRecords;
  } catch (error) {
    console.error('Error verifying records:', error);
    throw error;
  }
};
