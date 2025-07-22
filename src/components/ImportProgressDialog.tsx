import React from 'react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import { Progress } from '@/components/ui/progress';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { CheckCircle, Clock, Zap, AlertCircle, Database, TrendingUp } from 'lucide-react';
import { cn } from '@/lib/utils';

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

interface ImportProgressDialogProps {
  open: boolean;
  progress: ProgressInfo | null;
  tableName?: string;
}

const ImportProgressDialog: React.FC<ImportProgressDialogProps> = ({ 
  open, 
  progress, 
  tableName
}) => {
  const formatTime = (seconds: number): string => {
    if (seconds < 60) return `${seconds}s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
    return `${Math.floor(seconds / 3600)}h ${Math.floor((seconds % 3600) / 60)}m`;
  };

  const getProcessingModeInfo = (mode?: string) => {
    switch (mode) {
      case 'bulk':
        return { icon: Zap, label: 'Bulk Import', color: 'text-green-600', bgColor: 'bg-green-50' };
      case 'individual':
        return { icon: Database, label: 'Individual Records', color: 'text-blue-600', bgColor: 'bg-blue-50' };
      case 'standard':
        return { icon: TrendingUp, label: 'Standard Processing', color: 'text-purple-600', bgColor: 'bg-purple-50' };
      default:
        return { icon: Clock, label: 'Processing', color: 'text-gray-600', bgColor: 'bg-gray-50' };
    }
  };

  if (!progress) return null;

  const ProcessingIcon = getProcessingModeInfo(progress.processing).icon;
  const isCompleted = progress.percentage >= 100;

  return (
    <DialogPrimitive.Root open={open}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
        <DialogPrimitive.Content 
          className={cn(
            "fixed left-[50%] top-[50%] z-50 grid w-full max-w-md translate-x-[-50%] translate-y-[-50%] gap-4 border border-slate-700/50 bg-gradient-to-br from-slate-800 to-slate-900 p-6 shadow-lg duration-200 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[state=closed]:slide-out-to-left-1/2 data-[state=closed]:slide-out-to-top-[48%] data-[state=open]:slide-in-from-left-1/2 data-[state=open]:slide-in-from-top-[48%] sm:rounded-lg text-white"
          )}
          onPointerDownOutside={(e) => e.preventDefault()}
          onEscapeKeyDown={(e) => e.preventDefault()}
        >
        <div className="flex flex-col space-y-1.5 text-center sm:text-left">
          <div className="flex items-center justify-between">
            <DialogPrimitive.Title className="flex items-center gap-3 text-lg font-semibold leading-none tracking-tight">
              {isCompleted ? (
                <div className="relative">
                  <CheckCircle className="h-6 w-6 text-green-400" />
                  <div className="absolute inset-0 rounded-full bg-green-400/20 animate-pulse"></div>
                </div>
              ) : (
                <div className="relative">
                  <div className="animate-spin rounded-full h-6 w-6 border-2 border-purple-400 border-t-transparent" />
                  <div className="absolute inset-0 rounded-full bg-purple-400/20 animate-ping"></div>
                </div>
              )}
              <span className="bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">
                {isCompleted ? 'Import Abgeschlossen!' : 'Daten werden importiert...'}
              </span>
            </DialogPrimitive.Title>
          </div>
          <DialogPrimitive.Description className="text-sm text-gray-400">
            {tableName && `Importiere in Tabelle: ${tableName}`}
          </DialogPrimitive.Description>
        </div>

        <div className="space-y-6">
          {/* Main Progress Bar */}
          <div className="space-y-3">
            <div className="flex justify-between text-sm">
              <span className="font-medium text-gray-300">Fortschritt</span>
              <span className="text-gray-400">
                {progress.current.toLocaleString()} / {progress.total.toLocaleString()} Records
              </span>
            </div>
            <div className="relative">
              <Progress 
                value={progress.percentage} 
                className="h-3 bg-slate-700/50 border-slate-600/50" 
              />
              <div className="absolute inset-0 rounded-full bg-gradient-to-r from-purple-500/20 to-cyan-500/20 animate-pulse"></div>
            </div>
            <div className="flex justify-between text-xs text-gray-500">
              <span className="text-purple-400">{progress.percentage}% abgeschlossen</span>
              {progress.remaining !== undefined && (
                <span className="text-cyan-400">{progress.remaining.toLocaleString()} verbleibend</span>
              )}
            </div>
          </div>

          {/* Stats Grid */}
          <div className="grid grid-cols-2 gap-4">
            {/* Speed & Time */}
            <div className="bg-gradient-to-br from-purple-500/20 to-cyan-500/20 border border-purple-500/30 rounded-lg p-4 backdrop-blur-sm">
              <div className="flex items-center gap-2 mb-2">
                <TrendingUp className="h-4 w-4 text-cyan-400" />
                <span className="text-sm font-medium text-gray-300">Geschwindigkeit</span>
              </div>
              <div className="space-y-1">
                {progress.speed !== undefined && (
                  <div className="text-lg font-bold bg-gradient-to-r from-cyan-400 to-blue-400 bg-clip-text text-transparent">
                    {progress.speed.toLocaleString()} /s
                  </div>
                )}
                {progress.estimatedTimeRemaining !== undefined && progress.estimatedTimeRemaining > 0 && (
                  <div className="text-xs text-gray-500">
                    ~{formatTime(progress.estimatedTimeRemaining)} verbleibend
                  </div>
                )}
              </div>
            </div>

            {/* Processing Mode */}
            <div className="bg-gradient-to-br from-purple-500/20 to-pink-500/20 border border-purple-500/30 rounded-lg p-4 backdrop-blur-sm">
              <div className="flex items-center gap-2 mb-2">
                <ProcessingIcon className={`h-4 w-4 text-purple-400`} />
                <span className="text-sm font-medium text-gray-300">Modus</span>
              </div>
              <div className="space-y-1">
                <Badge 
                  variant="secondary" 
                  className="bg-purple-500/20 text-purple-300 border-purple-500/50 text-xs"
                >
                  {getProcessingModeInfo(progress.processing).label}
                </Badge>
                {progress.currentBatch !== undefined && progress.totalBatches !== undefined && (
                  <div className="text-xs text-gray-500">
                    Batch {progress.currentBatch} von {progress.totalBatches}
                  </div>
                )}
              </div>
            </div>
          </div>

          {/* Additional Info */}
          <div className="flex justify-between items-center text-sm">
            {progress.failed !== undefined && progress.failed > 0 ? (
              <div className="flex items-center gap-1 text-orange-400">
                <AlertCircle className="h-4 w-4" />
                <span>{progress.failed} Fehler</span>
              </div>
            ) : (
              <div className="flex items-center gap-1 text-green-400">
                <CheckCircle className="h-4 w-4" />
                <span>Fehlerfrei</span>
              </div>
            )}
            
            {isCompleted && (
              <Badge variant="default" className="bg-gradient-to-r from-green-600 to-emerald-600 text-white border-0 shadow-lg">
                ✅ Abgeschlossen
              </Badge>
            )}
          </div>

          {/* Ultra Speed Indicator with Animation */}
          {progress.speed !== undefined && progress.speed > 1000 && (
            <div className="text-center animate-pulse">
              <Badge variant="secondary" className="bg-gradient-to-r from-purple-500/20 to-pink-500/20 text-purple-300 border-purple-500/50 animate-bounce">
                🚀 Ultra-Speed-Import: {progress.speed.toLocaleString()} Records/Sekunde!
              </Badge>
            </div>
          )}

          {/* High Performance Mode Indicator */}
          {progress.speed !== undefined && progress.speed > 500 && progress.speed <= 1000 && (
            <div className="text-center">
              <Badge variant="secondary" className="bg-gradient-to-r from-green-500/20 to-cyan-500/20 text-green-300 border-green-500/50">
                ⚡ Hochgeschwindigkeits-Import: {progress.speed.toLocaleString()} Records/Sekunde
              </Badge>
            </div>
          )}

          {/* Processing Animation */}
          {!isCompleted && progress.speed !== undefined && (
            <div className="flex justify-center items-center space-x-2 text-sm text-gray-400">
              <div className="flex space-x-1">
                <div className="w-2 h-2 bg-purple-400 rounded-full animate-bounce" style={{ animationDelay: '0ms' }}></div>
                <div className="w-2 h-2 bg-pink-400 rounded-full animate-bounce" style={{ animationDelay: '150ms' }}></div>
                <div className="w-2 h-2 bg-cyan-400 rounded-full animate-bounce" style={{ animationDelay: '300ms' }}></div>
              </div>
              <span>Importiere mit maximaler Geschwindigkeit...</span>
            </div>
          )}
        </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
};

export default ImportProgressDialog;
