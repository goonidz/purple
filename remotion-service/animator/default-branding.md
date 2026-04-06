# Branding & Style de montage

Guide de référence pour reproduire ce style sur n'importe quel sujet.

## Palette — 3 couleurs, pas plus

| Token | Valeur | Usage |
|-------|--------|-------|
| `BG` | `#111118` | Fond global. Gris très foncé, **jamais noir pur** (`#000`) pour éviter le noir-sur-noir. |
| `RED` | `#ef4444` | Accent unique. Chiffres clés, titres forts, borders actives, barres de progression, glow. |
| `RED_DIM` | `rgba(239,68,68,0.25)` | Version atténuée du rouge pour les ombres, glows, box-shadows. |
| `WHITE` | `#f0f0f0` | Texte principal. Blanc cassé, jamais `#fff` pur. |
| `WHITE_DIM` | `rgba(240,240,240,0.35)` | Texte secondaire, labels, éléments désactivés, séparateurs, textes barrés. |

**Règle absolue** : aucune autre couleur. Pas de vert, bleu, doré, violet. Toute hiérarchie visuelle passe par l'opacité et le poids du texte, pas par la couleur.

## Typographie

- **Font** : `system-ui, sans-serif` — clean, sans décoration.
- **Tailles** (en px, pour du 1920×1080) :
  - Hero / chiffre clé : 120–180
  - Titre segment : 48–64
  - Sous-titre : 28–36
  - Label / badge : 18–24
  - Compteur de segment : 16
- **Poids** :
  - 800 pour les chiffres/stats géants
  - 700 pour les titres
  - 600 pour les badges/tags
  - Normal pour le reste
- **Pas d'italique**. Emphase = couleur rouge ou barré (`text-decoration: line-through`) pour marquer ce qui est rejeté.

## Fond & texture

- Le fond `BG` est global, appliqué une seule fois sur le composant racine.
- **Quadrillage permanent** : grille de lignes fines blanches à très faible opacité (3%), taille 100×100px. Visible derrière tous les segments.
- Les segments individuels sont **transparents** (pas de `background`) pour laisser la grille visible.
- Seule exception : les éléments avec un effet 3D (flip card) peuvent avoir un fond opaque sur leurs faces.

```tsx
// Fond + grille — à mettre dans le composant racine, une seule fois
<AbsoluteFill style={{ background: BG }}>
  <AbsoluteFill>
    <div style={{
      position: "absolute", width: "100%", height: "100%",
      opacity: 0.03,
      backgroundImage: `linear-gradient(${WHITE} 1px, transparent 1px), linear-gradient(90deg, ${WHITE} 1px, transparent 1px)`,
      backgroundSize: "100px 100px",
    }} />
  </AbsoluteFill>
  {/* segments ici */}
</AbsoluteFill>
```

## Mise en page — centrage

**Règle absolue : tout est centré.** Chaque segment utilise `justifyContent: "center"` et `alignItems: "center"` sur son `AbsoluteFill`. Aucun élément ne doit coller aux bords — prévoir un padding minimum de `100px` vertical et `140px` horizontal dans la zone active.

## Emojis

Les emojis sont **autorisés et encouragés** pour renforcer un concept visuel (ex : 💸 pour de l'argent, 📈 pour une hausse, ⚙️ pour un système, 🎯 pour une cible). Ils doivent être grands (fontSize 80–120) et servir de pictogramme dominant, pas de décoration. Ne pas en abuser : **max 1 emoji par segment**.

## Animations — les règles

### Transitions entre segments

Chaque segment a un **fade in/out** calculé sur ~12% de sa durée (max 0.3s). Pas de cut sec. Le hook `useFade(duration)` gère ça.

### Durée des animations sur les segments longs

Sur les segments qui durent **plus de 5 secondes**, l'animation principale ne doit **pas se terminer en moins de la moitié du segment**. Étaler les reveals sur 60–80% de la durée totale pour que l'écran reste vivant jusqu'à la fin. Exemples de techniques :

- Faire tourner/pivoter un élément en continu pendant toute la durée (`interpolate(frame, [0, dur], [0, 360])`)
- Faire clignoter ou pulser un élément avec un `spring` déclenché tard (`frame - Math.round(dur * 0.6)`)
- Ajouter une phase de "résultat" qui apparaît dans le dernier tiers
- Sur les compteurs, terminer le count à ~75% de la durée, pas à 40%

### Springs

Deux configs selon l'intention :

| Config | Usage |
|--------|-------|
| `{ damping: 200 }` | **Smooth** — apparitions douces, slides, texte. Pas de rebond. |
| `{ damping: 20, stiffness: 200 }` | **Snappy** — cartes qui pop, badges, éléments UI. Léger rebond. |
| `{ damping: 8 }` | **Punch** — emphase forte, texte qui frappe ("HAS TO."). Rebond prononcé. |

### Stagger (cascade)

Pour les listes/grilles, décaler chaque élément de **8 frames** (`frame - i * 8`). Ça crée un rythme visuel sans être trop lent.

### Règles strictes

- **Jamais de CSS transitions/animations** — tout passe par `interpolate()` et `spring()`.
- **Toujours `extrapolateRight: "clamp"`** sur les interpolations.
- **Toujours `premountFor`** sur les `<Sequence>` (0.5s recommandé).
- **Toujours `useVideoConfig()`** pour le fps, jamais de `30` en dur.

## Data visualization — priorité haute

Les charts et visualisations de données sont **fortement appréciés par les spectateurs**. Chaque fois qu'un segment contient une donnée chiffrée, une comparaison, une tendance ou une évolution temporelle, **privilégier un vrai chart SVG** plutôt qu'un simple compteur ou un texte XXL.

### Règle de sélection

> **Si la donnée peut être montrée dans un chart → utiliser un chart.**  
> Un chiffre seul est un dernier recours, pas le choix par défaut.

### Catalogue de charts disponibles

| Chart | Quand l'utiliser | Notes techniques |
|-------|-----------------|-----------------|
| **Bar chart groupé** | Comparer plusieurs séries sur une même période | 2 couleurs max (RED + WHITE_DIM), axe Y gradué, valeurs sur les barres |
| **Bar chart simple** | Classement, hiérarchie, top N | Barres qui montent avec spring stagger 8 frames |
| **Horizontal bar chart** | Comparaison de magnitudes (bps, %, volumes) | Labels à gauche, valeurs à droite, barre RED pour le max |
| **Donut chart** | Répartition d'un tout (portefeuille, budget, parts) | Se dessine progressivement via stroke-dasharray, valeur clé au centre |
| **Line chart multi-séries** | Évolution temporelle, performance, tendance | Axe X/Y gradués, dot tooltip animé qui suit la courbe principale |
| **Stacked area chart** | Accumulation, érosion, composition dans le temps | Zone rouge = pertes/coûts, zone blanche = ce qui reste |
| **Timeline + bars combo** | Historique d'événements avec magnitude | Timeline en haut (nodes), bars horizontales en dessous (ampleur) |
| **Courbe SVG simple** | Croissance vs stagnation, une seule tendance | Exponentielle rouge vs ligne plate dimmed |

### Règles pour tous les charts

- **Axes** : toujours présents si le chart a une échelle. Ticks en `WHITE_DIM` à 20% d'opacité. Lignes en pointillés `4 8`.
- **Animation** : les barres montent, les lignes se dessinent, les arcs se remplissent — toujours piloté par `interpolate()` ou `spring()`.
- **Couleur** : la série principale ou la valeur la plus significative = `RED`. Les autres = `WHITE_DIM` ou `WHITE` à opacité réduite.
- **Labels** : valeurs affichées sur ou à côté des éléments dès qu'ils sont visibles. Font `system-ui`, taille 18–24px.
- **Légende** : toujours présente pour les charts multi-séries. Apparaît en slide-up après le dessin des courbes.
- **Tooltip** : pour les line charts, un dot animé qui se déplace sur la courbe principale avec une bulle affichant la valeur courante.
- **Padding interne** : `PL ≥ 80px` (pour les labels Y), `PB ≥ 60px` (pour les labels X).

### Combiner chart + texte

Un chart seul n'est pas suffisant : **toujours ajouter un titre court** (32–40px, `WHITE`) et un **callout stat** (chiffre clé en rouge) après le dessin, qui synthétise le message principal.

---

## Vocabulaire visuel — les types d'animations

Chaque segment doit avoir une animation **unique** qui illustre le propos. Voici le catalogue de patterns :

| Pattern | Quand l'utiliser | Exemple |
|---------|-----------------|---------|
| **Compteur animé** | Chiffre clé isolé, pas de contexte temporel | "$6.0T" qui monte de 0 |
| **Flèches en cascade** | Tendance, direction, série | 6 flèches "CUT" qui apparaissent une à une |
| **Bar chart animé** ⭐ | Comparaison, déclin, progression, données chiffrées | Barres trimestrielles avec axe gradué |
| **Split screen** | Opposition, avant/après, dualité | Gauche = label, droite = chiffre |
| **Donut chart** ⭐ | Répartition d'un tout (portefeuille, allocation) | 4 tranches qui se dessinent + valeur au centre |
| **Line chart** ⭐ | Évolution temporelle, performance sur durée | Multi-séries avec dot tooltip animé |
| **Stacked area** ⭐ | Érosion, accumulation dans le temps | Zone rouge = pertes, zone blanche = reste |
| **Cercle SVG + compteur** | Deadline, countdown, progression unique | Cercle qui se remplit + nombre au centre |
| **Texte barré + texte fort** | Rejet d'une idée / emphase | "~~Not might~~" → "HAS TO." |
| **Cible / crosshair** | Positionnement, focus, précision | SVG cercles concentriques qui tourne |
| **Deux côtés + flèche** | Transfert, passage, mouvement | "Unprepared → Positioned" |
| **Cartes comparatives** | Choix, bonne vs mauvaise option | Carte barrée vs carte illuminée |
| **Engrenages** | Système, mécanique, automatisme | 3 gears qui tournent en sens opposé |
| **Items barrés** | Élimination, ce qu'on ne fait PAS | 3 cartes avec barre rouge qui traverse |
| **Barre brisée** | Rupture, fin d'une ère | Barre coupée en deux + éclair |
| **Barre de progression** | Agenda, timeline, avancement | Ligne qui se remplit |
| **Grille de cartes** | Liste structurée, piliers, forces | 4 cartes numérotées qui pop en cascade |
| **Flip card 3D** | Révélation, retournement | Face "Opportunity" → "Hidden Trap" |
| **Card + badge** | Crédibilité, preuve, identité | Grande carte + pilules sous elle |
| **Texte XXL + soulignement** | Conclusion, punchline finale — aucune donnée à montrer | "SKIN IN THE GAME" + barre rouge |

> ⭐ = patterns data viz à **favoriser en priorité** dès qu'il y a une donnée chiffrée.

## Structure d'un fichier composition

```
1. Imports Remotion
2. Segments [] — tableau {start, end, text}
3. Constantes palette (BG, RED, WHITE...)
4. Hook useFade()
5. Un composant Seg par segment (Seg1, Seg2...)
6. Tableau SEGMENT_COMPONENTS[]
7. Composant exporté qui :
   - Pose le fond + grille
   - Pose l'Audio
   - Map les segments → Sequence + Component
```

## Checklist avant livraison

- [ ] Max 3 couleurs (BG + RED + WHITE et leurs variantes dim)
- [ ] Quadrillage visible en permanence
- [ ] Tout est centré (`justifyContent: center`, `alignItems: center`)
- [ ] Aucun élément proche des bords (padding min 100px / 140px)
- [ ] Chaque segment a une animation unique adaptée au contenu
- [ ] **Données chiffrées → chart SVG en priorité** (bar, line, donut, area)
- [ ] Springs avec configs documentées (smooth/snappy/punch)
- [ ] Pas de background opaque sur les segments (sauf flip cards)
- [ ] Fade in/out sur chaque segment
- [ ] `premountFor` sur chaque Sequence
- [ ] `useVideoConfig()` pour le fps
- [ ] Textes secondaires en `WHITE_DIM`, jamais en couleur tierce
- [ ] Segments > 5s : animation s'étale sur au moins 60% de la durée
- [ ] Emojis : max 1 par segment, taille 80–120px, rôle de pictogramme
- [ ] Charts : axes présents, légende si multi-séries, callout stat après dessin
