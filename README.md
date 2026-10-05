## html, Vanilla JS • High Performance Particle Mapping

![screenshot](1.avif)

user drop image
script internally scale it to 0.1MP
script show circular hue HSL diagram with each image pixel placed in proper position. if >1 pixel of same color - place them near each other (without overlap) to visually represent area of same color.
optimize speed, especially placing hot path.


slider to change MAX_PIXELS 1000....100k
if too many same pixels - automatically scale down to fit same pixels on reasonable area . so whole white image has also proper representation



to optimize implement high-performance Opaque Buffer approach. Instead of calculating distances for every pixel (O(N²)), it uses a pre-allocated integer grid to find the nearest empty slot in O(1) average time, ensuring no overlaps while representing color density. 
benchmark button to compare speed of both versions

### view modes

3D isometry mode. in this mode placement is simple: same pixels increment bar height. properly calculate position of base pixel in pseudo-3d space.
visually it looks similar as pillars or distant skyscrapers on circular island, view from some angle above ground. 

3D light towers mode. same isometric skyscrapers, but the pixel count now drives the distance from the center instead of the bar height, and lightness drives the height of the skyscrapers. hue still picks the angle, saturation is ignored.

3D sand pyramids mode. starts exactly like the isometric skyscrapers, but then every drawn height unit becomes one grain that keeps its exact color forever. taller columns pour their top grains into the lowest neighboring column (only while the height difference exceeds 1), so the towers slump like dry sand: total volume is conserved, colors never mix, and growing piles push neighboring pixels aside. the relaxation is an animated, event-driven simulation that provably terminates with every neighbor pair within ±1 — flat sheets where the sand is thin, slope-1 pyramids where it concentrates. the sand is contained by the circular island rim.

3D immiscible liquid mode. same particle machinery as sand pyramids plus lateral pressure: when a column is gravity-balanced but still stacks 2+ particles, its top particle slides across level ground toward the nearest empty island cell (a per-frame BFS distance field), so excess volume travels as visible bumps over occupied territory and settles in free ground. colliding blobs push each other aside instead of mixing, and the simulation terminates with the whole volume resting as a single flat layer — a 2D-like color mosaic, but grown by pressure and displacement instead of spiral search. the particle budget is capped by the island capacity so the flat sheet always fits inside the rim.

2D pressure mode. same start as the skyscrapers — every pixel is one unit dropped in its exact hue/saturation cell — but the column height is read as the **pressure of a gas** instead of a height, and nothing is ever allowed to travel across the surface. each round solves the pressure field of the whole island (`deg·p − Σ p_neighbour = mass − capacity`, with `p ≥ 0` wherever a cell is not full) and then every cell hands over exactly the surplus it cannot keep to its four direct neighbours, split along the local pressure gradient. a pixel therefore moves one cell per frame at most, and only because the cell behind it pushed: dense colors inflate like gas bubbles, blow a wavefront through the loose pixels around them and freeze when the pressure equalises. the result is the same gap-free one-pixel-per-cell mosaic as the 2D swarm, but the shapes are round, organic and pressure-grown instead of spiral-packed squares. compressed cells glow white while they still hold more than one pixel, so the remaining pressure is visible.

the pressure solve is a projected red-black SOR over a 5 level 481² grid pyramid, about 700 sweeps per round. that is seconds of plain JS, so it runs as a WebGL2 fragment shader ping-pong over float textures and finishes in one frame. the mode needs WebGL2 with float render targets: when the browser has none, the option is removed from the selector instead of being offered and failing. if the context is lost or returns a field that fails the residual check mid-run, the identical JS solver silently takes over, time-sliced over frames so the page stays responsive.

All 3D modes support linear or logarithmic tower heights. base `1.00` keeps linear heights, values above `1.00` shrink them and values below `1.00` expand them.

All 3D modes also have an "Auto scale" checkbox (on by default): it picks the height factor that fits the tallest tower of the current image into the view and syncs the Tower Height Scale slider to exactly that value. dragging the slider manually turns the autoscale off. in sand and liquid modes the factor is additionally clamped so the particle budget is never exceeded, since every height unit there is one real particle.

### 3d camera

all four 3D modes render through a WebGL2 instanced-box renderer with a real depth buffer, so the whole island is a live 3D scene: drag to orbit the camera around the island centre (azimuth + pitch), scroll the mouse wheel or pinch with two fingers to zoom, double-click to reset the view. the camera state survives mode switches and image changes; moving it only re-draws the staged scene, so it never re-runs the placement or relaxation passes. the floor guide (saturation rings, hue spokes and their labels) is projected through the same camera, so it rotates and tilts together with the island.

why WebGL2: a freely rotating camera breaks the fixed back-to-front painter order, so correct occlusion needs a per-pixel depth test over up to 120k boxes — millions of depth-tested pixel writes per frame, far beyond interactive plain JS on the typed-array grid. consecutive equal-colour height units are merged into single tall boxes, which keeps every scene at or below one instanced draw call of 120k instances even at extreme height scales. when WebGL2 is unavailable (or the context is lost mid-session) the 3D modes automatically fall back to the original fixed-view Canvas2D painter — identical towers, no camera controls — exactly like before.

### reverse conversion & roundtrip engine

the visualizer supports two-way bidirectional mapping between images and circular HSL diagrams:

1. **Reverse Conversion (HSL Diagram → Image)**:
   - Reads the active HSL diagram or circular grayscale heightmap.
   - Interprets polar coordinates $(u, v)$ as hue $h$ and saturation $s$, and cell mass/luminance as lightness/density.
   - Synthesizes a new continuous image in the input preview with that exact color distribution.
2. **Direct Conversion (Image → HSL Diagram)**:
   - Maps pixels of the input image back onto the circular HSL diagram using any active 2D or 3D engine.
3. **HSL Lineart & Greyscale Heightmap Sources**:
   - Built-in presets for clean geometric HSL linearts: Archimedean Spiral, 12-arm Radial Spokes, Concentric Saturation Rings, and Flower Rose curves.
   - "Load HSL Image (Heightmap)" imports any image directly onto the circular HSL disc as a grayscale heightmap.
   - Every one of those buttons **runs the reverse conversion on click**, exactly the way the image presets run the direct conversion: one click updates the diagram and the synthesized image together. The `⇄ Reverse: HSL → Img` button stays for re-reading a diagram that the direct pipeline painted.
4. **Roundtrip Loss & Fidelity Verification**:
   - Tests HSL ⇄ Image roundtrips and computes Total Variation Loss %, Color Fidelity %, Color Error $\Delta E$ and the mean/max **position error** of the cycle.
   - Geometric structures (e.g. spiral curves) are preserved across roundtrip cycles.
5. **Monte-Carlo Spatial Lloyd Relaxation**:
   - Optimizes reconstructed image spatial coherence (smoothing gradients and eliminating noise) while conserving 100% of the HSL color distribution.

three things keep the cycle lossless enough that the drawing itself survives:

- **guide-free source**: the linearts and heightmaps are painted on a separate, transparent canvas and only composited over the diagram's coordinate guide for display. The reverse pass reads that clean copy, so the saturation rings and their labels — which are bright enough to pass for data and account for ~5% of a lineart's mass — never enter the distribution.
- **palette snap**: 8-bit RGB cannot express every $(h, s)$ pair exactly, so an emitted color normally returns to a slightly different diagram pixel. Each color is searched over the $\pm 2$ RGB neighborhood (ordered center-out) for the variant whose RGB → HSL → polar position lands back on the pixel it came from. The nudge is at most $2/255$ per channel — invisible — and it takes the mean displacement from 0.53 px to 0.15 px, with 100% of pixels returning within 1 px (84.7% exactly).
- **exact source path**: the mosaic is sized to the Max Pixels budget and flagged exact, so the direct pipeline passes it through 1:1 (and uses nearest-neighbor when the budget is lowered) instead of smoothing palette colors into neighbors that belong somewhere else on the disc.

`node test/roundtrip.test.mjs` verifies this headlessly: it extracts the real `convertReverseHslToImage` and the snap helpers out of `index.html`, rasterizes the Spiral Lineart preset, and asserts the bounds. For the spiral at 50k pixels the shape loss (total variation on 7 px bins) is **2.2%**, down from 3.9% without the snap.

### web site

https://github.com/Yuki2ka/i2hsl_circle/index.html

git
https://github.com/Yuki2ka/i2hsl_circle.git
