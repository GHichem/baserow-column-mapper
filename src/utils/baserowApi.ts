
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
    // Check for existing record first
    const existingRecord = await findExistingRecord(data.vorname, data.nachname, data.email, data.company);
    
    if (existingRecord) {
      // Update existing record instead of creating new one
      console.log('Found existing record, updating instead of creating new one');
      
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
        }),
      });

      if (!updateResponse.ok) {
        throw new Error('Failed to update existing record');
      }

      const updateResult = await updateResponse.json();
      console.log('Successfully updated existing record:', updateResult);
      
      // Store file info for mapping page
      sessionStorage.setItem('uploadedFileInfo', JSON.stringify({
        file: { url: existingRecord.Datei?.[0]?.url || '' },
        userData: data,
        fileName: data.file.name
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

// Parse CSV/Excel file to get headers using the uploaded file URL
export const parseFileHeaders = async (file: File): Promise<string[]> => {
  try {
    // Get the uploaded file info from session storage
    const uploadedFileInfo = sessionStorage.getItem('uploadedFileInfo');
    if (!uploadedFileInfo) {
      throw new Error('No uploaded file info found');
    }

    const fileInfo = JSON.parse(uploadedFileInfo);
    const fileUrl = fileInfo.file.url;

    if (!fileUrl) {
      throw new Error('No file URL found');
    }

    // Fetch the file content from Baserow
    const response = await fetch(fileUrl);
    if (!response.ok) {
      throw new Error('Failed to fetch file content');
    }

    const content = await response.text();
    
    if (file.name.toLowerCase().endsWith('.csv') || fileInfo.file.mime_type === 'text/csv') {
      // Parse CSV
      const lines = content.split('\n');
      if (lines.length > 0) {
        const headers = lines[0].split(',').map(header => header.trim().replace(/"/g, ''));
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

// Process the mapped data and create records in target table
export const processImportData = async (mappings: Record<string, string>): Promise<{ total: number, created: number, updated: number }> => {
  try {
    // Get file content and parse it
    const uploadedFileInfo = sessionStorage.getItem('uploadedFileInfo');
    if (!uploadedFileInfo) {
      throw new Error('No uploaded file info found');
    }

    const fileInfo = JSON.parse(uploadedFileInfo);
    const fileUrl = fileInfo.file.url;

    const response = await fetch(fileUrl);
    const content = await response.text();
    
    const lines = content.split('\n').filter(line => line.trim().length > 0);
    const headers = lines[0].split(',').map(h => h.trim().replace(/"/g, ''));
    
    let created = 0;
    let updated = 0;

    // Process each data row (skip header)
    for (let i = 1; i < lines.length; i++) {
      const values = lines[i].split(',').map(v => v.trim().replace(/"/g, ''));
      
      // Map the values according to the column mappings
      const mappedData: any = {};
      
      headers.forEach((header, index) => {
        if (mappings[header] && values[index]) {
          mappedData[mappings[header]] = values[index];
        }
      });

      // Only process if we have some mapped data
      if (Object.keys(mappedData).length > 0) {
        const result = await upsertRecord(mappedData);
        if (result.action === 'created') {
          created++;
        } else if (result.action === 'updated') {
          updated++;
        }
      }
    }

    return { total: created + updated, created, updated };
  } catch (error) {
    console.error('Error processing import data:', error);
    throw error;
  }
};

// Check if record exists and update or create
export const upsertRecord = async (recordData: any) => {
  try {
    // First, search for existing record based on key fields
    const searchFields = ['Vorname', 'Nachname', 'EMAIL', 'Company'];
    const searchValues = searchFields.map(field => recordData[field]).filter(Boolean);
    
    if (searchValues.length === 0) {
      // If no key fields, just create
      const createResponse = await fetch(`${BASEROW_CONFIG.baseUrl}/api/database/rows/table/${BASEROW_CONFIG.targetTableId}/?user_field_names=true`, {
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
    }

    // Search for existing records
    const searchResponse = await fetch(`${BASEROW_CONFIG.baseUrl}/api/database/rows/table/${BASEROW_CONFIG.targetTableId}/?user_field_names=true`, {
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
        const updateResponse = await fetch(`${BASEROW_CONFIG.baseUrl}/api/database/rows/table/${BASEROW_CONFIG.targetTableId}/${exactMatch.id}/?user_field_names=true`, {
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
    const createResponse = await fetch(`${BASEROW_CONFIG.baseUrl}/api/database/rows/table/${BASEROW_CONFIG.targetTableId}/?user_field_names=true`, {
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
