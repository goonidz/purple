import { useState, useEffect } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Card } from "@/components/ui/card";
import { toast } from "sonner";
import { Loader2, Sparkles, Chrome } from "lucide-react";
import { z } from "zod";

const authSchema = z.object({
  email: z.string().email("Email invalide").max(255, "Email trop long"),
  password: z.string().min(6, "Le mot de passe doit contenir au moins 6 caractères").max(100, "Mot de passe trop long"),
});

const Auth = () => {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const [isLogin, setIsLogin] = useState(true);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [authSent, setAuthSent] = useState(false);
  
  // Check if this is for the Chrome extension
  const isExtensionAuth = searchParams.get('extension') === 'true';

  useEffect(() => {
    document.title = isExtensionAuth ? "Connexion Extension" : "Connexion";
  }, [isExtensionAuth]);

  useEffect(() => {
    // Check if user is already logged in
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        if (isExtensionAuth) {
          // Send token to extension via postMessage
          sendAuthToExtension(session);
        } else {
          navigate("/");
        }
      }
    });

    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, session) => {
      if (session && event === 'SIGNED_IN') {
        if (isExtensionAuth) {
          // Send token to extension via postMessage
          sendAuthToExtension(session);
        } else {
          navigate("/");
        }
      }
    });

    return () => subscription.unsubscribe();
  }, [navigate, isExtensionAuth]);
  
  const sendAuthToExtension = (session: any) => {
    if (authSent) return; // Prevent duplicate sends
    
    console.log('[VideoFlow Auth] Sending auth to extension');
    
    try {
      window.postMessage({
        type: 'VIDEOFLOW_AUTH_SUCCESS',
        token: session.access_token,
        user: {
          id: session.user.id,
          email: session.user.email
        },
        supabaseUrl: import.meta.env.VITE_SUPABASE_URL,
        supabaseAnonKey: import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY
      }, window.location.origin);
      
      setAuthSent(true);
      toast.success("✅ Connexion réussie ! Retournez à l'extension.");
    } catch (error) {
      console.error('[VideoFlow Auth] Error sending auth to extension:', error);
      toast.error("Erreur lors de l'envoi du token à l'extension");
    }
  };

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    
    // Validate input
    try {
      authSchema.parse({ email, password });
    } catch (error) {
      if (error instanceof z.ZodError) {
        toast.error(error.errors[0].message);
        return;
      }
    }

    setIsLoading(true);

    try {
      if (isLogin) {
        const { error } = await supabase.auth.signInWithPassword({
          email: email.trim(),
          password,
        });

        if (error) {
          if (error.message.includes("Invalid login credentials")) {
            toast.error("Email ou mot de passe incorrect");
          } else {
            toast.error(error.message);
          }
          return;
        }

        toast.success("Connexion réussie !");
      } else {
        const redirectUrl = `${window.location.origin}/`;
        
        const { error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: {
            emailRedirectTo: redirectUrl,
          },
        });

        if (error) {
          if (error.message.includes("User already registered")) {
            toast.error("Cet email est déjà enregistré");
          } else {
            toast.error(error.message);
          }
          return;
        }

        toast.success("Compte créé avec succès ! Vous pouvez maintenant vous connecter.");
      }
    } catch (error: any) {
      toast.error("Une erreur est survenue");
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex items-center justify-center bg-gradient-to-br from-primary/5 via-background to-secondary/5 p-4">
      <Card className="w-full max-w-md p-8 space-y-6">
        {authSent && isExtensionAuth ? (
          // Success message for extension auth
          <div className="text-center space-y-6">
            <div className="flex justify-center">
              <div className="p-4 bg-green-100 dark:bg-green-900/30 rounded-full">
                <Chrome className="h-12 w-12 text-green-600 dark:text-green-400" />
              </div>
            </div>
            <div className="space-y-2">
              <h2 className="text-2xl font-bold text-green-600 dark:text-green-400">
                ✅ Connexion réussie !
              </h2>
              <p className="text-muted-foreground">
                Vous pouvez maintenant fermer cet onglet et retourner à l'extension Chrome.
              </p>
            </div>
            <Button 
              onClick={() => window.close()}
              variant="outline"
              className="w-full"
            >
              Fermer cet onglet
            </Button>
          </div>
        ) : (
          <>
            <div className="text-center space-y-2">
              {isExtensionAuth && (
                <div className="flex justify-center mb-2">
                  <div className="px-3 py-1 bg-blue-100 dark:bg-blue-900/30 rounded-full flex items-center gap-2">
                    <Chrome className="h-4 w-4 text-blue-600 dark:text-blue-400" />
                    <span className="text-sm text-blue-600 dark:text-blue-400 font-medium">
                      Extension Chrome
                    </span>
                  </div>
                </div>
              )}
              <div className="flex justify-center mb-4">
                <div className="p-3 bg-primary/10 rounded-full">
                  <Sparkles className="h-8 w-8 text-primary" />
                </div>
              </div>
              <h1 className="text-3xl font-bold">
                {isLogin ? "Connexion" : "Créer un compte"}
              </h1>
              <p className="text-muted-foreground">
                {isExtensionAuth 
                  ? "Connectez-vous pour utiliser l'extension Chrome"
                  : isLogin
                    ? "Connectez-vous pour accéder à vos projets"
                    : "Créez un compte pour commencer"}
              </p>
            </div>

        <form onSubmit={handleAuth} className="space-y-4">
          <div className="space-y-2">
            <label htmlFor="email" className="text-sm font-medium">
              Email
            </label>
            <Input
              id="email"
              type="email"
              placeholder="votre@email.com"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              maxLength={255}
            />
          </div>

          <div className="space-y-2">
            <label htmlFor="password" className="text-sm font-medium">
              Mot de passe
            </label>
            <Input
              id="password"
              type="password"
              placeholder="••••••••"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              minLength={6}
              maxLength={100}
            />
          </div>

          <Button
            type="submit"
            className="w-full"
            disabled={isLoading}
          >
            {isLoading ? (
              <>
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                Chargement...
              </>
            ) : (
              <>{isLogin ? "Se connecter" : "Créer un compte"}</>
            )}
          </Button>
        </form>

            <div className="text-center">
              <button
                type="button"
                onClick={() => setIsLogin(!isLogin)}
                className="text-sm text-primary hover:underline"
              >
                {isLogin
                  ? "Pas encore de compte ? Inscrivez-vous"
                  : "Déjà un compte ? Connectez-vous"}
              </button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
};

export default Auth;
