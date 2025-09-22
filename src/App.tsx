

import { Toaster } from "@/components/ui/toaster";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Index from "./pages/Index";
import ColumnMappingPage from "./pages/ColumnMappingPage";
import NotFound from "./pages/NotFound";
import React, { useEffect } from "react";


const queryClient = new QueryClient();

const App = () => {
  useEffect(() => {
    const handleF8 = (e: KeyboardEvent) => {
      if (e.key === "F8") {
        e.preventDefault();
        e.stopPropagation();
      }
    };
    window.addEventListener("keydown", handleF8, true);
    return () => window.removeEventListener("keydown", handleF8, true);
  }, []);

  return (
    <QueryClientProvider client={queryClient}>
      <Toaster />
      {/* Hidden inputs to help browser/password-manager autofill extensions locate fields
          and avoid extension-side errors like "Cannot read properties of null (reading 'username')".
          These are intentionally visually hidden and non-focusable. */}
      <div aria-hidden="true" style={{display: "none"}}>
        <input
          name="username"
          id="username-autofill-workaround"
          autoComplete="username"
          tabIndex={-1}
        />
        <input
          name="password"
          id="password-autofill-workaround"
          type="password"
          autoComplete="current-password"
          tabIndex={-1}
        />
      </div>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Index />} />
          <Route path="/column-mapping" element={<ColumnMappingPage />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </QueryClientProvider>
  );
};

export default App;
