# Test: Lanczos Interpolation avec Upscale Réduit

## Objectif

Tester si on peut obtenir la même qualité (sans jiggle) avec **2x upscale + Lanczos** au lieu de **6x upscale + interpolation par défaut**.

## Avantages attendus

- ✅ **3x plus rapide** (2x upscale au lieu de 6x = 9x moins de pixels à traiter)
- ✅ **Meilleure qualité** (Lanczos est un algorithme d'interpolation de haute qualité)
- ✅ **Moins de mémoire** (moins de pixels en mémoire)

## Comment tester

### 1. Préparer une image de test

```bash
# Télécharger ou utiliser une image existante
# Par exemple, une image 1920x1080
```

### 2. Lancer le test

```bash
cd video-render-service
node test-lanczos-zoom.js <image.jpg> <output.mp4> <duration> <width> <height> <framerate> <effectType>
```

**Exemple :**
```bash
node test-lanczos-zoom.js test.jpg output-lanczos.mp4 5 1920 1080 25 zoom_in
```

### 3. Types d'effets disponibles

- `zoom_in` - Zoom vers le centre
- `zoom_out` - Zoom arrière depuis le centre
- `zoom_in_left` - Zoom vers la gauche
- `zoom_out_right` - Zoom arrière vers la droite
- `zoom_in_top` - Zoom vers le haut
- `zoom_out_bottom` - Zoom arrière vers le bas

### 4. Comparer avec la version actuelle

Pour comparer, tu peux :
1. Rendre la même scène avec le service actuel (6x upscale)
2. Rendre avec ce script (2x upscale + Lanczos)
3. Comparer visuellement :
   - Qualité (jiggle/stuttering)
   - Vitesse de rendu
   - Taille du fichier

## Ce que fait le script

1. **Preprocess** : Scale et crop l'image pour remplir le frame
2. **Upscale 2x avec Lanczos** : `scale=3840:2160:flags=lanczos` (au lieu de 6x = 11520x6480)
3. **Zoompan** : Applique l'effet Ken Burns à haute résolution
4. **Downscale avec Lanczos** : Retour à la résolution cible avec qualité

## Résultats attendus

Si le test est concluant :
- Pas de jiggle visible (grâce à Lanczos)
- Rendu ~3x plus rapide
- Qualité égale ou meilleure

Si le test échoue :
- Jiggle visible → Il faudra peut-être augmenter à 3x ou 4x upscale
- Ou utiliser une autre approche (Sharp, etc.)

## Notes techniques

- **Lanczos** : Algorithme d'interpolation qui utilise un kernel de 3 lobes, donnant une meilleure qualité que bilinear/bicubic
- **Pourquoi ça marche** : Lanczos est plus précis, donc on a besoin de moins de pixels pour éviter les erreurs d'arrondi
- **Trade-off** : Lanczos est légèrement plus lent que bilinear, mais le gain de vitesse (moins de pixels) compense largement
