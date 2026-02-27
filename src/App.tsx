import { useEffect } from "react";
import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route, useNavigate, useLocation } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";
import Home from "./pages/Home";
import Index from "./pages/Index";
import Projects from "./pages/Projects";
import Auth from "./pages/Auth";
import Competitors from "./pages/Competitors";

import TestScenes from "./pages/TestScenes";
import Profile from "./pages/Profile";
import Calendar from "./pages/Calendar";
import CreateFromScratch from "./pages/CreateFromScratch";
import StandaloneThumbnails from "./pages/StandaloneThumbnails";
import StandaloneAudio from "./pages/StandaloneAudio";
import StandaloneIdeas from "./pages/StandaloneIdeas";
import Feed from "./pages/Feed";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

function AuthGuard({ children }: { children: React.ReactNode }) {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      async (event, session) => {
        if (event === 'SIGNED_OUT' || event === 'TOKEN_REFRESHED' && !session) {
          if (location.pathname !== '/auth') {
            toast.error("Session expirée — reconnectez-vous");
            navigate('/auth');
          }
        }

        if (event === 'TOKEN_REFRESHED' && session) {
          console.log('[Auth] Token refreshed successfully');
        }
      }
    );

    return () => subscription.unsubscribe();
  }, [navigate, location.pathname]);

  return <>{children}</>;
}

const App = () => (
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <BrowserRouter>
        <AuthGuard>
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/project" element={<Index />} />
          <Route path="/projects" element={<Projects />} />
          
          <Route path="/calendar" element={<Calendar />} />
          <Route path="/competitors" element={<Competitors />} />
          <Route path="/create-from-scratch" element={<CreateFromScratch />} />
          <Route path="/thumbnails" element={<StandaloneThumbnails />} />
          <Route path="/audio" element={<StandaloneAudio />} />
          <Route path="/ideas" element={<StandaloneIdeas />} />
          <Route path="/test-scenes" element={<TestScenes />} />
          <Route path="/profile" element={<Profile />} />
          <Route path="/auth" element={<Auth />} />
          <Route path="/feed" element={<Feed />} />
          {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
          <Route path="*" element={<NotFound />} />
        </Routes>
        </AuthGuard>
      </BrowserRouter>
    </TooltipProvider>
  </QueryClientProvider>
);

export default App;
