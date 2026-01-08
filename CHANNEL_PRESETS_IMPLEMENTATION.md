# Implémentation des Master Presets par Chaîne

## Résumé

Implémentation complète de la fonctionnalité permettant d'associer des presets par défaut à chaque chaîne YouTube. Lorsqu'une génération est lancée depuis le calendrier, les presets configurés pour la chaîne sont automatiquement sélectionnés.

## Fichiers Modifiés

### 1. Migration Base de Données

**Nouveau fichier** : `supabase/migrations/20260108_add_channel_preset_associations.sql`

Ajoute 5 nouvelles colonnes à la table `channels` :
- `script_preset_id` (UUID, FK vers script_presets)
- `tts_preset_id` (UUID, FK vers tts_presets)
- `project_preset_id` (UUID, FK vers presets)
- `thumbnail_preset_id` (UUID, FK vers thumbnail_presets)
- `thumbnail_preset_enabled` (BOOLEAN, défaut: true)

### 2. Types TypeScript

**Fichier modifié** : `src/integrations/supabase/types.ts`

- Mise à jour de l'interface `channels` pour inclure les nouvelles colonnes
- Ajout des relations (Relationships) vers les tables de presets

### 3. Gestionnaire de Chaînes

**Fichier modifié** : `src/components/ChannelManager.tsx`

Modifications majeures :
- Ajout d'interfaces pour les différents types de presets
- Ajout d'états pour gérer la configuration des presets
- Création d'un nouveau composant `PresetConfigDialog` pour la configuration
- Ajout d'un bouton "Settings" sur chaque chaîne pour ouvrir la configuration
- Implémentation des fonctions :
  - `loadPresets()` : Charge tous les types de presets disponibles
  - `handleConfigurePresets()` : Ouvre le dialog de configuration
  - `handleSavePresets()` : Sauvegarde les associations preset-chaîne

Interface du dialog de configuration :
- 4 sélecteurs de presets (Script, TTS, Projet, Miniatures)
- Switch pour activer/désactiver le preset miniatures
- Descriptions explicatives pour chaque type de preset

### 4. Modal Calendrier

**Fichier modifié** : `src/components/CalendarVideoModal.tsx`

- Mise à jour de l'interface `Channel` pour inclure les nouveaux champs
- Modification de `handleLaunchFromScratch()` :
  - Stocke les preset IDs de la chaîne dans sessionStorage
  - Gère le cas où aucune chaîne n'est sélectionnée (nettoyage du storage)
- Modification de `handleLaunchWithAudio()` :
  - Stocke les presets de projet et miniatures pour le flux avec audio

### 5. Création De Zéro

**Fichier modifié** : `src/pages/CreateFromScratch.tsx`

- Lecture des preset IDs depuis sessionStorage quand venant du calendrier
- Auto-chargement des presets :
  - **Script preset** : Applique le custom_prompt et sélectionne le preset
  - **TTS preset** : Applique avec la fonction `applyTtsPreset()` en mode silencieux
- Transfert des presets de projet et miniatures vers le storage auto-load
- Nettoyage du sessionStorage après utilisation

### 6. Gestion de Projets

**Fichier modifié** : `src/pages/Projects.tsx`

- Lecture des preset IDs depuis sessionStorage
- Transfert vers les clés auto-load pour utilisation par ProjectConfigurationModal
- Nettoyage du sessionStorage après transfert

### 7. Modal Configuration Projet

**Fichier modifié** : `src/components/ProjectConfigurationModal.tsx`

- Ajout d'un useEffect pour auto-charger les presets depuis sessionStorage
- Chargement automatique du **preset projet** via `handleLoadPreset()`
- Sélection automatique du **preset miniatures**
- Affichage de toasts de confirmation
- Nettoyage des clés auto-load après utilisation

### 8. Composant PresetManager

**Fichier modifié** : `src/components/PresetManager.tsx`

- Ajout d'une prop optionnelle `autoLoadPresetId` pour l'auto-chargement
- Ajout d'un useEffect pour détecter et charger automatiquement un preset
- Affichage d'un toast de confirmation lors de l'auto-chargement
- Utilisé par Index.tsx et Projects.tsx pour la configuration des scènes

### 9. Page Index (Configuration des scènes)

**Fichier modifié** : `src/pages/Index.tsx`

- Ajout de la prop `autoLoadPresetId` au composant PresetManager
- Lecture de `auto_load_project_preset_id` depuis sessionStorage
- Nettoyage du sessionStorage après le chargement dans `handleLoadPreset()`
- Permet l'auto-chargement des presets de chaîne dans la configuration des scènes

### 10. Page Projects (Workflow avec audio)

**Fichier modifié** : `src/pages/Projects.tsx`

- Ajout de la prop `autoLoadPresetId` au composant PresetManager
- Lecture de `auto_load_project_preset_id` depuis sessionStorage
- Nettoyage du sessionStorage après le chargement
- Permet l'auto-chargement des presets de chaîne dans le workflow avec audio

### 11. Documentation

**Nouveaux fichiers** :
- `docs/CHANNEL_PRESETS.md` : Guide utilisateur complet
- `CHANNEL_PRESETS_IMPLEMENTATION.md` : Ce document (résumé technique)

## Flux de Données Complet

### Flux 1 : Création "De Zéro" (avec script)

```
1. Calendrier : Sélection d'une vidéo avec chaîne
2. CalendarVideoModal : Stocke les 4 preset IDs dans sessionStorage
3. CreateFromScratch :
   - Charge et applique script_preset_id
   - Charge et applique tts_preset_id
   - Transfère project_preset_id → auto_load_project_preset_id
   - Transfère thumbnail_preset_id → auto_load_thumbnail_preset_id
4. Génération audio, puis redirection vers Projects ou Index
5. ProjectConfigurationModal :
   - Charge auto_load_project_preset_id
   - Charge auto_load_thumbnail_preset_id
```

### Flux 2 : Création "Avec Audio"

```
1. Calendrier : Sélection d'une vidéo avec chaîne et audio
2. CalendarVideoModal : Stocke project_preset_id et thumbnail_preset_id
3. Projects :
   - Transfère vers auto_load_project_preset_id
   - Transfère vers auto_load_thumbnail_preset_id
4. Transcription de l'audio
5. ProjectConfigurationModal :
   - Charge auto_load_project_preset_id
   - Charge auto_load_thumbnail_preset_id
```

## Clés SessionStorage Utilisées

| Clé | Source | Destination | Usage |
|-----|--------|-------------|-------|
| `calendar_script_preset_id` | CalendarVideoModal | CreateFromScratch | Preset de script |
| `calendar_tts_preset_id` | CalendarVideoModal | CreateFromScratch | Preset TTS |
| `calendar_project_preset_id` | CalendarVideoModal | CreateFromScratch / Projects | Preset projet (temporaire) |
| `calendar_thumbnail_preset_id` | CalendarVideoModal | CreateFromScratch / Projects | Preset miniatures (temporaire) |
| `auto_load_project_preset_id` | CreateFromScratch / Projects | ProjectConfigurationModal | Preset projet (auto-load) |
| `auto_load_thumbnail_preset_id` | CreateFromScratch / Projects | ProjectConfigurationModal | Preset miniatures (auto-load) |

## Fonctionnalités Clés

### 1. Configuration Flexible

- Tous les presets sont **optionnels**
- Chaque type peut être configuré indépendamment
- Le preset miniatures peut être désactivé avec un switch

### 2. Auto-Chargement Intelligent

- Les presets sont chargés uniquement quand ils existent
- Messages de confirmation affichés pour chaque preset chargé
- Aucune erreur si un preset n'est pas trouvé

### 3. Compatibilité Ascendante

- Aucun changement dans le comportement si aucun preset n'est configuré
- Les vidéos sans chaîne fonctionnent normalement
- Les chaînes existantes continuent de fonctionner sans configuration

## Tests Recommandés

### Test 1 : Configuration d'une Chaîne

1. Ouvrir le gestionnaire de chaînes
2. Cliquer sur l'icône Settings d'une chaîne
3. Sélectionner un preset de chaque type
4. Enregistrer et vérifier que les modifications sont sauvegardées

### Test 2 : Flux "De Zéro"

1. Créer une vidéo dans le calendrier
2. Sélectionner une chaîne avec presets configurés
3. Lancer "De zéro"
4. Vérifier que les presets de script et TTS sont auto-sélectionnés
5. Générer l'audio et passer à la configuration
6. Vérifier que les presets de projet et miniatures sont auto-sélectionnés

### Test 3 : Flux "Avec Audio"

1. Créer une vidéo dans le calendrier avec audio
2. Sélectionner une chaîne avec presets configurés
3. Lancer "Avec audio"
4. Vérifier que les presets de projet et miniatures sont auto-sélectionnés

### Test 4 : Sans Chaîne

1. Créer une vidéo sans chaîne
2. Lancer la génération
3. Vérifier que le comportement est normal (sélection manuelle)

### Test 5 : Preset Miniatures Désactivé

1. Configurer une chaîne avec preset miniatures désactivé
2. Lancer une génération
3. Vérifier que le preset miniatures n'est pas auto-chargé

## Migration

Pour déployer cette fonctionnalité :

1. **Appliquer la migration SQL** :
   ```bash
   supabase db push
   # ou
   supabase migration up
   ```

2. **Redémarrer le serveur de développement** :
   ```bash
   npm run dev
   ```

3. **Vérifier que les types sont à jour** :
   ```bash
   npm run typecheck
   ```

## Améliorations Futures Possibles

1. **Duplication de configuration** : Copier les presets d'une chaîne à une autre
2. **Preset par défaut** : Définir un preset global utilisé si aucune chaîne n'est sélectionnée
3. **Historique** : Voir quels presets ont été utilisés pour chaque vidéo
4. **Import/Export** : Sauvegarder et restaurer la configuration des chaînes
5. **Suggestions** : Recommander des presets basés sur les vidéos précédentes

## Notes Techniques

- **Performance** : Les presets sont chargés une seule fois à l'ouverture du gestionnaire
- **Sécurité** : Toutes les foreign keys ont ON DELETE SET NULL pour éviter les orphelins
- **UX** : Timeouts de 500ms pour permettre le chargement des presets avant application
- **Nettoyage** : SessionStorage nettoyé après chaque utilisation pour éviter les conflits

## Conclusion

Cette implémentation offre une solution complète et flexible pour la gestion des presets par chaîne, avec une intégration transparente dans les workflows existants et une expérience utilisateur fluide.
