
interface UploadData {
  vorname: string;
  nachname: string;
  email: string;
  company: string;
  file: File;
}

// Configuration - Using your provided Baserow instance
const BASEROW_CONFIG = {
  apiToken: 'ZDLLQU57ljuMiGEwKk5DPaAjBXwFLwxR',
  tableId: '787',
  targetTableId: '790',
  baseUrl: 'https://baserow.app-inventor.org',
};

export const uploadToBaserow = async (data: UploadData): Promise<void> => {
  try {
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
    
    // Store file info in session for the mapping page
    sessionStorage.setItem('uploadedFileInfo', JSON.stringify({
      file: fileUploadResult,
      userData: data,
      fileName: data.file.name
    }));
    
    // Then, create a row in the table with the form data and file reference
    const rowData = {
      Vorname: data.vorname,
      Nachname: data.nachname,
      EMAIL: data.email,
      Company: data.company,
      Datei: [fileUploadResult],
      Dateiname: data.file.name,
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

  } catch (error) {
    console.error('Baserow upload error:', error);
    throw error;
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

// Parse CSV/Excel file to get headers
export const parseFileHeaders = async (file: File): Promise<string[]> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const content = e.target?.result as string;
        
        if (file.name.toLowerCase().endsWith('.csv')) {
          // Parse CSV
          const lines = content.split('\n');
          if (lines.length > 0) {
            const headers = lines[0].split(',').map(header => header.trim().replace(/"/g, ''));
            resolve(headers);
          } else {
            reject(new Error('CSV file appears to be empty'));
          }
        } else {
          // For Excel files, we'll need a more sophisticated approach
          // For now, let's assume the user will upload CSV files
          reject(new Error('Excel files not yet supported for header parsing'));
        }
      } catch (error) {
        reject(error);
      }
    };
    
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsText(file);
  });
};

// Create new table with mapped data
export const createTableWithData = async (tableName: string, mappedData: any[], columnMappings: Record<string, string>) => {
  try {
    // This would require creating a new table in Baserow
    // For now, we'll simulate this process
    console.log('Creating table:', tableName, 'with data:', mappedData, 'and mappings:', columnMappings);
    
    // In a real implementation, you'd call Baserow's create table API
    // followed by inserting the mapped data
    
    return { success: true, tableId: 'new_table_id' };
  } catch (error) {
    console.error('Error creating table:', error);
    throw error;
  }
};

// Check if record exists and update or create
export const upsertRecord = async (recordData: any) => {
  try {
    // First, search for existing record
    const searchParams = new URLSearchParams({
      search: `${recordData.Vorname} ${recordData.Nachname} ${recordData.EMAIL} ${recordData.Company}`,
    });
    
    const searchResponse = await fetch(`${BASEROW_CONFIG.baseUrl}/api/database/rows/table/${BASEROW_CONFIG.tableId}/?${searchParams}`, {
      headers: {
        'Authorization': `Token ${BASEROW_CONFIG.apiToken}`,
      },
    });
    
    if (searchResponse.ok) {
      const searchResults = await searchResponse.json();
      
      // Check if exact match exists
      const exactMatch = searchResults.results?.find((row: any) => 
        row.Vorname === recordData.Vorname &&
        row.Nachname === recordData.Nachname &&
        row.EMAIL === recordData.EMAIL &&
        row.Company === recordData.Company
      );
      
      if (exactMatch) {
        // Update existing record
        const updateResponse = await fetch(`${BASEROW_CONFIG.baseUrl}/api/database/rows/table/${BASEROW_CONFIG.tableId}/${exactMatch.id}/?user_field_names=true`, {
          method: 'PATCH',
          headers: {
            'Authorization': `Token ${BASEROW_CONFIG.apiToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(recordData),
        });
        
        if (!updateResponse.ok) {
          throw new Error('Failed to update existing record');
        }
        
        return { action: 'updated', record: await updateResponse.json() };
      }
    }
    
    // Create new record if no match found
    const createResponse = await fetch(`${BASEROW_CONFIG.baseUrl}/api/database/rows/table/${BASEROW_CONFIG.tableId}/?user_field_names=true`, {
      method: 'POST',
      headers: {
        'Authorization': `Token ${BASEROW_CONFIG.apiToken}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(recordData),
    });
    
    if (!createResponse.ok) {
      throw new Error('Failed to create new record');
    }
    
    return { action: 'created', record: await createResponse.json() };
    
  } catch (error) {
    console.error('Error in upsertRecord:', error);
    throw error;
  }
};

export const configureBaserow = (apiToken: string, tableId: string, baseUrl?: string) => {
  console.log('Configuration is now hardcoded in the baserowApi.ts file');
};
