
import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { CheckCircle, AlertCircle, ArrowRight, FileSpreadsheet, Settings } from 'lucide-react';
import { getTableSchema, parseFileHeaders } from '@/utils/baserowApi';
import { smartMatch, calculateSimilarity } from '@/utils/stringMatching';

interface ColumnMappingProps {
  uploadedFile: File;
  onMappingComplete: (mappings: Record<string, string>) => void;
  onBack: () => void;
}

interface ColumnMapping {
  userColumn: string;
  targetColumn: string | null;
  isMatched: boolean;
  similarity: number;
  isIgnored: boolean;
}

const ColumnMapping: React.FC<ColumnMappingProps> = ({ uploadedFile, onMappingComplete, onBack }) => {
  const [userColumns, setUserColumns] = useState<string[]>([]);
  const [targetColumns, setTargetColumns] = useState<string[]>([]);
  const [mappings, setMappings] = useState<Record<string, ColumnMapping>>({});
  const [isLoading, setIsLoading] = useState(true);
  const [isProcessing, setIsProcessing] = useState(false);
  const { toast } = useToast();

  useEffect(() => {
    loadColumnData();
  }, []);

  const loadColumnData = async () => {
    try {
      setIsLoading(true);
      
      // Parse user file headers
      const fileHeaders = await parseFileHeaders(uploadedFile);
      setUserColumns(fileHeaders);
      
      // Get target table schema
      const schema = await getTableSchema('790');
      const schemaColumns = schema.map((field: any) => field.name);
      setTargetColumns(schemaColumns);
      
      // Create initial mappings with smart matching
      const initialMappings: Record<string, ColumnMapping> = {};
      
      fileHeaders.forEach(userCol => {
        const smartMatchResult = smartMatch(userCol, schemaColumns);
        const similarity = smartMatchResult ? calculateSimilarity(userCol, smartMatchResult) : 0;
        
        initialMappings[userCol] = {
          userColumn: userCol,
          targetColumn: smartMatchResult,
          isMatched: !!smartMatchResult && similarity >= 70,
          similarity,
          isIgnored: false,
        };
      });
      
      setMappings(initialMappings);
      
      toast({
        title: "Spalten analysiert",
        description: `${fileHeaders.length} Spalten gefunden. ${Object.values(initialMappings).filter(m => m.isMatched).length} automatisch zugeordnet.`,
      });
      
    } catch (error) {
      console.error('Error loading column data:', error);
      toast({
        title: "Fehler",
        description: "Fehler beim Laden der Spaltendaten. Bitte versuchen Sie es erneut.",
        variant: "destructive",
      });
    } finally {
      setIsLoading(false);
    }
  };

  const handleMappingChange = (userColumn: string, targetColumn: string) => {
    setMappings(prev => {
      const updated = { ...prev };
      
      // Remove previous mapping if exists
      Object.keys(updated).forEach(key => {
        if (updated[key].targetColumn === targetColumn && key !== userColumn) {
          updated[key] = {
            ...updated[key],
            targetColumn: null,
            isMatched: false,
            similarity: 0,
          };
        }
      });
      
      // Set new mapping
      if (targetColumn === 'ignore') {
        updated[userColumn] = {
          ...updated[userColumn],
          targetColumn: null,
          isMatched: false,
          similarity: 0,
          isIgnored: true,
        };
      } else {
        updated[userColumn] = {
          ...updated[userColumn],
          targetColumn,
          isMatched: true,
          similarity: calculateSimilarity(userColumn, targetColumn),
          isIgnored: false,
        };
      }
      
      return updated;
    });
  };

  const getAvailableTargetColumns = (currentUserColumn: string) => {
    const usedColumns = Object.values(mappings)
      .filter(m => m.targetColumn && m.userColumn !== currentUserColumn)
      .map(m => m.targetColumn);
    
    return targetColumns.filter(col => !usedColumns.includes(col));
  };

  const handleImport = async () => {
    setIsProcessing(true);
    
    try {
      const finalMappings: Record<string, string> = {};
      
      Object.entries(mappings).forEach(([userCol, mapping]) => {
        if (mapping.targetColumn && !mapping.isIgnored) {
          finalMappings[userCol] = mapping.targetColumn;
        }
      });
      
      if (Object.keys(finalMappings).length === 0) {
        toast({
          title: "Keine Zuordnungen",
          description: "Bitte ordnen Sie mindestens eine Spalte zu oder wählen Sie 'Ignorieren'.",
          variant: "destructive",
        });
        return;
      }
      
      onMappingComplete(finalMappings);
      
    } catch (error) {
      console.error('Import error:', error);
      toast({
        title: "Import-Fehler",
        description: "Ein Fehler ist beim Import aufgetreten. Bitte versuchen Sie es erneut.",
        variant: "destructive",
      });
    } finally {
      setIsProcessing(false);
    }
  };

  const getMappingStats = () => {
    const total = userColumns.length;
    const matched = Object.values(mappings).filter(m => m.isMatched).length;
    const ignored = Object.values(mappings).filter(m => m.isIgnored).length;
    const unmapped = total - matched - ignored;
    
    return { total, matched, ignored, unmapped };
  };

  if (isLoading) {
    return (
      <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50 flex items-center justify-center">
        <div className="text-center">
          <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600 mx-auto mb-4"></div>
          <p className="text-lg text-gray-600">Analysiere Spaltendaten...</p>
        </div>
      </div>
    );
  }

  const stats = getMappingStats();

  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50 py-8">
      <div className="max-w-6xl mx-auto px-4">
        {/* Header */}
        <div className="text-center mb-8">
          <div className="flex items-center justify-center gap-2 mb-4">
            <Settings className="h-8 w-8 text-blue-600" />
            <h1 className="text-3xl font-bold text-gray-800">Spalten-Zuordnung</h1>
          </div>
          <p className="text-gray-600">
            Ordnen Sie die Spalten Ihrer Datei den Zielfeldern zu. Automatisch erkannte Zuordnungen sind grün markiert.
          </p>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-blue-600">{stats.total}</div>
              <div className="text-sm text-gray-600">Gesamt</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-green-600">{stats.matched}</div>
              <div className="text-sm text-gray-600">Zugeordnet</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-orange-600">{stats.ignored}</div>
              <div className="text-sm text-gray-600">Ignoriert</div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 text-center">
              <div className="text-2xl font-bold text-red-600">{stats.unmapped}</div>
              <div className="text-sm text-gray-600">Offen</div>
            </CardContent>
          </Card>
        </div>

        {/* File Info */}
        <Card className="mb-8">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <FileSpreadsheet className="h-5 w-5" />
              Datei: {uploadedFile.name}
            </CardTitle>
          </CardHeader>
        </Card>

        {/* Column Mappings */}
        <Card>
          <CardHeader>
            <CardTitle>Spalten-Zuordnungen</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="space-y-4">
              {userColumns.map((userColumn, index) => {
                const mapping = mappings[userColumn];
                const availableColumns = getAvailableTargetColumns(userColumn);
                
                return (
                  <div
                    key={index}
                    className={`p-4 rounded-lg border-2 transition-all ${
                      mapping.isMatched
                        ? 'border-green-300 bg-green-50'
                        : mapping.isIgnored
                        ? 'border-orange-300 bg-orange-50'
                        : 'border-gray-300 bg-white'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-4">
                      <div className="flex items-center gap-3 flex-1">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <Badge variant="outline" className="font-mono text-sm">
                              {userColumn}
                            </Badge>
                            {mapping.isMatched && (
                              <Badge variant="default" className="bg-green-100 text-green-800">
                                {mapping.similarity}% Übereinstimmung
                              </Badge>
                            )}
                          </div>
                        </div>
                        
                        <ArrowRight className="h-4 w-4 text-gray-400 flex-shrink-0" />
                        
                        <div className="min-w-0 flex-1">
                          <Select
                            value={mapping.isIgnored ? 'ignore' : mapping.targetColumn || ''}
                            onValueChange={(value) => handleMappingChange(userColumn, value)}
                          >
                            <SelectTrigger className="w-full">
                              <SelectValue placeholder="Zielfeld auswählen..." />
                            </SelectTrigger>
                            <SelectContent>
                              <SelectItem value="ignore">
                                <span className="text-orange-600">Ignorieren</span>
                              </SelectItem>
                              {availableColumns.map(column => (
                                <SelectItem key={column} value={column}>
                                  {column}
                                </SelectItem>
                              ))}
                              {mapping.targetColumn && !availableColumns.includes(mapping.targetColumn) && (
                                <SelectItem value={mapping.targetColumn}>
                                  {mapping.targetColumn}
                                </SelectItem>
                              )}
                            </SelectContent>
                          </Select>
                        </div>
                      </div>
                      
                      <div className="flex-shrink-0">
                        {mapping.isMatched ? (
                          <CheckCircle className="h-5 w-5 text-green-600" />
                        ) : mapping.isIgnored ? (
                          <AlertCircle className="h-5 w-5 text-orange-600" />
                        ) : (
                          <AlertCircle className="h-5 w-5 text-red-600" />
                        )}
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>

        {/* Action Buttons */}
        <div className="flex justify-between mt-8">
          <Button variant="outline" onClick={onBack} disabled={isProcessing}>
            Zurück
          </Button>
          
          <Button
            onClick={handleImport}
            disabled={isProcessing || stats.unmapped > 0}
            className="bg-gradient-to-r from-green-600 to-blue-600 hover:from-green-700 hover:to-blue-700"
          >
            {isProcessing ? (
              <>
                <div className="animate-spin rounded-full h-4 w-4 border-b-2 border-white mr-2"></div>
                Importiere...
              </>
            ) : (
              'Import starten'
            )}
          </Button>
        </div>
      </div>
    </div>
  );
};

export default ColumnMapping;
