# Zoom Implementation - CuPy GPU + HTTP/2 Downloads

## Version actuelle : CuPy GPU + HTTP/2 Asyncio (recommandée)

### Optimisations majeures
- **Backend zoom** : CuPy `affine_transform` avec `order=1` (bilinear)
- **Downloads** : HTTP/2 multiplexing avec `httpx` + `asyncio` (comme Node.js axios)
- **Streaming** : Frames streamées directement à FFmpeg (pas de disk I/O)
- **Performance** : 
  - Download 102 images : **~32s** (HTTP/2)
  - Processing 102 scènes : **~200s** (GPU CuPy + 20 workers)
  - **Total : ~3 minutes pour 9 min de vidéo**
- **Qualité** : Excellente (bilinear suffit pour zoom 8%)
- **Fallback** : Utilise automatiquement OpenCV CPU si CuPy n'est pas installé

### Version backup : OpenCV CPU
- **Fichier** : `handler.py.opencv_backup`
- **Backend** : OpenCV `warpAffine` avec `cv2.INTER_LANCZOS4`
- **Downloads** : ThreadPoolExecutor (20 workers)
- **Performance** : CPU uniquement, plus lent
- **Qualité subpixel** : ⭐⭐⭐⭐⭐ (meilleure interpolation)

## Restaurer la version CPU

Si CuPy pose problème :

```bash
cd runpod-handler
cp handler.py.opencv_backup handler.py
```

Et dans `requirements.txt`, commenter CuPy et httpx :
```txt
# cupy-cuda11x>=11.0.0  # Désactivé, utilise OpenCV CPU
# httpx[http2]>=0.27.0  # Désactivé, utilise requests avec ThreadPool
```

## Comparaison technique

| Critère | CuPy GPU + HTTP/2 (actuel) | OpenCV CPU (backup) |
|---------|---------------------------|---------------------|
| **Downloads** | HTTP/2 asyncio (102 imgs) | ThreadPool 20 workers |
| Temps download | **~32s** | ~35-40s |
| **Interpolation** | Bilinear order=1 | Lanczos4 (8×8 kernel) |
| Subpixel precision | ✅ Excellent | ✅ Excellent |
| Vitesse (125 frames) | **~1-2s** | ~5-7s |
| **Total 102 scènes** | **~3 min** | ~4-5 min |
| Dépendances | CuPy + httpx (~2GB) | Légères |
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
