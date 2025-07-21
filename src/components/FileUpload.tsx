
import React, { useRef, useState } from 'react';
import { Button } from '@/components/ui/button';
import { useToast } from '@/hooks/use-toast';
import { Upload, File, X, CheckCircle } from 'lucide-react';

interface FileUploadProps {
  onFileSelect: (file: File) => void;
  selectedFile: File | null;
}

const FileUpload: React.FC<FileUploadProps> = ({ onFileSelect, selectedFile }) => {
  const [isDragOver, setIsDragOver] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const { toast } = useToast();

  const allowedTypes = [
    'text/csv',
    'application/vnd.ms-excel',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  ];

  const allowedExtensions = ['.csv', '.xls', '.xlsx'];

  const validateFile = (file: File): boolean => {
    const fileExtension = '.' + file.name.split('.').pop()?.toLowerCase();

    if (!allowedTypes.includes(file.type) && !allowedExtensions.includes(fileExtension)) {
      toast({
        title: "Ungültiger Dateityp",
        description: "Bitte wählen Sie eine .csv, .xls oder .xlsx Datei aus.",
        variant: "destructive",
      });
      return false;
    }

    return true;
  };

  const handleFileSelect = (file: File) => {
    if (validateFile(file)) {
      onFileSelect(file);
      toast({
        title: "Datei ausgewählt",
        description: `${file.name} wurde erfolgreich ausgewählt.`,
      });
    }
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(true);
  };

  const handleDragLeave = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragOver(false);

    const files = e.dataTransfer.files;
    if (files.length > 0) {
      handleFileSelect(files[0]);
    }
  };

  const handleFileInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const files = e.target.files;
    if (files && files.length > 0) {
      handleFileSelect(files[0]);
    }
  };

  const handleButtonClick = () => {
    fileInputRef.current?.click();
  };

  const removeFile = () => {
    onFileSelect(null as any);
    if (fileInputRef.current) {
      fileInputRef.current.value = '';
    }
  };

  const formatFileSize = (bytes: number): string => {
    if (bytes === 0) return '0 Bytes';
    const k = 1024;
    const sizes = ['Bytes', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
  };

  return (
    <div className="space-y-4">
      <div
        className={`
          border-2 border-dashed rounded-xl p-8 text-center transition-all duration-300 backdrop-blur-sm
          ${isDragOver 
            ? 'border-purple-500/70 bg-purple-500/10 shadow-lg shadow-purple-500/20' 
            : 'border-slate-600/50 hover:border-slate-500/70'
          }
          ${selectedFile ? 'bg-green-500/10 border-green-500/50 shadow-lg shadow-green-500/20' : 'bg-slate-700/30'}
        `}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <input
          ref={fileInputRef}
          type="file"
          onChange={handleFileInputChange}
          accept=".csv,.xls,.xlsx"
          className="hidden"
        />

        {selectedFile ? (
          <div className="space-y-4">
            <div className="flex items-center justify-center">
              <div className="relative">
                <CheckCircle className="h-12 w-12 text-green-400" />
                <div className="absolute inset-0 rounded-full bg-green-400/20 animate-pulse"></div>
              </div>
            </div>
            <div className="space-y-2">
              <p className="text-green-300 font-medium text-lg">Datei ausgewählt</p>
              <div className="flex items-center justify-center gap-2 text-sm text-gray-300">
                <File className="h-4 w-4" />
                <span>{selectedFile.name}</span>
                <span className="text-gray-400">({formatFileSize(selectedFile.size)})</span>
              </div>
            </div>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={removeFile}
              className="text-red-300 hover:text-red-200 border-red-500/50 hover:border-red-400/70 bg-red-500/10 hover:bg-red-500/20 backdrop-blur-sm transition-all duration-300"
            >
              <X className="h-4 w-4 mr-1" />
              Entfernen
            </Button>
          </div>
        ) : (
          <div className="space-y-4">
            <div className="flex items-center justify-center">
              <Upload className="h-12 w-12 text-gray-400" />
            </div>
            <div className="space-y-2">
              <p className="text-lg font-medium text-gray-200">
                Datei hier hinziehen oder klicken zum Auswählen
              </p>
              <p className="text-sm text-gray-400">
                Unterstützte Formate: .csv, .xls, .xlsx
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={handleButtonClick}
              className="border-purple-500/50 text-purple-300 hover:text-purple-200 hover:bg-purple-500/20 hover:border-purple-400/70 bg-purple-500/10 backdrop-blur-sm transition-all duration-300 shadow-lg shadow-purple-500/20 hover:shadow-purple-500/30"
            >
              <Upload className="h-4 w-4 mr-2" />
              Datei auswählen
            </Button>
          </div>
        )}
      </div>
    </div>
  );
};

export default FileUpload;
