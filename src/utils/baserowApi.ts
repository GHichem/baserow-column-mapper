interface UploadData {
  vorname: string;
  nachname: string;
  email: string;
  company: string;
  file: File;
}

// Configuration - Using your provided Baserow instance
const BASEROW_CONFIG = {
  jwtToken: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJ0b2tlbl90eXBlIjoiYWNjZXNzIiwiZXhwIjoxNzUyNDk5OTMyLCJpYXQiOjE3NTI0OTkzMzIsImp0aSI6ImVhYmEwMWMzZmIzZTQ4YjdiOGUxMWU4NmQxM2ZmM2MzIiwidXNlcl9pZCI6OH0.QPUkxHOXnPg-CjwHf7zIySDm_c4zN_EkXQ3BN5YpHeE',
  apiToken: 'ZDLLQU57ljuMiGEwKk5DPaAjBXwFLwxR',
  tableId: '787',
  targetTableId: '790',
  baseUrl: 'https://baserow.app-inventor.org',
  databaseId: '207',
  // JWT Authentication credentials
  username: 'hgu@xiller.com',
  password: 'fEifpCnv5HpKVVv'
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
    // Check for existing record first
    const existingRecord = await findExistingRecord(data.vorname, data.nachname, data.email, data.company);
    
    if (existingRecord) {
      // Update existing record and delete old table if exists
      console.log('Found existing record, updating instead of creating new one');
      
      // Delete old table if it exists
      if (existingRecord.CreatedTableId) {
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
      const fileContent = await processFileInChunks(data.file);
      sessionStorage.setItem('uploadedFileInfo', JSON.stringify({
        file: { url: existingRecord.Datei?.[0]?.url || '' },
        userData: data,
        fileName: data.file.name,
        fileContent: fileContent,
        recordId: existingRecord.id
      }));
      
      return;
    }

    // First, upload the file to Baserow
    const fileFormData = new FormData();
    fileFormData.append('file', data.file);

    const fileUploadResponse = await fetch(`${BASEROW_CONFIG.baseUrl}/api/user-files/upload-file/`, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${BASEROW_CONFIG.apiToken}`,
      },
      body: fileFormData,
    });

    if (!fileUploadResponse.ok) {
      const errorText = await fileUploadResponse.text();
      console.error('File upload failed:', errorText);
      throw new Error('Datei-Upload fehlgeschlagen');
    }

    const fileUploadResult = await fileUploadResponse.json();
    console.log('File uploaded successfully:', fileUploadResult);
    
    // Process file in chunks for large files
    const fileContent = await processFileInChunks(data.file);
    
    // Then, create a row in the table with the form data and file reference
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
      throw new Error('Zeile konnte nicht erstellt werden');
    }

    const rowResult = await rowResponse.json();
    console.log('Successfully created row:', rowResult);
    
    // Store file info in session for the mapping page
    sessionStorage.setItem('uploadedFileInfo', JSON.stringify({
      file: fileUploadResult,
      userData: data,
      fileName: data.file.name,
      fileContent: fileContent,
      recordId: rowResult.id
    }));

  } catch (error) {
    console.error('Baserow upload error:', error);
    throw error;
  }
};

// Process file in chunks to handle large files efficiently
const processFileInChunks = async (file: File): Promise<string> => {
  const CHUNK_SIZE = 2 * 1024 * 1024; // 2MB chunks for better performance
  let content = '';
  let processedSize = 0;
  const maxFileSize = 100 * 1024 * 1024; // Increased to 100MB limit
  
  if (file.size > maxFileSize) {
    throw new Error(`File size (${(file.size / 1024 / 1024).toFixed(2)}MB) exceeds maximum allowed size of ${maxFileSize / 1024 / 1024}MB`);
  }
  
  console.log(`Starting to process file: ${file.name} (${(file.size / 1024 / 1024).toFixed(2)}MB)`);
  
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
      
      // Check for reasonable line count (increased limit for large files)
      const lines = content.split('\n');
      if (lines.length > 10000) {
        console.log(`Limited content to first ${lines.length} lines for processing`);
        break;
      }
      
      // Add small delay between chunks for stability
      if (i < chunks.length - 1) {
        await new Promise(resolve => setTimeout(resolve, 50));
      }
    } catch (error) {
      console.error('Error processing chunk:', error);
      throw new Error('Failed to process file chunk. File may be corrupted or too large.');
    }
  }
  
  console.log(`Successfully processed ${(processedSize / 1024 / 1024).toFixed(2)}MB of ${(file.size / 1024 / 1024).toFixed(2)}MB file`);
  return content;
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
    const content = fileInfo.fileContent;
    
    if (!content) {
      throw new Error('No file content found');
    }

    console.log('File content preview:', content.substring(0, 200));
    
    if (file.name.toLowerCase().endsWith('.csv') || fileInfo.file.mime_type === 'text/csv') {
      // Parse CSV
      const lines = content.split('\n');
      if (lines.length > 0) {
        const headers = lines[0].split(',').map(header => header.trim().replace(/"/g, ''));
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

// Process the mapped data and create records in new table
export const processImportData = async (mappings: Record<string, string>): Promise<{ total: number, created: number, updated: number, tableId: string, tableName: string }> => {
  try {
    console.log('Starting import process with mappings:', mappings);
    
    // Get file content from stored info
    const uploadedFileInfo = sessionStorage.getItem('uploadedFileInfo');
    if (!uploadedFileInfo) {
      throw new Error('No uploaded file info found');
    }

    const fileInfo = JSON.parse(uploadedFileInfo);
    const content = fileInfo.fileContent;
    const userData = fileInfo.userData;

    if (!content) {
      throw new Error('No file content found');
    }
    
    console.log('Processing file content with length:', content.length);
    
    const lines = content
  .split(/\r?\n/) // handle both \n and \r\n
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
    
    // 🧹 Clean up any default rows that Baserow might have added automatically
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

    // Process each data row (skip header)
    console.log('Starting to import', lines.length - 1, 'data rows');
    
    const recordsToCreate = [];
    
for (let i = 1; i < lines.length; i++) {
  const line = lines[i].trim();

  // Skip if the entire line is empty or contains only commas/quotes/spaces
  if (!line || /^["',\s]*$/.test(line)) {
    console.warn(`⚠️ Skipping row ${i}: line is empty or contains only separators`);
    continue;
  }

  console.log(`Processing row ${i}:`, line.substring(0, 100) + '...');

  // Parse the line into values (handles quotes properly)
  const values = parseCSVLine(line);
  console.log(`Parsed values for row ${i}:`, values);

  // Skip if all values are empty
  if (values.every(v => !v || (typeof v === 'string' && v.trim() === ''))) {
    console.warn(`⚠️ Skipping row ${i}: all values are empty`);
    continue;
  }

  // Map values to Baserow fields
  const mappedData: any = {};

  headers.forEach((header, index) => {
    const cleanHeader = header.trim().replace(/"/g, '');
    const targetColumn = mappings[cleanHeader];

    if (targetColumn && targetColumn !== 'ignore' && values[index] !== undefined) {
      const fieldId = fieldMappings[targetColumn];
      const value = typeof values[index] === 'string' ? values[index].trim() : values[index];

      if (fieldId && value !== '') {
        mappedData[`field_${fieldId}`] = value;
      }
    }
  });

  // Skip if mappedData is incomplete
  if (Object.keys(mappedData).length !== mappedColumns.length) {
    console.warn(`⚠️ Skipping row ${i}: Incomplete mapping`, mappedData);
    continue;
  }

  console.log(`✅ Accepted row ${i}:`, mappedData);
  recordsToCreate.push(mappedData);
}


    // Create records in batches for better performance with large files
    console.log(`Creating ${recordsToCreate.length} records in table ${tableId}`);
    
    const BATCH_SIZE = 50; // Process in smaller batches for large files
    
    for (let i = 0; i < recordsToCreate.length; i += BATCH_SIZE) {
      const batch = recordsToCreate.slice(i, i + BATCH_SIZE);
      console.log(`Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(recordsToCreate.length / BATCH_SIZE)} (${batch.length} records)`);
      
      for (const recordData of batch) {
        await createRecordInNewTable(tableId, recordData, jwtToken);
        created++;
        console.log(`Successfully created record ${created}/${recordsToCreate.length}`);
        
        // Smaller delay between records within batch
        await new Promise(resolve => setTimeout(resolve, 75));
      }
      
      // Longer delay between batches for stability
      if (i + BATCH_SIZE < recordsToCreate.length) {
        console.log('Waiting between batches for stability...');
        await new Promise(resolve => setTimeout(resolve, 300));
      }
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

// Helper function to properly parse CSV lines
const parseCSVLine = (line: string): string[] => {
  const regex = /(".*?"|[^",\s]+)(?=\s*,|\s*$)/g;
  const matches = [...line.matchAll(regex)].map(m => {
    const value = m[0].trim();
    return value.startsWith('"') && value.endsWith('"')
      ? value.slice(1, -1)
      : value;
  });
  return matches;
};

// Create record in the new table
const createRecordInNewTable = async (tableId: string, recordData: any, jwtToken: string) => {
  try {
    console.log('Creating record in table:', tableId, 'with data:', recordData);
    
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
    console.error('Error creating record in new table:', error);
    throw error;
  }
};

// Helper function to verify records were created
export const verifyRecordsCreated = async (tableId: string): Promise<any[]> => {
  try {
    const jwtToken = await getJWTToken();
    
    const response = await fetch(`${BASEROW_CONFIG.baseUrl}/api/database/rows/table/${tableId}/`, {
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
    console.log(`Found ${data.results?.length || 0} rows in table ${tableId}:`, data.results);
    return data.results || [];
  } catch (error) {
    console.error('Error verifying records:', error);
    throw error;
  }
};

export const configureBaserow = (apiToken: string, tableId: string, baseUrl?: string) => {
  console.log('Configuration is now hardcoded in the baserowApi.ts file');
};
