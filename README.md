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

### web site

https://github.com/Yuki2ka/i2hsl_circle/index.html

git
https://github.com/Yuki2ka/i2hsl_circle.git

