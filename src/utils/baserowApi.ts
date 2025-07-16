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

// Process large files in chunks to avoid memory issues
const processFileInChunks = async (file: File): Promise<string> => {
  const chunkSize = 1024 * 1024; // 1MB chunks
  let content = '';
  
  for (let start = 0; start < file.size; start += chunkSize) {
    const chunk = file.slice(start, start + chunkSize);
    const chunkText = await chunk.text();
    content += chunkText;
    
    // For very large files, we might want to limit the content we store
    // Keep only first 100 lines for header parsing
    if (start === 0) {
      const lines = content.split('\n');
      if (lines.length > 100) {
        content = lines.slice(0, 100).join('\n');
        break;
      }
    }
  }
  
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

    // Wait for table to be fully created
    await new Promise(resolve => setTimeout(resolve, 2000));

    // Delete the default columns that get created automatically
    await deleteDefaultColumns(tableResult.id, jwtToken);

    // Wait before adding new columns
    await new Promise(resolve => setTimeout(resolve, 1000));

    // Add columns to the table
    for (const columnName of columns) {
      await createTableColumn(tableResult.id, columnName, jwtToken);
      // Wait between column creations
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    return tableResult.id.toString();
  } catch (error) {
    console.error('Error creating table:', error);
    throw error;
  }
};

// Delete default columns from newly created table
const deleteDefaultColumns = async (tableId: string, jwtToken: string) => {
  try {
    console.log('Fetching table fields to delete default columns...');
    
    // Get table fields
    const fieldsResponse = await fetch(`${BASEROW_CONFIG.baseUrl}/api/database/fields/table/${tableId}/`, {
      headers: {
        'Authorization': `JWT ${jwtToken}`,
      },
    });

    if (fieldsResponse.ok) {
      const fields = await fieldsResponse.json();
      console.log('Found fields to delete:', fields);
      
      // Delete all default fields (including "Name")
      for (const field of fields) {
        console.log(`Deleting default field: ${field.name} (ID: ${field.id}, Type: ${field.type})`);
        
        const deleteResponse = await fetch(`${BASEROW_CONFIG.baseUrl}/api/database/fields/${field.id}/`, {
          method: 'DELETE',
          headers: {
            'Authorization': `JWT ${jwtToken}`,
          },
        });
        
        if (deleteResponse.ok) {
          console.log('Successfully deleted default column:', field.name);
        } else {
          const errorText = await deleteResponse.text();
          console.error('Failed to delete column:', field.name, errorText);
        }
        
        // Wait between deletions
        await new Promise(resolve => setTimeout(resolve, 300));
      }
      
      console.log('All default columns deleted');
    } else {
      const errorText = await fieldsResponse.text();
      console.error('Failed to fetch table fields:', errorText);
    }
  } catch (error) {
    console.error('Error deleting default columns:', error);
    // Don't throw here as it's not critical - continue with column creation
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
    
    const lines = content.split('\n').filter(line => line.trim().length > 0);
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
    
    // Update the record in table 787 with the new table ID
    await updateRecordWithTableId(fileInfo.recordId, tableId);
    
    let created = 0;

    // Get fresh JWT token for record creation
    const jwtToken = await getJWTToken();

    // Process each data row (skip header)
    console.log('Starting to import', lines.length - 1, 'data rows');
    
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      
      console.log(`Processing row ${i}:`, line.substring(0, 100) + '...');
      
      // Parse CSV line properly (handle quoted values)
      const values = parseCSVLine(line);
      console.log(`Parsed values for row ${i}:`, values);
      
      // Map the values according to the column mappings
      const mappedData: any = {};
      
      headers.forEach((header, index) => {
        if (mappings[header] && mappings[header] !== 'ignore' && values[index] !== undefined) {
          const targetColumn = mappings[header];
          const value = values[index] || '';
          mappedData[targetColumn] = value;
          console.log(`Mapping: ${header} -> ${targetColumn} = "${value}"`);
        }
      });

      console.log(`Mapped data for row ${i}:`, mappedData);

      // Only process if we have some mapped data
      if (Object.keys(mappedData).length > 0) {
        await createRecordInNewTable(tableId, mappedData, jwtToken);
        created++;
        console.log(`Successfully created record ${created}`);
        
        // Small delay between record creations
        await new Promise(resolve => setTimeout(resolve, 100));
      } else {
        console.log(`Skipping row ${i} - no mapped data`);
      }
    }

    console.log(`Import completed. Created ${created} records in table ${tableId}`);
    return { total: created, created, updated: 0, tableId, tableName };
  } catch (error) {
    console.error('Error processing import data:', error);
    throw error;
  }
};

// Helper function to properly parse CSV lines
const parseCSVLine = (line: string): string[] => {
  const result: string[] = [];
  let current = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(current.trim().replace(/^"(.*)"$/, '$1'));
      current = '';
    } else {
      current += char;
    }
  }
  
  result.push(current.trim().replace(/^"(.*)"$/, '$1'));
  return result;
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

export const configureBaserow = (apiToken: string, tableId: string, baseUrl?: string) => {
  console.log('Configuration is now hardcoded in the baserowApi.ts file');
};
