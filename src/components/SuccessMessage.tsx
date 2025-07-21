
import React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { CheckCircle, FileSpreadsheet } from 'lucide-react';

interface SuccessMessageProps {
  onReset: () => void;
}

const SuccessMessage: React.FC<SuccessMessageProps> = ({ onReset }) => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-purple-900 to-blue-900 flex items-center justify-center relative overflow-hidden">
      {/* Animated background elements */}
      <div className="absolute inset-0 overflow-hidden">
        <div className="absolute -inset-10 opacity-20">
          <div className="absolute top-1/4 left-1/4 w-96 h-96 bg-purple-500 rounded-full mix-blend-multiply filter blur-3xl animate-pulse"></div>
          <div className="absolute top-1/3 right-1/4 w-96 h-96 bg-green-500 rounded-full mix-blend-multiply filter blur-3xl animate-pulse delay-700"></div>
          <div className="absolute bottom-1/4 left-1/3 w-96 h-96 bg-cyan-500 rounded-full mix-blend-multiply filter blur-3xl animate-pulse delay-1000"></div>
        </div>
      </div>

      <Card className="w-full max-w-md bg-gradient-to-br from-slate-800/80 to-slate-900/80 border-slate-700/50 backdrop-blur-sm shadow-2xl shadow-slate-900/50 relative z-10">
        <CardContent className="p-8 text-center">
          <div className="relative mb-6">
            <CheckCircle className="h-20 w-20 text-green-400 mx-auto" />
            <div className="absolute inset-0 rounded-full bg-green-400/20 animate-pulse"></div>
            <div className="absolute inset-0 rounded-full bg-green-400/10 animate-ping"></div>
          </div>
          
          <h2 className="text-3xl font-bold bg-gradient-to-r from-white via-green-200 to-cyan-200 bg-clip-text text-transparent mb-4">
            Upload erfolgreich!
          </h2>
          
          <p className="text-gray-300 mb-8 text-lg leading-relaxed">
            Ihre Daten wurden erfolgreich übertragen und gespeichert.
          </p>
          
          <Button
            onClick={onReset}
            className="w-full bg-gradient-to-r from-green-600 via-emerald-600 to-cyan-600 hover:from-green-700 hover:via-emerald-700 hover:to-cyan-700 text-white py-3 text-lg font-medium transition-all duration-300 transform hover:scale-105 shadow-xl shadow-green-500/30 hover:shadow-green-500/50 border-0"
          >
            <FileSpreadsheet className="h-5 w-5 mr-3" />
            <span className="font-medium">Weitere Datei hochladen</span>
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default SuccessMessage;
