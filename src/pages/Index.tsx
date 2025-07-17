
import React from 'react';
import FileUploadForm from '@/components/FileUploadForm';

const Index = () => {
  return (
    <div className="h-screen bg-gradient-to-br from-blue-50 to-purple-50 flex flex-col">
      <div className="flex-1 max-w-4xl mx-auto px-4 py-6 flex flex-col">
        {/* Header */}
        <div className="text-center mb-6">
          <h1 className="text-3xl md:text-4xl font-bold text-gray-800 mb-3">
            Datenerfassung
          </h1>
          <p className="text-lg md:text-xl text-gray-600">
            Laden Sie Ihre Daten sicher und einfach hoch
          </p>
          <p className="text-sm text-gray-500 mt-2">
            Bitte füllen Sie alle Felder aus und laden Sie Ihre Datei hoch
          </p>
        </div>

        {/* Form Card - Takes remaining space */}
        <div className="bg-white rounded-2xl shadow-xl p-6 md:p-8 flex-1 overflow-y-auto">
          <FileUploadForm />
        </div>

        {/* Footer */}
        <div className="text-center mt-4 py-2">
          <p className="text-xs md:text-sm text-gray-600">
             © 2025 XiLLeR GmbH - <a href="https://www.xiller.de/Impressum/" className="hover:text-gray-800 transition-colors">Impressum</a> | <a href="https://www.xiller.de/datenschutzerklaerung/" className="hover:text-gray-800 transition-colors">Datenschutzerklärung</a>
          </p>
          <p className="text-xs text-gray-500 mt-1">
            <a href="https://www.beste-medien-werbe-agentur.de/Angebot/Consulting.html" className="hover:text-gray-700 transition-colors">Konzeption, Design, Programmierung: Beste Medien Werbe Agentur</a>
          </p>
        </div>
      </div>
    </div>
  );
};

export default Index;
