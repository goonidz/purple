# Configuration des Presets par Chaîne

## Vue d'ensemble

Cette fonctionnalité permet d'associer des presets par défaut à chaque chaîne YouTube. Lorsque vous lancez une génération depuis le calendrier pour une vidéo associée à une chaîne, les presets configurés pour cette chaîne sont automatiquement sélectionnés.

## Avantages

- **Gain de temps** : Plus besoin de sélectionner manuellement les presets à chaque génération
- **Cohérence** : Assurez-vous que toutes les vidéos d'une même chaîne utilisent les mêmes paramètres
- **Flexibilité** : Possibilité de modifier les presets sélectionnés avant de lancer la génération

## Types de Presets Supportés

Chaque chaîne peut avoir les presets suivants configurés :

1. **Preset de script** : Définit le style et la structure du script généré
2. **Preset TTS (voix)** : Définit la voix et les paramètres audio (Inworld/Minimax)
3. **Preset projet** : Définit les durées de scènes, prompts exemples, modèle d'image et LoRA
4. **Preset miniatures** : Définit les images d'exemple et le style pour la génération de miniatures
   - Peut être désactivé individuellement avec un switch

## Comment Configurer

### 1. Accéder au Gestionnaire de Chaînes

- Ouvrez le calendrier
- Cliquez sur "Gérer les chaînes" ou créez une nouvelle entrée dans le calendrier
- Le gestionnaire de chaînes s'affiche avec la liste de vos chaînes

### 2. Configurer les Presets d'une Chaîne

1. Cliquez sur l'icône **⚙️ (Settings)** à côté de la chaîne que vous souhaitez configurer
2. Une fenêtre de configuration s'ouvre avec 4 sections :
   - **Preset de script** : Sélectionnez un preset de script (optionnel)
   - **Preset TTS** : Sélectionnez un preset de voix (optionnel)
   - **Preset projet** : Sélectionnez un preset de configuration projet (optionnel)
   - **Preset miniatures** : Sélectionnez un preset de miniatures et activez/désactivez avec le switch
3. Cliquez sur **Enregistrer** pour sauvegarder la configuration

### 3. Utiliser les Presets Configurés

1. Dans le calendrier, créez ou ouvrez une vidéo
2. Sélectionnez la chaîne dans le champ "Chaîne"
3. Cliquez sur "Lancer le projet"
4. Les presets de la chaîne sélectionnée seront automatiquement appliqués :
   - **Flux "De zéro"** : Les presets de script et TTS sont automatiquement sélectionnés
   - **Flux "Avec audio"** : Les presets de projet et miniatures sont automatiquement sélectionnés
5. Vous pouvez modifier les presets avant de lancer la génération si nécessaire

## Flux de Données

```
Calendrier (Vidéo + Chaîne)
    ↓
Sélection de la chaîne
    ↓
Lancement du projet
    ↓
┌────────────────────────────────┐
│  CreateFromScratch (De zéro)   │
│  • Script preset auto-chargé   │
│  • TTS preset auto-chargé      │
└────────────────────────────────┘
    ↓
Configuration du projet
    ↓
┌────────────────────────────────┐
│ ProjectConfigurationModal      │
│ • Projet preset auto-chargé    │
│ • Miniatures preset auto-chargé│
└────────────────────────────────┘
```

## Architecture Technique

### Base de Données

La table `channels` a été enrichie avec les colonnes suivantes :

- `script_preset_id` : UUID référençant `script_presets.id`
- `tts_preset_id` : UUID référençant `tts_presets.id`
- `project_preset_id` : UUID référençant `presets.id`
- `thumbnail_preset_id` : UUID référençant `thumbnail_presets.id`
- `thumbnail_preset_enabled` : BOOLEAN (défaut: true)

### Composants Modifiés

1. **ChannelManager.tsx** : Interface de configuration des presets par chaîne
2. **CalendarVideoModal.tsx** : Passe les preset IDs via sessionStorage
3. **CreateFromScratch.tsx** : Charge automatiquement les presets de script et TTS
4. **Projects.tsx** : Gère le transfert des presets de projet et miniatures
5. **ProjectConfigurationModal.tsx** : Charge automatiquement les presets de projet et miniatures

### SessionStorage

Les clés suivantes sont utilisées pour transférer les presets entre les pages :

- `calendar_script_preset_id` : ID du preset de script
- `calendar_tts_preset_id` : ID du preset TTS
- `calendar_project_preset_id` : ID du preset projet (converti en `auto_load_project_preset_id`)
- `calendar_thumbnail_preset_id` : ID du preset miniatures (converti en `auto_load_thumbnail_preset_id`)

## Notes Importantes

- Les presets sont **optionnels** : vous pouvez ne configurer que certains presets pour une chaîne
- Le preset miniatures peut être **désactivé** individuellement avec le switch
- Les presets auto-chargés peuvent toujours être **modifiés** avant le lancement de la génération
- Si aucun preset n'est configuré pour une chaîne, le comportement est identique à avant (sélection manuelle)

## Migration

Pour utiliser cette fonctionnalité, vous devez :

1. Appliquer la migration SQL : `supabase/migrations/20260108_add_channel_preset_associations.sql`
2. Redémarrer l'application pour charger les nouveaux types TypeScript

La migration ajoute les colonnes nécessaires à la table `channels` sans affecter les données existantes.
