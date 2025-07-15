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

// Create a new table using JWT token
export const createNewTable = async (tableName: string, columns: string[]): Promise<string> => {
  try {
    // Create table structure
    const tableData = {
      name: tableName,
      database_id: 59 // Your database ID
    };

    const tableResponse = await fetch(`${BASEROW_CONFIG.baseUrl}/api/database/tables/`, {
      method: 'POST',
      headers: {
        'Authorization': `JWT ${BASEROW_CONFIG.jwtToken}`,
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
    console.log('Table created:', tableResult);

    // Add columns to the table
    for (const columnName of columns) {
      await createTableColumn(tableResult.id, columnName);
    }

    return tableResult.id.toString();
  } catch (error) {
    console.error('Error creating table:', error);
    throw error;
  }
};

// Create a column in the table
const createTableColumn = async (tableId: string, columnName: string) => {
  try {
    const columnData = {
      name: columnName,
      type: 'text'
    };

    const columnResponse = await fetch(`${BASEROW_CONFIG.baseUrl}/api/database/fields/table/${tableId}/`, {
      method: 'POST',
      headers: {
        'Authorization': `JWT ${BASEROW_CONFIG.jwtToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(columnData),
    });

    if (!columnResponse.ok) {
      console.error('Column creation failed for:', columnName);
    }
  } catch (error) {
    console.error('Error creating column:', columnName, error);
  }
};

// Delete a table
const deleteTable = async (tableId: string) => {
  try {
    const response = await fetch(`${BASEROW_CONFIG.baseUrl}/api/database/tables/${tableId}/`, {
      method: 'DELETE',
      headers: {
        'Authorization': `JWT ${BASEROW_CONFIG.jwtToken}`,
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
    
    const lines = content.split('\n').filter(line => line.trim().length > 0);
    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    
    // Get unique mapped columns
    const mappedColumns = [...new Set(Object.values(mappings).filter(col => col !== 'ignore'))];
    
    // Create new table
    const tableName = `${userData.company}_${userData.vorname}_${userData.nachname}_${new Date().toISOString().slice(0, 10)}`;
    const tableId = await createNewTable(tableName, mappedColumns);
    
    // Update the record in table 787 with the new table ID
    await updateRecordWithTableId(fileInfo.recordId, tableId);
    
    let created = 0;

    // Process each data row (skip header)
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim().replace(/"/g, ''));
      
      // Map the values according to the column mappings
      const mappedData: any = {};
      
      headers.forEach((header, index) => {
        if (mappings[header] && mappings[header] !== 'ignore' && values[index]) {
          mappedData[mappings[header]] = values[index];
        }
      });

      // Only process if we have some mapped data
      if (Object.keys(mappedData).length > 0) {
        await createRecordInNewTable(tableId, mappedData);
        created++;
      }
    }

    return { total: created, created, updated: 0, tableId, tableName };
  } catch (error) {
    console.error('Error processing import data:', error);
    throw error;
  }
};

// Create record in the new table
const createRecordInNewTable = async (tableId: string, recordData: any) => {
  try {
    const createResponse = await fetch(`${BASEROW_CONFIG.baseUrl}/api/database/rows/table/${tableId}/`, {
      method: 'POST',
      headers: {
        'Authorization': `JWT ${BASEROW_CONFIG.jwtToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(recordData),
    });
    
    if (!createResponse.ok) {
      console.error('Failed to create record in new table');
    }
    
  } catch (error) {
    console.error('Error creating record in new table:', error);
  }
};

export const configureBaserow = (apiToken: string, tableId: string, baseUrl?: string) => {
  console.log('Configuration is now hardcoded in the baserowApi.ts file');
};
