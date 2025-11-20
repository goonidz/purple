import { useState } from "react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useNavigate } from "react-router-dom";
import { Key, Video, Image, Mic, ChevronRight, ChevronLeft, CheckCircle2 } from "lucide-react";
import { Card } from "@/components/ui/card";

interface OnboardingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

const OnboardingDialog = ({ open, onOpenChange }: OnboardingDialogProps) => {
  const navigate = useNavigate();
  const [step, setStep] = useState(0);

  const steps = [
    {
      title: "Bienvenue sur votre plateforme audio-to-video ! 🎉",
      description: "Transformez vos contenus audio en vidéos captivantes avec des images générées par IA.",
      icon: Video,
      color: "text-primary",
    },
    {
      title: "Configuration requise",
      description: "Pour utiliser cette plateforme, vous devez configurer 2 clés API dans votre profil.",
      icon: Key,
      color: "text-yellow-500",
    },
    {
      title: "Replicate API Key",
      description: "Utilisée pour générer les images de vos scènes avec SeedDream 4. Cette clé permet de créer des visuels époustouflants pour chaque moment de votre contenu.",
      icon: Image,
      color: "text-purple-500",
      link: "https://replicate.com/account/api-tokens",
      linkText: "Obtenir ma clé Replicate"
    },
    {
      title: "Eleven Labs API Key",
      description: "Utilisée pour transcrire automatiquement vos fichiers audio en texte. Cette clé permet d'analyser votre contenu et de créer des scènes intelligentes basées sur votre audio.",
      icon: Mic,
      color: "text-blue-500",
      link: "https://elevenlabs.io/app/settings/api-keys",
      linkText: "Obtenir ma clé Eleven Labs"
    },
    {
      title: "C'est parti ! 🚀",
      description: "Une fois vos clés API configurées, vous pourrez créer des projets et transformer vos audios en vidéos professionnelles.",
      icon: CheckCircle2,
      color: "text-green-500",
    }
  ];

  const currentStep = steps[step];
  const Icon = currentStep.icon;

  const handleNext = () => {
    if (step < steps.length - 1) {
      setStep(step + 1);
    }
  };

  const handlePrevious = () => {
    if (step > 0) {
      setStep(step - 1);
    }
  };

  const handleGoToProfile = () => {
    localStorage.setItem("onboarding_completed", "true");
    onOpenChange(false);
    navigate("/profile");
  };

  const handleSkip = () => {
    localStorage.setItem("onboarding_skipped", "true");
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-[600px]">
        <DialogHeader>
          <DialogTitle className="text-2xl font-bold flex items-center gap-2">
            <Icon className={`h-7 w-7 ${currentStep.color}`} />
            {currentStep.title}
          </DialogTitle>
          <DialogDescription className="text-base pt-4">
            {currentStep.description}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-4 py-4">
          {currentStep.link && (
            <Card className="p-4 bg-muted/50 border-2 border-dashed">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Key className="h-5 w-5 text-muted-foreground" />
                  <span className="text-sm font-medium">Besoin de cette clé ?</span>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => window.open(currentStep.link, "_blank")}
                >
                  {currentStep.linkText}
                </Button>
              </div>
            </Card>
          )}

          {/* Progress indicator */}
          <div className="flex items-center justify-center gap-2 pt-4">
            {steps.map((_, index) => (
              <div
                key={index}
                className={`h-2 rounded-full transition-all ${
                  index === step
                    ? "w-8 bg-primary"
                    : index < step
                    ? "w-2 bg-primary/50"
                    : "w-2 bg-muted"
                }`}
              />
            ))}
          </div>
        </div>

        <div className="flex items-center justify-between gap-2 pt-4">
          <Button
            variant="ghost"
            onClick={handleSkip}
            disabled={step === steps.length - 1}
          >
            Passer
          </Button>

          <div className="flex gap-2">
            <Button
              variant="outline"
              onClick={handlePrevious}
              disabled={step === 0}
            >
              <ChevronLeft className="h-4 w-4 mr-1" />
              Précédent
            </Button>

            {step === steps.length - 1 ? (
              <Button onClick={handleGoToProfile} className="gap-2">
                Configurer mes clés API
                <Key className="h-4 w-4" />
              </Button>
            ) : (
              <Button onClick={handleNext}>
                Suivant
                <ChevronRight className="h-4 w-4 ml-1" />
              </Button>
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default OnboardingDialog;
