import * as XLSX from 'xlsx';

/**
 * Convert Excel file to CSV format
 * @param file - Excel file (xlsx, xls)
 * @returns Promise<File> - CSV file
 */
export const convertExcelToCSV = async (file: File): Promise<File> => {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    
    reader.onload = (e) => {
      try {
        const data = e.target?.result;
        if (!data) {
          reject(new Error('Failed to read file'));
          return;
        }

        // Parse the Excel file
        const workbook = XLSX.read(data, { type: 'array' });
        
        // Get the first worksheet
        const firstSheetName = workbook.SheetNames[0];
        const worksheet = workbook.Sheets[firstSheetName];
        
        // Convert to CSV
        const csvData = XLSX.utils.sheet_to_csv(worksheet);
        
        // Create a new File object with CSV data
        const csvBlob = new Blob([csvData], { type: 'text/csv' });
        const csvFileName = file.name.replace(/\.(xlsx|xls)$/i, '.csv');
        const csvFile = new File([csvBlob], csvFileName, { type: 'text/csv' });
        
        resolve(csvFile);
      } catch (error) {
        reject(new Error(`Failed to convert Excel file: ${error instanceof Error ? error.message : 'Unknown error'}`));
      }
    };
    
    reader.onerror = () => {
      reject(new Error('Failed to read file'));
    };
    
    reader.readAsArrayBuffer(file);
  });
};

/**
 * Check if a file is an Excel file
 * @param file - File to check
 * @returns boolean
 */
export const isExcelFile = (file: File): boolean => {
  const excelMimeTypes = [
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', // .xlsx
    'application/vnd.ms-excel', // .xls
  ];
  
  const excelExtensions = ['.xlsx', '.xls'];
  const fileExtension = '.' + file.name.split('.').pop()?.toLowerCase();
  
  return excelMimeTypes.includes(file.type) || excelExtensions.includes(fileExtension);
};