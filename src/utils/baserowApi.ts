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
  apiToken: import.meta.env.VITE_BASEROW_API_TOKEN || 'ZDLLQU57ljuMiGEwKk5DPaAjBXwFLwxR',
  tableId: '787',
  targetTableId: '790',
  baseUrl: 'https://baserow.app-inventor.org',
  databaseId: '207',
  // JWT Authentication credentials - Load from environment
  username: import.meta.env.VITE_BASEROW_USERNAME || 'hgu@xiller.com',
  password: import.meta.env.VITE_BASEROW_PASSWORD || 'fEifpCnv5HpKVVv'
};

// Function to get a fresh JWT token
const getJWTToken = async (): Promise<string> => {
  try {
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
      throw new Error('Failed to authenticate');
    }

    const data = await response.json();
    console.log('Successfully obtained JWT token');
    return data.token;
  } catch (error) {
    console.error('Error getting JWT token:', error);
    throw new Error('Authentication failed');
  }
};

export const uploadToBaserow = async (data: UploadData): Promise<void> => {
  try {
    console.log('Starting upload process for file:', data.file.name, 'Size:', (data.file.size / 1024 / 1024).toFixed(2), 'MB');
    
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
        console.log('Processing file content for existing record...');
        const fileContent = await processFileInChunks(data.file);
        
        // For very large files, store only header information instead of full content
        const isLargeFile = data.file.size > 10 * 1024 * 1024; // 10MB threshold
        let contentToStore = fileContent;
        
        if (isLargeFile) {
          console.log('Large file detected, storing only headers and preview...');
          const lines = fileContent.split('\n');
          // Store only first 1000 lines for large files to avoid session storage issues
          contentToStore = lines.slice(0, 1000).join('\n');
        }
        
        const fileInfo = {
          file: { url: existingRecord.Datei?.[0]?.url || '' },
          userData: data,
          fileName: data.file.name,
          fileContent: contentToStore,
          recordId: existingRecord.id,
          isLargeFile: isLargeFile,
          originalFileSize: data.file.size
        };
        
        try {
          sessionStorage.setItem('uploadedFileInfo', JSON.stringify(fileInfo));
          console.log('File info stored successfully for existing record');
        } catch (storageError) {
          console.error('Session storage error:', storageError);
          // Even if storage fails, we can continue - we'll re-process the file later
          sessionStorage.setItem('uploadedFileInfo', JSON.stringify({
            ...fileInfo,
            fileContent: fileContent.substring(0, 50000), // Store only first 50KB
            needsReprocessing: true
          }));
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
    const timeoutId = setTimeout(() => controller.abort(), 300000); // 5 minute timeout

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
      console.log('Processing file content...');
      let fileContent = '';
      try {
        fileContent = await processFileInChunks(data.file);
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
        console.log('Large file detected, storing only headers and preview...');
        const lines = fileContent.split('\n');
        // Store only first 1000 lines for large files to avoid session storage issues
        contentToStore = lines.slice(0, 1000).join('\n');
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
        const fileInfoString = JSON.stringify(fileInfo);
        // Check if the data is too large for session storage (usually ~5-10MB limit)
        if (fileInfoString.length > 5 * 1024 * 1024) { // 5MB limit
          console.warn('File content too large for session storage, storing minimal info...');
          // Store a minimal version
          const minimalFileInfo = {
            file: fileUploadResult,
            userData: data,
            fileName: data.file.name,
            fileContent: fileContent.substring(0, 50000), // First 50KB only
            recordId: rowResult.id,
            isLargeFile: true,
            originalFileSize: data.file.size,
            needsReprocessing: true
          };
          sessionStorage.setItem('uploadedFileInfo', JSON.stringify(minimalFileInfo));
        } else {
          sessionStorage.setItem('uploadedFileInfo', fileInfoString);
        }
        console.log('File info stored in session storage');
      } catch (storageError) {
        console.error('Error storing file info in session storage:', storageError);
        // Store absolute minimum required for navigation
        const emergencyFileInfo = {
          file: fileUploadResult,
          userData: data,
          fileName: data.file.name,
          fileContent: '', // Empty content - will need to reprocess
          recordId: rowResult.id,
          isLargeFile: true,
          originalFileSize: data.file.size,
          needsReprocessing: true
        };
        try {
          sessionStorage.setItem('uploadedFileInfo', JSON.stringify(emergencyFileInfo));
          console.log('Stored emergency file info');
        } catch (emergencyError) {
          console.error('Even emergency storage failed:', emergencyError);
          throw new Error('Fehler beim Speichern der Datei-Informationen. Die Datei ist zu groß für den Browser-Speicher.');
        }
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
const processFileInChunks = async (file: File): Promise<string> => {
  const CHUNK_SIZE = 5 * 1024 * 1024; // 5MB chunks for better performance with large files
  let content = '';
  let processedSize = 0;
  const maxFileSize = 500 * 1024 * 1024; // Increased to 500MB limit for very large files
  
  try {
    if (file.size > maxFileSize) {
      throw new Error(`Datei zu groß (${(file.size / 1024 / 1024).toFixed(2)}MB). Maximale Größe: ${maxFileSize / 1024 / 1024}MB`);
    }
    
    console.log(`Starting to process file: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)}MB)`);
    
    // For very large files, process only what we need for headers + some sample data
    if (file.size > 100 * 1024 * 1024) { // 100MB threshold for limited processing
      console.log('Very large file detected, processing only essential parts...');
      
      // Read only the first 10MB for headers and sample data
      const essentialChunk = file.slice(0, 10 * 1024 * 1024);
      const essentialContent = await essentialChunk.text();
      
      console.log(`Processed essential content: ${(essentialChunk.size / 1024 / 1024).toFixed(2)}MB`);
      return essentialContent;
    }
    
    // For large files, use streaming
    if (file.size > 50 * 1024 * 1024) { // 50MB threshold for streaming
      console.log('Large file detected, using streaming approach');
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
        
        console.log(`Processed chunk ${i + 1}/${chunks.length}: ${(processedSize / 1024 / 1024).toFixed(2)}MB / ${(file.size / 1024 / 1024).toFixed(2)}MB`);
        
        // Add small delay between chunks for stability
        if (i < chunks.length - 1) {
          await new Promise(resolve => setTimeout(resolve, 25));
        }
      } catch (chunkError) {
        console.error('Error processing chunk:', chunkError);
        throw new Error(`Fehler beim Verarbeiten von Chunk ${i + 1}. Die Datei ist möglicherweise beschädigt.`);
      }
    }
    
    console.log(`Successfully processed ${(processedSize / 1024 / 1024).toFixed(2)}MB of ${(file.size / 1024 / 1024).toFixed(2)}MB file`);
    return content;
    
  } catch (error) {
    console.error('Error in processFileInChunks:', error);
    if (error instanceof Error) {
      throw error;
    }
    throw new Error('Unbekannter Fehler beim Verarbeiten der Datei.');
  }
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
            
            // Small delay to prevent blocking
            await new Promise(resolve => setTimeout(resolve, 10));
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

// Create a new table using fresh JWT token
export const createNewTable = async (tableName: string, columns: string[]): Promise<string> => {
  try {
    // Get fresh JWT token
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
      throw new Error('Tabelle konnte nicht erstellt werden');
    }

    const tableResult = await tableResponse.json();
    console.log('Table created successfully:', tableResult);

    // Wait for table to be fully created (increased for larger files)
    await new Promise(resolve => setTimeout(resolve, 300));

    // Handle the primary "Name" field and create other columns
    await setupTableColumns(tableResult.id, columns, jwtToken);

    return tableResult.id.toString();
  } catch (error) {
    console.error('Error creating table:', error);
    throw error;
  }
};

// Setup table columns - rename primary field and create others
const setupTableColumns = async (tableId: string, columns: string[], jwtToken: string) => {
  try {
    console.log('Setting up table columns for table:', tableId, 'with columns:', columns);
    
    // Get current table fields
    const fieldsResponse = await fetch(`${BASEROW_CONFIG.baseUrl}/api/database/fields/table/${tableId}/`, {
      headers: {
        'Authorization': `JWT ${jwtToken}`,
      },
    });

    if (!fieldsResponse.ok) {
      throw new Error('Failed to fetch table fields');
    }

    const fields = await fieldsResponse.json();
    console.log('Current table fields:', fields);
    
    // Find the primary field (cannot be deleted, must exist)
    const primaryField = fields.find((field: any) => field.primary === true);
    
    if (primaryField && columns.length > 0) {
      // Rename the primary field to the first CSV column
      console.log(`Renaming primary field ${primaryField.name} to ${columns[0]}`);
      
      const renameResponse = await fetch(`${BASEROW_CONFIG.baseUrl}/api/database/fields/${primaryField.id}/`, {
        method: 'PATCH',
        headers: {
          'Authorization': `JWT ${jwtToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          name: columns[0]
        }),
      });

      if (renameResponse.ok) {
        console.log('Successfully renamed primary field to:', columns[0]);
      } else {
        const errorText = await renameResponse.text();
        console.error('Failed to rename primary field:', errorText);
        throw new Error(`Failed to rename primary field: ${errorText}`);
      }
      
      // Wait after rename (increased for stability)
      await new Promise(resolve => setTimeout(resolve, 200));
    }

    // Delete any other default fields (but not the primary one)
    for (const field of fields) {
      if (field.id !== primaryField?.id && (field.name === 'Notes' || field.name === 'Active')) {
        console.log(`Deleting default field: ${field.name}`);
        
        const deleteResponse = await fetch(`${BASEROW_CONFIG.baseUrl}/api/database/fields/${field.id}/`, {
          method: 'DELETE',
          headers: {
            'Authorization': `JWT ${jwtToken}`,
          },
        });
        
        if (deleteResponse.ok) {
          console.log('Successfully deleted field:', field.name);
        } else {
          const errorText = await deleteResponse.text();
          console.log('Could not delete field (expected for some default fields):', field.name, errorText);
        }
        
        await new Promise(resolve => setTimeout(resolve, 200));
      }
    }

    // Create remaining columns (skip the first one since we renamed the primary field to it)
    for (let i = 1; i < columns.length; i++) {
      const columnName = columns[i];
      console.log(`Creating column: ${columnName}`);
      
      await createTableColumn(tableId, columnName, jwtToken);
      // Wait between column creations
    }

    // Extra wait to ensure all field operations are complete (increased for large files)
    console.log('Waiting extra time for all field operations to complete...');
    await new Promise(resolve => setTimeout(resolve, 500));
    
  } catch (error) {
    console.error('Error setting up table columns:', error);
    throw error;
  }
};

// Create a column in the table
const createTableColumn = async (tableId: string, columnName: string, jwtToken: string) => {
  try {
    console.log(`Creating column: ${columnName} in table ${tableId}`);
    
    const columnData = {
      name: columnName,
      type: 'text'
    };

    const columnResponse = await fetch(`${BASEROW_CONFIG.baseUrl}/api/database/fields/table/${tableId}/`, {
      method: 'POST',
      headers: {
        'Authorization': `JWT ${jwtToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(columnData),
    });

    if (!columnResponse.ok) {
      const errorText = await columnResponse.text();
      console.error('Column creation failed for:', columnName, errorText);
      throw new Error(`Failed to create column: ${columnName}`);
    } else {
      const result = await columnResponse.json();
      console.log('Successfully created column:', columnName, 'with ID:', result.id);
      return result.id;
    }
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
    let content = fileInfo.fileContent;
    
    // If we need to reprocess or content is empty for large files, reprocess just the headers
    if (!content || fileInfo.needsReprocessing || (fileInfo.isLargeFile && content.length < 1000)) {
      console.log('Reprocessing file to get headers...');
      
      // For large files, read only the first chunk to get headers
      const headerChunk = file.slice(0, 1024 * 1024); // First 1MB should contain headers
      content = await headerChunk.text();
      
      console.log('Reprocessed headers from first chunk');
    }
    
    if (!content) {
      throw new Error('No file content found');
    }

    console.log('File content preview:', content.substring(0, 200));
    
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

// Process the mapped data and create records in new table with progress callback
export const processImportData = async (
  mappings: Record<string, string>, 
  progressCallback?: (progress: { current: number, total: number, percentage: number }) => void
): Promise<{ total: number, created: number, updated: number, tableId: string, tableName: string }> => {
  try {
    console.log('Starting import process with mappings:', mappings);
    
    // Get file content from stored info
    const uploadedFileInfo = sessionStorage.getItem('uploadedFileInfo');
    if (!uploadedFileInfo) {
      throw new Error('No uploaded file info found');
    }

    const fileInfo = JSON.parse(uploadedFileInfo);
    const userData = fileInfo.userData;

    // For large files, we need to fetch the entire file content from the uploaded file URL
    let content: string;
    
    // First try to get the complete file from the server if we have a file URL
    if (fileInfo.file?.url) {
      try {
        console.log('Fetching complete file content from server:', fileInfo.file.url);
        const res = await fetch(fileInfo.file.url);
        if (res.ok) {
          content = await res.text();
          console.log('Successfully fetched complete file content from server, length:', content.length);
        } else {
          throw new Error(`Failed to fetch file from server: ${res.status}`);
        }
      } catch (fetchError) {
        console.warn('Failed to fetch from server, falling back to stored content:', fetchError);
        content = fileInfo.fullFileContent || fileInfo.fileContent || '';
      }
    } else {
      // Use stored content as fallback
      content = fileInfo.fullFileContent || fileInfo.fileContent || '';
    }

    if (!content) {
      throw new Error('No file content found and unable to fetch from server');
    }
    
    console.log('Processing file content with length:', content.length);
    
    // Improved line splitting and filtering for very large files
    const lines = content
      .split(/\r?\n/)
      .map(line => line.trim())
      .filter(line => line && !/^["',\s]*$/.test(line));

    console.log('Found', lines.length, 'lines in file');
    
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
    
    // Create new table
    const tableName = `${userData.company}_${userData.vorname}_${userData.nachname}_${new Date().toISOString().slice(0, 10)}`;
    console.log('Creating table with name:', tableName);
    
    const tableId = await createNewTable(tableName, mappedColumns);
    console.log('Table created with ID:', tableId);
    
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
    
    let created = 0;

    // Get fresh JWT token for record creation
    const jwtToken = await getJWTToken();

    // Process data rows with streaming approach for very large files
    console.log('Starting to import', lines.length - 1, 'data rows');
    
    const totalDataRows = lines.length - 1;
    const isVeryLargeFile = totalDataRows > 10000;
    
    if (isVeryLargeFile) {
      console.log('Very large file detected - using optimized processing');
      created = await processVeryLargeFileData(lines, headers, mappings, mappedColumns, fieldMappings, tableId, jwtToken, progressCallback);
    } else {
      created = await processStandardFileData(lines, headers, mappings, mappedColumns, fieldMappings, tableId, jwtToken, progressCallback);
    }

    // Verify records were actually created
    console.log('Verifying records were created...');
    const verificationRows = await verifyRecordsCreated(tableId);
    
    console.log(`Import completed. Created ${created} records in table ${tableId}`);
    console.log(`Verification: Found ${verificationRows.length} rows in table`);
    
    return { total: created, created, updated: 0, tableId, tableName };
  } catch (error) {
    console.error('Error processing import data:', error);
    throw error;
  }
};

// Optimized processing for very large files
const processVeryLargeFileData = async (
  lines: string[], 
  headers: string[], 
  mappings: Record<string, string>, 
  mappedColumns: string[], 
  fieldMappings: Record<string, number>, 
  tableId: string, 
  jwtToken: string,
  progressCallback?: (progress: { current: number, total: number, percentage: number }) => void
): Promise<number> => {
  console.log('Processing very large file with optimized approach');
  
  let created = 0;
  const LARGE_BATCH_SIZE = 25; // Smaller batches for very large files
  const batchBuffer: any[] = [];
  
  for (let i = 1; i < lines.length; i++) {
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
      batchBuffer.push(mappedData);
    }

    // Process batch when buffer is full
    if (batchBuffer.length >= LARGE_BATCH_SIZE) {
      const batchResults = await processBatchRecords(batchBuffer, tableId, jwtToken);
      created += batchResults;
      
      const percentage = ((i / lines.length) * 100);
      console.log(`Processed batch: ${created} total records created (${percentage.toFixed(1)}% complete)`);
      
      // Call progress callback if provided
      if (progressCallback) {
        progressCallback({
          current: created,
          total: lines.length - 1,
          percentage: Math.round(percentage)
        });
      }
      
      // Clear buffer and add delay for stability
      batchBuffer.length = 0;
      await new Promise(resolve => setTimeout(resolve, 200));
    }
  }

  // Process remaining records in buffer
  if (batchBuffer.length > 0) {
    const batchResults = await processBatchRecords(batchBuffer, tableId, jwtToken);
    created += batchResults;
    console.log(`Processed final batch: ${created} total records created`);
  }

  return created;
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
  progressCallback?: (progress: { current: number, total: number, percentage: number }) => void
): Promise<number> => {
  console.log('Processing with standard approach');
  
  const recordsToCreate = [];
  
  for (let i = 1; i < lines.length; i++) {
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
    }
  }

  // Create records in batches
  const BATCH_SIZE = 50;
  let created = 0;
  
  for (let i = 0; i < recordsToCreate.length; i += BATCH_SIZE) {
    const batch = recordsToCreate.slice(i, i + BATCH_SIZE);
    const batchResults = await processBatchRecords(batch, tableId, jwtToken);
    created += batchResults;
    
    const percentage = ((created / recordsToCreate.length) * 100);
    console.log(`Processed batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(recordsToCreate.length / BATCH_SIZE)}: ${created}/${recordsToCreate.length} records created`);
    
    // Call progress callback if provided
    if (progressCallback) {
      progressCallback({
        current: created,
        total: recordsToCreate.length,
        percentage: Math.round(percentage)
      });
    }
    
    if (i + BATCH_SIZE < recordsToCreate.length) {
      await new Promise(resolve => setTimeout(resolve, 150));
    }
  }

  return created;
};

// Process a batch of records
const processBatchRecords = async (batch: any[], tableId: string, jwtToken: string): Promise<number> => {
  let successCount = 0;
  
  for (const recordData of batch) {
    try {
      await createRecordInNewTable(tableId, recordData, jwtToken);
      successCount++;
      
      // Small delay between individual records
      await new Promise(resolve => setTimeout(resolve, 50));
    } catch (error) {
      console.error('Failed to create record:', error);
      // Continue with next record instead of failing entire batch
    }
  }
  
  return successCount;
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

// Create record in the new table with improved error handling
const createRecordInNewTable = async (tableId: string, recordData: any, jwtToken: string, retryCount = 0) => {
  const MAX_RETRIES = 3;
  
  try {
    console.log('Creating record in table:', tableId, 'with data keys:', Object.keys(recordData));
    
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
      
      // Handle rate limiting
      if (createResponse.status === 429 && retryCount < MAX_RETRIES) {
        console.warn(`Rate limited, retrying in ${(retryCount + 1) * 1000}ms...`);
        await new Promise(resolve => setTimeout(resolve, (retryCount + 1) * 1000));
        return await createRecordInNewTable(tableId, recordData, jwtToken, retryCount + 1);
      }
      
      // Handle JWT token expiration
      if (createResponse.status === 401 && retryCount < MAX_RETRIES) {
        console.warn('JWT token expired, getting fresh token...');
        const freshToken = await getJWTToken();
        return await createRecordInNewTable(tableId, recordData, freshToken, retryCount + 1);
      }
      
      console.error('Failed to create record in new table:', errorText);
      console.error('Record data was:', recordData);
      console.error('Response status:', createResponse.status);
      throw new Error(`Failed to create record: ${errorText}`);
    } else {
      const result = await createResponse.json();
      console.log('Record created successfully with ID:', result.id);
      return result;
    }
    
  } catch (error) {
    if (retryCount < MAX_RETRIES) {
      console.warn(`Retrying record creation (attempt ${retryCount + 1}/${MAX_RETRIES})...`);
      await new Promise(resolve => setTimeout(resolve, 1000));
      return await createRecordInNewTable(tableId, recordData, jwtToken, retryCount + 1);
    }
    
    console.error('Error creating record in new table after retries:', error);
    throw error;
  }
};

// Helper function to fetch all rows with pagination
const fetchAllRows = async (tableId: string, jwtToken: string) => {
  let allRows = [];
  let next = `${BASEROW_CONFIG.baseUrl}/api/database/rows/table/${tableId}/?limit=200&offset=0`;

  while (next) {
    const res = await fetch(next, {
      headers: { Authorization: `JWT ${jwtToken}` }
    });
    
    if (!res.ok) {
      console.error('Failed to fetch rows:', res.status, res.statusText);
      break;
    }
    
    const data = await res.json();
    allRows.push(...(data.results || []));
    next = data.next; // Baserow provides the full next-page URL
  }

  return allRows;
};

// Helper function to verify records were created
export const verifyRecordsCreated = async (tableId: string): Promise<any[]> => {
  try {
    const jwtToken = await getJWTToken();
    const allRows = await fetchAllRows(tableId, jwtToken);
    console.log(`Found ${allRows.length} rows in table ${tableId} (with pagination)`);
    return allRows;
  } catch (error) {
    console.error('Error verifying records:', error);
    throw error;
  }
};

export const configureBaserow = (apiToken: string, tableId: string, baseUrl?: string) => {
  console.log('Configuration is now hardcoded in the baserowApi.ts file');
};
