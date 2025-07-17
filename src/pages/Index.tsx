import React from 'react';
import FileUploadForm from '@/components/FileUploadForm';

const Index = () => {
  return (
    <div className="h-screen flex flex-col justify-between bg-gradient-to-br from-gray-50 via-white to-gray-100">
      {/* Header */}
      <div className="bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 text-white py-2">
        <div className="px-2 text-center">
          <h1 className="text-xl font-bold mb-0.5">Datenerfassung</h1>
          <p className="text-slate-300 text-xs">Laden Sie Ihre Daten sicher und einfach hoch</p>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex items-center justify-center px-2">
        <div className="w-full max-w-lg">
          <div className="bg-white rounded-xl shadow border border-gray-100 overflow-hidden">
            <div className="bg-gradient-to-r from-blue-600 to-purple-600 p-3">
              <h2 className="text-base font-bold text-white mb-0.5">Persönliche Informationen</h2>
              <p className="text-blue-100 text-xs">Bitte füllen Sie alle Felder aus und laden Sie Ihre Datei hoch</p>
            </div>
            <div className="p-4">
              <FileUploadForm />
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="bg-slate-900 text-white py-2">
        <div className="px-2 text-center">
          <p className="text-slate-400 text-[10px]">
            © 2025 XiLLeR GmbH – <a href="https://www.xiller.de/Impressum/" className="hover:text-white transition-colors">Impressum</a> | <a href="https://www.xiller.de/datenschutzerklaerung/" className="hover:text-white transition-colors">Datenschutzerklärung</a>
          </p>
          <p className="text-slate-400 text-[10px] mt-0.5">
            <a href="https://www.beste-medien-werbe-agentur.de/Angebot/Consulting.html" className="hover:text-white transition-colors">
              Konzeption, Design, Programmierung: Beste Medien Werbe Agentur
            </a>
          </p>
        </div>
      </div>
    </div>
  );
};

export default Index;
