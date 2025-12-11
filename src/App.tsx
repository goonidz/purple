import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import Home from "./pages/Home";
import Index from "./pages/Index";
import Projects from "./pages/Projects";
import Auth from "./pages/Auth";

import TestScenes from "./pages/TestScenes";
import Profile from "./pages/Profile";
import Calendar from "./pages/Calendar";
import CreateFromScratch from "./pages/CreateFromScratch";
import StandaloneThumbnails from "./pages/StandaloneThumbnails";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/project" element={<Index />} />
          <Route path="/projects" element={<Projects />} />
          
          <Route path="/calendar" element={<Calendar />} />
          <Route path="/create-from-scratch" element={<CreateFromScratch />} />
          <Route path="/thumbnails" element={<StandaloneThumbnails />} />
          <Route path="/test-scenes" element={<TestScenes />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/auth" element={<Auth />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
