
import React from 'react';
import FileUploadForm from '@/components/FileUploadForm';

const Index = () => {
  return (
    <div className="min-h-screen bg-gradient-to-br from-blue-50 to-purple-50 py-8">
      <div className="max-w-4xl mx-auto px-4">
        {/* Header */}
        <div className="text-center mb-8">
          <h1 className="text-4xl font-bold text-gray-800 mb-4">
            Datenerfassung
          </h1>
          <p className="text-xl text-gray-600">
            Laden Sie Ihre Daten sicher und einfach hoch
          </p>
          <p className="text-sm text-gray-500 mt-2">
            Bitte füllen Sie alle Felder aus und laden Sie Ihre Datei hoch
          </p>
        </div>

        {/* Form Card */}
        <div className="bg-white rounded-2xl shadow-xl p-8">
          <FileUploadForm />
        </div>

        {/* Footer */}
        <div className="text-center mt-8">
          <p className="text-sm text-gray-500">
            © 2024 MLLER GmbH • Impressum | Datenschutzerklärung
          </p>
          <p className="text-xs text-gray-400 mt-1">
            Konzeption, Design, Programmierung: Beste Medien Werbe Agentur
          </p>
        </div>
      </div>
    </div>
  );
};

export default Index;
