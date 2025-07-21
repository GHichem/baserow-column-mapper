
import React, { useState, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { SearchableSelect } from '@/components/ui/searchable-select';
import { Badge } from '@/components/ui/badge';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { useToast } from '@/hooks/use-toast';
import { CheckCircle, AlertCircle, ArrowRight, FileSpreadsheet, Settings } from 'lucide-react';
import { getTableSchema, parseFileHeaders } from '@/utils/baserowApi';
import { smartMatch, calculateSimilarity } from '@/utils/stringMatching';
import ImportProgressDialog from './ImportProgressDialog';

interface ProgressInfo {
  current: number;
  total: number;
  percentage: number;
  remaining?: number;
  speed?: number;
  estimatedTimeRemaining?: number;
  currentBatch?: number;
  totalBatches?: number;
  failed?: number;
  processing?: 'bulk' | 'standard' | 'individual';
}

interface ColumnMappingProps {
  uploadedFile: File;
  onMappingComplete: (mappings: Record<string, string>, progressCallback?: (progress: ProgressInfo) => void) => void;
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
  const [showProgressDialog, setShowProgressDialog] = useState(false);
  const [progressInfo, setProgressInfo] = useState<ProgressInfo | null>(null);
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
      
      // Progress callback function - show dialog when we have real file data
      const progressCallback = (progress: ProgressInfo) => {
        // Show dialog when we have meaningful total count (real file data)
        if (progress.total > 100 || (progress.total > 0 && progress.currentBatch !== undefined)) {
          setShowProgressDialog(true);
        }
        
        setProgressInfo(progress);
        
        // Auto-hide dialog when completed
        if (progress.percentage >= 100) {
          setTimeout(() => {
            setShowProgressDialog(false);
            setProgressInfo(null);
          }, 3000); // Show completion for 3 seconds
        }
      };
      
      // Add progress tracking for the UI
      await onMappingComplete(finalMappings, progressCallback);
      
    } catch (error) {
      console.error('Import error:', error);
      setShowProgressDialog(false);
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
      <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-blue-900 flex items-center justify-center relative overflow-hidden">
        {/* Animated background elements */}
        <div className="absolute inset-0 overflow-hidden">
          <div className="absolute -inset-10 opacity-30">
            <div className="absolute top-1/4 left-1/4 w-72 h-72 bg-purple-500 rounded-full mix-blend-multiply filter blur-xl animate-pulse"></div>
            <div className="absolute top-1/3 right-1/4 w-72 h-72 bg-blue-500 rounded-full mix-blend-multiply filter blur-xl animate-pulse delay-700"></div>
            <div className="absolute bottom-1/4 left-1/3 w-72 h-72 bg-cyan-500 rounded-full mix-blend-multiply filter blur-xl animate-pulse delay-1000"></div>
          </div>
        </div>
        
        <div className="text-center relative z-10">
          <div className="relative mb-6">
            <div className="animate-spin rounded-full h-16 w-16 border-4 border-transparent bg-gradient-to-r from-purple-400 via-pink-400 to-cyan-400 mx-auto"></div>
            <div className="absolute inset-2 bg-slate-900 rounded-full"></div>
            <div className="absolute inset-3 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
          </div>
          <p className="text-xl text-white font-light tracking-wide">Analysiere Spaltendaten...</p>
          <div className="mt-4 flex justify-center space-x-1">
            <div className="w-2 h-2 bg-purple-400 rounded-full animate-bounce"></div>
            <div className="w-2 h-2 bg-pink-400 rounded-full animate-bounce delay-100"></div>
            <div className="w-2 h-2 bg-cyan-400 rounded-full animate-bounce delay-200"></div>
          </div>
        </div>
      </div>
    );
  }

  const stats = getMappingStats();

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-blue-900 py-8 relative overflow-hidden">
      {/* Animated background elements */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -inset-10 opacity-20">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-500 rounded-full mix-blend-multiply filter blur-3xl animate-pulse"></div>
          <div className="absolute top-1/3 right-1/4 w-96 h-96 bg-blue-500 rounded-full mix-blend-multiply filter blur-3xl animate-pulse delay-700"></div>
          <div className="absolute bottom-1/4 left-1/3 w-96 h-96 bg-cyan-500 rounded-full mix-blend-multiply filter blur-3xl animate-pulse delay-1000"></div>
        </div>
        
        {/* Grid pattern overlay */}
        <div className="absolute inset-0 opacity-10" style={{
          backgroundImage: `
            linear-gradient(rgba(255,255,255,0.1) 1px, transparent 1px),
            linear-gradient(90deg, rgba(255,255,255,0.1) 1px, transparent 1px)
          `,
          backgroundSize: '50px 50px'
        }}></div>
      </div>

      <div className="max-w-6xl mx-auto px-4 relative z-10">
        {/* Header */}
        <div className="text-center mb-12">
          <div className="flex items-center justify-center gap-3 mb-6">
            <div className="p-3 rounded-2xl bg-gradient-to-r from-purple-600 to-cyan-600 shadow-lg shadow-purple-500/25">
              <Settings className="h-8 w-8 text-white" />
            </div>
            <h1 className="text-4xl font-bold bg-gradient-to-r from-white via-purple-200 to-cyan-200 bg-clip-text text-transparent">
              Spalten-Zuordnung
            </h1>
          </div>
          <p className="text-gray-300 text-lg max-w-2xl mx-auto leading-relaxed">
            Ordnen Sie die Spalten Ihrer Datei den Zielfeldern zu. Automatisch erkannte Zuordnungen sind grün markiert.
          </p>
        </div>

        {/* Stats Cards */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-6 mb-12">
          <Card className="bg-gradient-to-br from-slate-800/80 to-slate-900/80 border-slate-700/50 backdrop-blur-sm hover:scale-105 transition-all duration-300 shadow-xl shadow-slate-900/50">
            <CardContent className="p-6 text-center">
              <div className="text-3xl font-bold bg-gradient-to-r from-blue-400 to-cyan-400 bg-clip-text text-transparent">{stats.total}</div>
              <div className="text-sm text-gray-400 font-medium mt-1">Gesamt</div>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-slate-800/80 to-slate-900/80 border-slate-700/50 backdrop-blur-sm hover:scale-105 transition-all duration-300 shadow-xl shadow-slate-900/50">
            <CardContent className="p-6 text-center">
              <div className="text-3xl font-bold bg-gradient-to-r from-green-400 to-emerald-400 bg-clip-text text-transparent">{stats.matched}</div>
              <div className="text-sm text-gray-400 font-medium mt-1">Zugeordnet</div>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-slate-800/80 to-slate-900/80 border-slate-700/50 backdrop-blur-sm hover:scale-105 transition-all duration-300 shadow-xl shadow-slate-900/50">
            <CardContent className="p-6 text-center">
              <div className="text-3xl font-bold bg-gradient-to-r from-orange-400 to-yellow-400 bg-clip-text text-transparent">{stats.ignored}</div>
              <div className="text-sm text-gray-400 font-medium mt-1">Ignoriert</div>
            </CardContent>
          </Card>
          <Card className="bg-gradient-to-br from-slate-800/80 to-slate-900/80 border-slate-700/50 backdrop-blur-sm hover:scale-105 transition-all duration-300 shadow-xl shadow-slate-900/50">
            <CardContent className="p-6 text-center">
              <div className="text-3xl font-bold bg-gradient-to-r from-red-400 to-pink-400 bg-clip-text text-transparent">{stats.unmapped}</div>
              <div className="text-sm text-gray-400 font-medium mt-1">Offen</div>
            </CardContent>
          </Card>
        </div>

        {/* File Info */}
        <Card className="mb-8 bg-gradient-to-r from-slate-800/80 to-slate-900/80 border-slate-700/50 backdrop-blur-sm shadow-xl shadow-slate-900/50 hover:shadow-purple-500/20 transition-all duration-500">
          <CardHeader>
            <CardTitle className="flex items-center gap-3 text-white">
              <div className="p-2 rounded-lg bg-gradient-to-r from-purple-600 to-pink-600">
                <FileSpreadsheet className="h-5 w-5 text-white" />
              </div>
              <span className="bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
                Datei: {uploadedFile.name}
              </span>
            </CardTitle>
          </CardHeader>
        </Card>

        {/* Column Mappings */}
        <Card className="bg-gradient-to-br from-slate-800/80 to-slate-900/80 border-slate-700/50 backdrop-blur-sm shadow-2xl shadow-slate-900/50">
          <CardHeader>
            <CardTitle className="text-2xl font-semibold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent flex items-center gap-3">
              <div className="h-1 w-8 bg-gradient-to-r from-purple-500 to-cyan-500 rounded-full"></div>
              Spalten-Zuordnungen
            </CardTitle>
          </CardHeader>
          <CardContent className="p-6">
            <div className="space-y-4">
              {userColumns.map((userColumn, index) => {
                const mapping = mappings[userColumn];
                const availableColumns = getAvailableTargetColumns(userColumn);
                
                // Prepare options for SearchableSelect
                const selectOptions = [
                  { value: 'ignore', label: 'Ignorieren' },
                  ...availableColumns.map(col => ({ value: col, label: col })),
                  // Include current mapping even if not available
                  ...(mapping.targetColumn && !availableColumns.includes(mapping.targetColumn) 
                    ? [{ value: mapping.targetColumn, label: mapping.targetColumn }] 
                    : [])
                ];
                
                return (
                  <div
                    key={index}
                    className={`group p-6 rounded-xl border-2 transition-all duration-500 hover:scale-[1.02] hover:shadow-lg ${
                      mapping.isMatched
                        ? 'border-green-400/50 bg-gradient-to-r from-green-900/30 to-emerald-900/30 shadow-green-500/20'
                        : mapping.isIgnored
                        ? 'border-orange-400/50 bg-gradient-to-r from-orange-900/30 to-yellow-900/30 shadow-orange-500/20'
                        : 'border-slate-600/50 bg-gradient-to-r from-slate-800/50 to-slate-700/50 shadow-slate-500/20'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-6">
                      <div className="flex items-center gap-4 flex-1">
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-3">
                            <Badge variant="outline" className={`font-mono text-sm px-3 py-1 font-medium ${
                              mapping.isMatched 
                                ? 'border-green-400/50 bg-green-500/20 text-green-300'
                                : mapping.isIgnored
                                ? 'border-orange-400/50 bg-orange-500/20 text-orange-300'
                                : 'border-slate-400/50 bg-slate-500/20 text-slate-300'
                            }`}>
                              {userColumn}
                            </Badge>
                            {mapping.isMatched && (
                              <Badge className="bg-gradient-to-r from-green-600 to-emerald-600 text-white border-0 shadow-lg shadow-green-500/30 animate-pulse">
                                {mapping.similarity}% Match
                              </Badge>
                            )}
                          </div>
                        </div>
                        
                        <div className="flex-shrink-0">
                          <ArrowRight className={`h-5 w-5 transition-all duration-300 group-hover:translate-x-1 ${
                            mapping.isMatched ? 'text-green-400' : 'text-gray-400'
                          }`} />
                        </div>
                        
                        <div className="min-w-0 flex-1">
                          <SearchableSelect
                            value={mapping.isIgnored ? 'ignore' : mapping.targetColumn || ''}
                            onValueChange={(value) => handleMappingChange(userColumn, value)}
                            placeholder="Zielfeld auswählen..."
                            options={selectOptions}
                          />
                        </div>
                      </div>
                      
                      <div className="flex-shrink-0">
                        {mapping.isMatched ? (
                          <div className="relative">
                            <CheckCircle className="h-6 w-6 text-green-400" />
                            <div className="absolute inset-0 rounded-full bg-green-400/20"></div>
                          </div>
                        ) : mapping.isIgnored ? (
                          <AlertCircle className="h-6 w-6 text-orange-400" />
                        ) : (
                          <AlertCircle className="h-6 w-6 text-red-400" />
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
        <div className="flex justify-between mt-12">
          <Button 
            variant="outline" 
            onClick={onBack} 
            disabled={isProcessing}
            className="px-8 py-3 bg-slate-800/80 border-slate-600 text-gray-300 hover:bg-slate-700/80 hover:border-slate-500 hover:text-white transition-all duration-300 backdrop-blur-sm shadow-lg shadow-slate-900/50"
          >
            Zurück
          </Button>
          
          <Button
            onClick={handleImport}
            disabled={isProcessing || stats.unmapped > 0}
            className="px-8 py-3 bg-gradient-to-r from-green-600 via-emerald-600 to-cyan-600 hover:from-green-700 hover:via-emerald-700 hover:to-cyan-700 text-white border-0 shadow-xl shadow-green-500/30 hover:shadow-green-500/50 hover:scale-105 transition-all duration-300 disabled:opacity-50 disabled:cursor-not-allowed disabled:hover:scale-100"
          >
            {isProcessing ? (
              <>
                <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent mr-3"></div>
                <span className="font-medium">Importiere...</span>
              </>
            ) : (
              <span className="font-medium">Import starten</span>
            )}
          </Button>
        </div>
      </div>

      {/* Progress Dialog */}
      <ImportProgressDialog
        open={showProgressDialog}
        progress={progressInfo}
        tableName={uploadedFile.name.replace(/\.[^/.]+$/, "")} // Remove file extension for table name
      />
    </div>
  );
};

export default ColumnMapping;
