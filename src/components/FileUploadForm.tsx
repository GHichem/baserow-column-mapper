
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
      console.error('Upload error:', error);
      toast({
        title: "Fehler",
        description: "Beim Hochladen ist ein Fehler aufgetreten. Bitte versuchen Sie es erneut.",
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
    <form onSubmit={handleSubmit} className="space-y-6">
      {/* Personal Information Section */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 mb-4">
          <User className="h-5 w-5 text-blue-600" />
          <h3 className="text-lg font-semibold text-gray-800">Persönliche Daten</h3>
        </div>
        
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor="vorname" className="text-sm font-medium text-gray-700">
              Vorname *
            </Label>
            <Input
              id="vorname"
              name="vorname"
              type="text"
              value={formData.vorname}
              onChange={handleInputChange}
              placeholder="Max"
              className="border-gray-300 focus:border-blue-500 focus:ring-blue-500"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="nachname" className="text-sm font-medium text-gray-700">
              Nachname *
            </Label>
            <Input
              id="nachname"
              name="nachname"
              type="text"
              value={formData.nachname}
              onChange={handleInputChange}
              placeholder="Mustermann"
              className="border-gray-300 focus:border-blue-500 focus:ring-blue-500"
              required
            />
          </div>
        </div>

        <div className="space-y-2">
          <Label htmlFor="email" className="text-sm font-medium text-gray-700">
            E-Mail *
          </Label>
          <Input
            id="email"
            name="email"
            type="email"
            value={formData.email}
            onChange={handleInputChange}
            placeholder="max@example.com"
            className="border-gray-300 focus:border-blue-500 focus:ring-blue-500"
            required
          />
        </div>
      </div>

      {/* Company Information Section */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 mb-4">
          <Building className="h-5 w-5 text-blue-600" />
          <h3 className="text-lg font-semibold text-gray-800">Unternehmen</h3>
        </div>
        
        <div className="space-y-2">
          <Label htmlFor="company" className="text-sm font-medium text-gray-700">
            Firmenname *
          </Label>
          <Input
            id="company"
            name="company"
            type="text"
            value={formData.company}
            onChange={handleInputChange}
            placeholder="Muster GmbH"
            className="border-gray-300 focus:border-blue-500 focus:ring-blue-500"
            required
          />
        </div>
      </div>

      {/* File Upload Section */}
      <div className="space-y-4">
        <div className="flex items-center gap-2 mb-4">
          <FileUp className="h-5 w-5 text-blue-600" />
          <h3 className="text-lg font-semibold text-gray-800">Datei Upload</h3>
        </div>
        
        <FileUpload
          onFileSelect={handleFileSelect}
          selectedFile={formData.file}
        />
      </div>

      {/* Submit Button */}
      <div className="pt-6 border-t border-gray-200">
        <Button
          type="submit"
          disabled={isSubmitting}
          className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-700 hover:to-purple-700 text-white py-3 text-lg font-medium transition-all duration-200 transform hover:scale-[1.02]"
        >
          {isSubmitting ? (
            <>
              <div className="animate-spin rounded-full h-5 w-5 border-b-2 border-white mr-2"></div>
              Wird hochgeladen...
            </>
          ) : (
            'Daten speichern'
          )}
        </Button>
      </div>
    </form>
  );
};

export default FileUploadForm;
