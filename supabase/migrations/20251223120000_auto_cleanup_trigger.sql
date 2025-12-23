-- Alternative: Trigger automatique via PostgreSQL
-- Cette migration crée un trigger qui nettoie automatiquement les images
-- quand une nouvelle image est ajoutée (si elle a plus de 7 jours)

-- Fonction pour nettoyer les anciennes images
CREATE OR REPLACE FUNCTION public.cleanup_old_images_trigger()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  cleanup_count INTEGER := 0;
BEGIN
  -- Cette fonction est appelée automatiquement
  -- Pour l'instant, elle ne fait rien car le nettoyage doit être fait
  -- via l'Edge Function qui a accès au Storage
  
  -- Note: PostgreSQL ne peut pas directement supprimer des fichiers Storage
  -- Il faut utiliser l'Edge Function
  
  RETURN NEW;
END;
$$;

-- Alternative: Utiliser un service externe (cron-job.org) est recommandé
-- Voir scripts/setup-cron-job-org.md pour les instructions
