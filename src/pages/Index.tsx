import React from 'react';
import FileUploadForm from '@/components/FileUploadForm';

const Index = () => {
  return (
    <div className="h-screen flex flex-col justify-between bg-gradient-to-br from-slate-900 via-purple-900 to-blue-900 relative overflow-hidden">
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

      {/* Header */}
      <div className="bg-gradient-to-r from-slate-800/80 via-purple-800/80 to-slate-800/80 text-white py-4 backdrop-blur-sm border-b border-slate-700/50 relative z-10">
        <div className="px-4 text-center">
          <h1 className="text-2xl font-bold bg-gradient-to-r from-white via-purple-200 to-cyan-200 bg-clip-text text-transparent mb-2">Datenerfassung</h1>
          <p className="text-slate-300 text-sm">Laden Sie Ihre Daten sicher und einfach hoch</p>
        </div>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex items-center justify-center px-4 relative z-10">
        <div className="w-full max-w-lg">
          <div className="bg-gradient-to-br from-slate-800/80 to-slate-900/80 border border-slate-700/50 rounded-2xl shadow-2xl shadow-slate-900/50 backdrop-blur-sm overflow-hidden hover:shadow-purple-500/20 transition-all duration-500">
            <div className="bg-gradient-to-r from-purple-600 to-cyan-600 p-4 relative">
              <div className="absolute inset-0 bg-gradient-to-r from-purple-600/90 to-cyan-600/90 backdrop-blur-sm"></div>
              <div className="relative z-10">
                <h2 className="text-lg font-bold text-white mb-1">Persönliche Informationen</h2>
                <p className="text-purple-100 text-sm">Bitte füllen Sie alle Felder aus und laden Sie Ihre Datei hoch</p>
              </div>
            </div>
            <div className="p-6">
              <FileUploadForm />
            </div>
          </div>
        </div>
      </div>

      {/* Footer */}
      <div className="bg-gradient-to-r from-slate-900/90 via-purple-900/90 to-slate-900/90 text-white py-4 backdrop-blur-sm border-t border-slate-700/50 relative z-10">
        <div className="px-4 text-center">
          <p className="text-slate-400 text-xs">
            © 2025 XiLLeR GmbH – <a href="https://www.xiller.de/Impressum/" className="hover:text-purple-300 transition-colors">Impressum</a> | <a href="https://www.xiller.de/datenschutzerklaerung/" className="hover:text-purple-300 transition-colors">Datenschutzerklärung</a>
          </p>
          <p className="text-slate-400 text-xs mt-1">
            <a href="https://www.beste-medien-werbe-agentur.de/Angebot/Consulting.html" className="hover:text-purple-300 transition-colors">
              Konzeption, Design, Programmierung: Beste Medien Werbe Agentur
            </a>
          </p>
        </div>
      </div>
    </div>
  );
};

export default Index;
