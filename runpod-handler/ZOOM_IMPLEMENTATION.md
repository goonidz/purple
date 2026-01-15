# Zoom Implementation - CuPy GPU vs OpenCV CPU

## Versions disponibles

### Version actuelle : CuPy GPU (recommandée)
- **Fichier** : `handler.py`
- **Backend** : CuPy `affine_transform` avec `order=5` (quintic spline)
- **Performance** : 5-10x plus rapide que CPU
- **Qualité subpixel** : ⭐⭐⭐⭐ (quasi identique à Lanczos4)
- **Fallback** : Utilise automatiquement OpenCV CPU si CuPy n'est pas installé

### Version backup : OpenCV CPU
- **Fichier** : `handler.py.opencv_backup`
- **Backend** : OpenCV `warpAffine` avec `cv2.INTER_LANCZOS4`
- **Performance** : CPU uniquement, plus lent
- **Qualité subpixel** : ⭐⭐⭐⭐⭐ (meilleure interpolation)
- **Avantage** : Pas de dépendances lourdes (CuPy ~2GB)

## Restaurer la version CPU

Si CuPy pose problème :

```bash
cd runpod-handler
cp handler.py.opencv_backup handler.py
```

Et dans `requirements.txt`, commenter CuPy :
```txt
# cupy-cuda12x>=12.0.0  # Désactivé, utilise OpenCV CPU
```

## Comparaison technique

| Critère | CuPy GPU (actuel) | OpenCV CPU (backup) |
|---------|-------------------|---------------------|
| Interpolation | Spline order=5 (6×6 kernel) | Lanczos4 (8×8 kernel) |
| Subpixel precision | ✅ Excellent | ✅ Excellent |
| Vitesse (125 frames) | ~2-3s | ~10-15s |
| Dépendances | CuPy (~2GB) | Légères |
| VRAM GPU | ~500MB | N/A |

## Architecture

```python
# Détection automatique
if CUPY_AVAILABLE:
    generate_zoom_frames_cupy()  # GPU 
else:
    generate_zoom_frames_opencv()  # CPU fallback
```

**Les deux évitent le jiggle grâce à la précision subpixel !** 🎯
