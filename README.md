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

All 3D modes support linear or logarithmic tower heights. base `1.00` keeps linear heights, values above `1.00` shrink them and values below `1.00` expand them.

All 3D modes also have an "Auto scale" checkbox (on by default): it picks the height factor that fits the tallest tower of the current image into the view and syncs the Tower Height Scale slider to exactly that value. dragging the slider manually turns the autoscale off. in sand and liquid modes the factor is additionally clamped so the particle budget is never exceeded, since every height unit there is one real particle.

### web site

https://github.com/Yuki2ka/i2hsl_circle/index.html

git
https://github.com/Yuki2ka/i2hsl_circle.git

