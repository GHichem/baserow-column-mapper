
import React, { useState } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/hooks/use-toast';
import { useNavigate } from 'react-router-dom';
import FileUpload from './FileUpload';
import SuccessMessage from './SuccessMessage';
import { uploadToBaserow } from '@/utils/baserowApi';
import { User, Building, FileUp } from 'lucide-react';

interface FormData {
  vorname: string;
  nachname: string;
  email: string;
  company: string;
  file: File | null;
}

const FileUploadForm = () => {
  const [formData, setFormData] = useState<FormData>({
    vorname: '',
    nachname: '',
    email: '',
    company: '',
    file: null,
  });
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [showSuccess, setShowSuccess] = useState(false);
  const { toast } = useToast();
  const navigate = useNavigate();

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const { name, value } = e.target;
    setFormData(prev => ({
      ...prev,
      [name]: value,
    }));
  };

  const handleFileSelect = (file: File) => {
    setFormData(prev => ({
      ...prev,
      file,
    }));
  };

  const validateForm = (): boolean => {
    if (!formData.vorname.trim()) {
      toast({
        title: "Fehler",
        description: "Bitte geben Sie Ihren Vornamen ein.",
        variant: "destructive",
      });
      return false;
    }

    if (!formData.nachname.trim()) {
      toast({
        title: "Fehler",
        description: "Bitte geben Sie Ihren Nachnamen ein.",
        variant: "destructive",
      });
      return false;
    }

    if (!formData.email.trim()) {
      toast({
        title: "Fehler",
        description: "Bitte geben Sie Ihre E-Mail-Adresse ein.",
        variant: "destructive",
      });
      return false;
    }

    if (!formData.company.trim()) {
      toast({
        title: "Fehler",
        description: "Bitte geben Sie Ihr Unternehmen ein.",
        variant: "destructive",
      });
      return false;
    }

    if (!formData.file) {
      toast({
        title: "Fehler",
        description: "Bitte wählen Sie eine Datei aus.",
        variant: "destructive",
      });
      return false;
    }

    return true;
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validateForm()) {
      return;
    }

    setIsSubmitting(true);

    try {
      // Store only basic file info instead of entire content
      sessionStorage.setItem('originalFile', JSON.stringify({
        name: formData.file!.name,
        type: formData.file!.type,
        size: formData.file!.size,
      }));
      await uploadToBaserow({
        vorname: formData.vorname,
        nachname: formData.nachname,
        email: formData.email,
        company: formData.company,
        file: formData.file!,
      });
      toast({
        title: "Upload erfolgreich",
        description: "Ihre Daten wurden erfolgreich hochgeladen.",
      });

      // Navigate to column mapping page instead of showing success
      navigate('/column-mapping');

    } catch (error) {
      let errorMessage = "Beim Hochladen ist ein Fehler aufgetreten. Bitte versuchen Sie es erneut.";
      
      if (error instanceof Error) {
        // Show the specific error message from the API
        errorMessage = error.message;
      }
      
      toast({
        title: "Fehler",
        description: errorMessage,
        variant: "destructive",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  const resetSuccess = () => {
    setShowSuccess(false);
  };

  if (showSuccess) {
    return <SuccessMessage onReset={resetSuccess} />;
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {/* Personal Information Section */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 mb-3">
          <div className="p-1.5 rounded-lg bg-gradient-to-r from-purple-600 to-pink-600">
            <User className="h-4 w-4 text-white" />
          </div>
          <h3 className="text-base font-semibold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">Persönliche Daten</h3>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <div className="space-y-1.5">
            <Label htmlFor="vorname" className="text-xs font-medium text-gray-300">
              Vorname *
            </Label>
            <Input
              id="vorname"
              name="vorname"
              type="text"
              value={formData.vorname}
              onChange={handleInputChange}
              placeholder="Max"
              className="bg-slate-700/50 border-slate-600 text-white placeholder:text-gray-400 focus:border-purple-500 focus:ring-purple-500/30 backdrop-blur-sm"
              required
            />
          </div>

          <div className="space-y-1.5">
            <Label htmlFor="nachname" className="text-xs font-medium text-gray-300">
              Nachname *
            </Label>
            <Input
              id="nachname"
              name="nachname"
              type="text"
              value={formData.nachname}
              onChange={handleInputChange}
              placeholder="Mustermann"
              className="bg-slate-700/50 border-slate-600 text-white placeholder:text-gray-400 focus:border-purple-500 focus:ring-purple-500/30 backdrop-blur-sm"
              required
            />
          </div>
        </div>

        <div className="space-y-1.5">
          <Label htmlFor="email" className="text-xs font-medium text-gray-300">
            E-Mail *
          </Label>
          <Input
            id="email"
            name="email"
            type="email"
            value={formData.email}
            onChange={handleInputChange}
            placeholder="max@example.com"
            className="bg-slate-700/50 border-slate-600 text-white placeholder:text-gray-400 focus:border-purple-500 focus:ring-purple-500/30 backdrop-blur-sm"
            required
          />
        </div>
      </div>

      {/* Company Information Section */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 mb-3">
          <div className="p-1.5 rounded-lg bg-gradient-to-r from-cyan-600 to-blue-600">
            <Building className="h-4 w-4 text-white" />
          </div>
          <h3 className="text-base font-semibold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">Unternehmen</h3>
        </div>
        
        <div className="space-y-1.5">
          <Label htmlFor="company" className="text-xs font-medium text-gray-300">
            Firmenname *
          </Label>
          <Input
            id="company"
            name="company"
            type="text"
            value={formData.company}
            onChange={handleInputChange}
            placeholder="Muster GmbH"
            className="bg-slate-700/50 border-slate-600 text-white placeholder:text-gray-400 focus:border-purple-500 focus:ring-purple-500/30 backdrop-blur-sm"
            required
          />
        </div>
      </div>

      {/* File Upload Section */}
      <div className="space-y-3">
        <div className="flex items-center gap-2 mb-3">
          <div className="p-1.5 rounded-lg bg-gradient-to-r from-green-600 to-emerald-600">
            <FileUp className="h-4 w-4 text-white" />
          </div>
          <h3 className="text-base font-semibold bg-gradient-to-r from-white to-gray-300 bg-clip-text text-transparent">Datei Upload</h3>
        </div>
        
        <FileUpload
          onFileSelect={handleFileSelect}
          selectedFile={formData.file}
        />
      </div>

      {/* Submit Button */}
      <div className="pt-4 border-t border-slate-700/50">
        <Button
          type="submit"
          disabled={isSubmitting}
          className="w-full bg-gradient-to-r from-purple-600 via-pink-600 to-cyan-600 hover:from-purple-700 hover:via-pink-700 hover:to-cyan-700 text-white py-2.5 text-base font-medium transition-all duration-300 shadow-xl shadow-purple-500/30 hover:shadow-purple-500/50 border-0 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {isSubmitting ? (
            <>
              <div className="animate-spin rounded-full h-5 w-5 border-2 border-white border-t-transparent mr-3"></div>
              <span className="font-medium">Wird hochgeladen...</span>
            </>
          ) : (
            <span className="font-medium">Daten speichern</span>
          )}
        </Button>
      </div>
    </form>
  );
};

export default FileUploadForm;
