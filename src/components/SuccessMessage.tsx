
import React from 'react';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { CheckCircle, FileSpreadsheet } from 'lucide-react';

interface SuccessMessageProps {
  onReset: () => void;
}

const SuccessMessage: React.FC<SuccessMessageProps> = ({ onReset }) => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50 flex items-center justify-center">
      <Card className="w-full max-w-md">
        <CardContent className="p-8 text-center">
          <CheckCircle className="h-16 w-16 text-green-500 mx-auto mb-6" />
          <h2 className="text-2xl font-bold text-gray-800 mb-4">
            Upload erfolgreich!
          </h2>
          <p className="text-gray-600 mb-6">
            Ihre Daten wurden erfolgreich übertragen und gespeichert.
          </p>
          <Button
            onClick={onReset}
            className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700"
          >
            <FileSpreadsheet className="h-4 w-4 mr-2" />
            Weitere Datei hochladen
          </Button>
        </CardContent>
      </Card>
    </div>
  );
};

export default SuccessMessage;
