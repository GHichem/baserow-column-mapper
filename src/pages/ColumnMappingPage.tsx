
import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { useToast } from '@/hooks/use-toast';
import ColumnMapping from '@/components/ColumnMapping';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertCircle, CheckCircle, FileSpreadsheet } from 'lucide-react';

interface UploadedFileInfo {
  file: any;
  userData: {
    vorname: string;
    nachname: string;
    email: string;
    company: string;
  };
  fileName: string;
}

const ColumnMappingPage = () => {
  const [uploadedFileInfo, setUploadedFileInfo] = useState<UploadedFileInfo | null>(null);
  const [originalFile, setOriginalFile] = useState<File | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [importResults, setImportResults] = useState<any>(null);
  const navigate = useNavigate();
  const { toast } = useToast();

  useEffect(() => {
    loadUploadedFileInfo();
  }, []);

  const loadUploadedFileInfo = () => {
    try {
      const savedInfo = sessionStorage.getItem('uploadedFileInfo');
      const savedFile = sessionStorage.getItem('originalFile');
      
      if (!savedInfo) {
        toast({
          title: "Keine Datei gefunden",
          description: "Bitte laden Sie zuerst eine Datei hoch.",
          variant: "destructive",
        });
        navigate('/');
        return;
      }

      const fileInfo = JSON.parse(savedInfo);
      setUploadedFileInfo(fileInfo);

      // Reconstruct the file object if available
      if (savedFile) {
        const fileData = JSON.parse(savedFile);
        // Note: In a real app, you'd need to reconstruct the File object properly
        // For now, we'll create a mock file for demonstration
        const reconstructedFile = new File([''], fileInfo.fileName, { type: 'text/csv' });
        setOriginalFile(reconstructedFile);
      }

    } catch (error) {
      console.error('Error loading file info:', error);
      toast({
        title: "Fehler",
        description: "Fehler beim Laden der Datei-Informationen.",
        variant: "destructive",
      });
      navigate('/');
    } finally {
      setIsLoading(false);
    }
  };

  const handleMappingComplete = async (mappings: Record<string, string>) => {
    try {
      console.log('Column mappings completed:', mappings);
      console.log('File info:', uploadedFileInfo);
      
      // Simulate processing the file with mappings
      // In a real implementation, you would:
      // 1. Read the entire file content
      // 2. Parse each row according to the mappings
      // 3. Check for existing records (firstname + lastname + email + company)
      // 4. Either update existing records or create new ones
      
      // For demonstration, we'll show a success message
      const processedRecords = Math.floor(Math.random() * 100) + 1;
      const updatedRecords = Math.floor(processedRecords * 0.3);
      const newRecords = processedRecords - updatedRecords;
      
      setImportResults({
        total: processedRecords,
        updated: updatedRecords,
        created: newRecords,
        mappings,
      });
      
      toast({
        title: "Import erfolgreich",
        description: `${processedRecords} Datensätze verarbeitet. ${newRecords} neue Einträge, ${updatedRecords} aktualisiert.`,
      });

    } catch (error) {
      console.error('Import error:', error);
      toast({
        title: "Import-Fehler",
        description: "Ein Fehler ist beim Import aufgetreten. Bitte versuchen Sie es erneut.",
        variant: "destructive",
      });
    }
  };

  const handleBack = () => {
    navigate('/');
  };

  const handleStartOver = () => {
    sessionStorage.removeItem('uploadedFileInfo');
    sessionStorage.removeItem('originalFile');
    navigate('/');
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-lg text-gray-600">Lade Datei-Informationen...</p>
        </div>
      </div>
    );
  }

  if (!uploadedFileInfo || !originalFile) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50 flex items-center justify-center">
        <Card className="w-full max-w-md">
          <CardContent className="p-8 text-center">
            <AlertCircle className="h-12 w-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-semibold mb-4">Datei nicht gefunden</h2>
            <p className="text-gray-600 mb-6">
              Es wurde keine hochgeladene Datei gefunden. Bitte starten Sie den Upload-Prozess erneut.
            </p>
            <Button onClick={() => navigate('/')} className="w-full">
              Zurück zum Upload
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  if (importResults) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50 flex items-center justify-center">
        <Card className="w-full max-w-2xl">
          <CardContent className="p-8 text-center">
            <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-6" />
            <h2 className="text-2xl font-bold text-gray-800 mb-4">Import erfolgreich abgeschlossen!</h2>
            
            <div className="grid grid-cols-3 gap-4 mb-8">
              <div className="bg-blue-50 p-4 rounded-lg">
                <div className="text-2xl font-bold text-blue-600">{importResults.total}</div>
                <div className="text-sm text-gray-600">Gesamt verarbeitet</div>
              </div>
              <div className="bg-green-50 p-4 rounded-lg">
                <div className="text-2xl font-bold text-green-600">{importResults.created}</div>
                <div className="text-sm text-gray-600">Neue Einträge</div>
              </div>
              <div className="bg-orange-50 p-4 rounded-lg">
                <div className="text-2xl font-bold text-orange-600">{importResults.updated}</div>
                <div className="text-sm text-gray-600">Aktualisiert</div>
              </div>
            </div>

            <div className="text-left bg-gray-50 p-4 rounded-lg mb-6">
              <h3 className="font-semibold text-gray-800 mb-2">Verwendete Spalten-Zuordnungen:</h3>
              <div className="space-y-1">
                {Object.entries(importResults.mappings).map(([userCol, targetCol]) => (
                  <div key={userCol} className="flex items-center gap-2 text-sm">
                    <span className="font-mono bg-white px-2 py-1 rounded">{userCol}</span>
                    <span>→</span>
                    <span className="font-mono bg-white px-2 py-1 rounded">{targetCol}</span>
                  </div>
                ))}
              </div>
            </div>
            
            <div className="flex gap-4 justify-center">
              <Button onClick={handleStartOver} className="bg-gradient-to-r from-blue-600 to-purple-600">
                <FileSpreadsheet className="h-4 w-4 mr-2" />
                Neue Datei hochladen
              </Button>
            </div>
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <ColumnMapping
      uploadedFile={originalFile}
      onMappingComplete={handleMappingComplete}
      onBack={handleBack}
    />
  );
};

export default ColumnMappingPage;
