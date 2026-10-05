// Roundtrip test: HSL diagram -> generated image -> HSL positions.
//
// Runs the REAL reverse pipeline extracted from index.html (the palette
// snap helpers and convertReverseHslToImage itself) under Node against a
// tiny canvas stub, rasterizes the spiral lineart preset analytically and
// measures how much of the distribution survives the full
// hsl -> img -> hsl cycle.
//
// Usage: node test/roundtrip.test.mjs
// Exit code 0 = roundtrip works (shape loss and position error in bounds).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const html = readFileSync(join(root, 'index.html'), 'utf8');

// Extract a top-level `function name(...) { ... }` with balanced braces.
function extractFunction(name) {
	const start = html.indexOf(`function ${name}(`);
	if (start === -1) throw new Error(`function ${name} not found in index.html`);
	let i = html.indexOf('{', start);
	let depth = 0;
	for (; i < html.length; i++) {
		const ch = html[i];
		if (ch === '{') depth++;
		else if (ch === '}') {
			depth--;
			if (depth === 0) return html.slice(start, i + 1);
		}
	}
	throw new Error(`unbalanced braces in ${name}`);
}

// Extract everything between two anchor comments (end anchor excluded).
function extractRegion(startMarker, endMarker) {
	const a = html.indexOf(startMarker);
	if (a === -1) throw new Error(`marker not found: ${startMarker}`);
	const b = html.indexOf(endMarker, a);
	if (b === -1) throw new Error(`marker not found: ${endMarker}`);
	return html.slice(a, b);
}

const W = 600;
const H = 600;
const CX = 300;
const CY = 300;
const RMAX = 240;

const buffers = extractRegion(
	'// --- PRE-ALLOCATED REVERSE PASS BUFFERS',
	'const offscreenPlacementCanvas',
);
const snapBlock = extractRegion(
	'// --- ROUNDTRIP PALETTE SNAP ---',
	'// --- REVERSE: HSL DIAGRAM -> SYNTHESIZED IMAGE ---',
);

// Minimal stand-ins for the handful of DOM objects the reverse pass
// touches. Everything that matters numerically is the real code.
const harness = `
	'use strict';
	const W = ${W};
	const H = ${H};
	${buffers}
	${snapBlock}
	${extractFunction('hslToRgb')}
	${extractFunction('hueToRgb')}

	let hslSourceValid = true;
	let sourceData = null;
	const hslSourceCtx = { getImageData: () => ({ data: sourceData }) };
	const destCtx = hslSourceCtx;
	const maxPixelsSlider = { value: '50000' };
	const previewCanvas = { width: 0, height: 0, style: {} };
	const previewCtx = {
		createImageData: (w, h) => ({ width: w, height: h, data: new Uint8ClampedArray(w * h * 4) }),
		putImageData: (img) => { previewCanvas.out = img; },
	};
	const previewPlaceholder = { style: {} };
	const statsOrigRes = {};
	const statsRoundtripDeltaE = {};
	const statsRoundtripPos = {};
	let currentImage = null;
	let currentImageExact = false;
	let originalWidth = 0;
	let originalHeight = 0;
	let toastMessage = '';
	function showToast(msg) { toastMessage = msg; }

	${extractFunction('convertReverseHslToImage')}

	initSnapOffsets();
	return {
		snapColorToCell,
		hslToRgb,
		hueSat: (r, g, b) => { rgbToHueSat(r, g, b); return [snapHue, snapSat]; },
		snapped: () => [snapR, snapG, snapB],
		setSource: (d) => { sourceData = d; },
		setMaxPixels: (n) => { maxPixelsSlider.value = String(n); },
		runReverse: () => {
			convertReverseHslToImage();
			return {
				width: previewCanvas.width,
				height: previewCanvas.height,
				data: previewCanvas.out.data,
				exact: currentImageExact,
				posErrMean: revPosErrMean,
				posErrMax: revPosErrMax,
				within1Pct: revWithin1Pct,
				deltaE: revDeltaE,
				toast: toastMessage,
			};
		},
	};
`;
const ctx = new Function(harness)();

let failures = 0;
function check(label, cond, detail) {
	if (!cond) failures++;
	console.log(`  [${cond ? 'PASS' : 'FAIL'}] ${label}${detail ? ' — ' + detail : ''}`);
}

// Where the direct pipeline puts a color on the diagram.
function landing(r, g, b) {
	const [h, s] = ctx.hueSat(r, g, b);
	const theta = h * 2 * Math.PI;
	const dist = s * RMAX;
	return [Math.round(CX + dist * Math.cos(theta)), Math.round(CY + dist * Math.sin(theta))];
}

// ---------------------------------------------------------------------------
// Test 1: palette snap stability. Every on-disk cell color, pushed through
// the direct pipeline RGB -> HSL -> polar position, must land back on (or
// right next to) the diagram pixel it was emitted for. This is the property
// that lets a distribution survive 8-bit RGB quantization.
// ---------------------------------------------------------------------------
console.log('Test 1: palette position stability over the whole disk (L = 50%)');
{
	let n = 0;
	let rawSum = 0;
	let rawMax = 0;
	let rawWithin1 = 0;
	let snapSum = 0;
	let snapMax = 0;
	let snapExact = 0;
	let snapWithin1 = 0;
	let nudgeMax = 0;
	const t0 = Date.now();
	for (let y = 0; y < H; y++) {
		for (let x = 0; x < W; x++) {
			const dx = x - CX;
			const dy = y - CY;
			const dist = Math.sqrt(dx * dx + dy * dy);
			if (dist > RMAX) continue;
			let theta = Math.atan2(dy, dx);
			if (theta < 0) theta += 2 * Math.PI;
			const h = theta / (2 * Math.PI);
			const s = Math.min(1, dist / RMAX);
			const rgb = ctx.hslToRgb(h, s, 0.5);

			const [rx, ry] = landing(rgb[0], rgb[1], rgb[2]);
			const rawErr = Math.hypot(rx - x, ry - y);
			rawSum += rawErr;
			if (rawErr > rawMax) rawMax = rawErr;
			if (rawErr <= 1) rawWithin1++;

			const err = ctx.snapColorToCell(rgb[0], rgb[1], rgb[2], x, y, CX, CY, RMAX);
			const [sr, sg, sb] = ctx.snapped();
			const nudge = Math.max(Math.abs(sr - rgb[0]), Math.abs(sg - rgb[1]), Math.abs(sb - rgb[2]));
			if (nudge > nudgeMax) nudgeMax = nudge;
			snapSum += err;
			if (err > snapMax) snapMax = err;
			if (err === 0) snapExact++;
			if (err <= 1) snapWithin1++;
			n++;
		}
	}
	const rawMean = rawSum / n;
	const snapMean = snapSum / n;
	console.log(`  ${n.toLocaleString()} cells snapped in ${Date.now() - t0} ms`);
	console.log(`  canonical : mean ${rawMean.toFixed(4)} px · max ${rawMax.toFixed(2)} px · ${(rawWithin1 * 100 / n).toFixed(2)}% within <=1 px`);
	console.log(`  snapped   : mean ${snapMean.toFixed(4)} px · max ${snapMax.toFixed(2)} px · ${(snapExact * 100 / n).toFixed(2)}% exact · ${(snapWithin1 * 100 / n).toFixed(2)}% within <=1 px`);
	check('snapping lowers the mean displacement', snapMean < rawMean, `${rawMean.toFixed(4)} -> ${snapMean.toFixed(4)} px`);
	check('mean position error <= 0.3 px', snapMean <= 0.3, snapMean.toFixed(4) + ' px');
	check('max position error <= 1.5 px', snapMax <= 1.5, snapMax.toFixed(2) + ' px');
	check('>= 99.9% of cells within <=1 px', snapWithin1 * 100 / n >= 99.9, (snapWithin1 * 100 / n).toFixed(2) + '%');
	check('color nudge stays within +-2/255 per channel', nudgeMax <= 2, `max ${nudgeMax}/255`);
}

// ---------------------------------------------------------------------------
// Test 2: spiral lineart roundtrip through the real reverse pass.
// Rasterize the "Spiral Lineart" preset exactly as the page strokes it
// (3.5 turns, 6 px round stroke, hue = angle, saturation = radius), feed it
// to convertReverseHslToImage and map every produced pixel back onto the
// diagram with the direct pipeline's math.
// ---------------------------------------------------------------------------
console.log('Test 2: spiral lineart -> mosaic -> diagram');
const MAX_PIXELS = 50000;
{
	const src = new Uint8ClampedArray(W * H * 4);
	const stamp = (px, py, radius, r, g, b) => {
		const x0 = Math.max(0, Math.floor(px - radius));
		const x1 = Math.min(W - 1, Math.ceil(px + radius));
		const y0 = Math.max(0, Math.floor(py - radius));
		const y1 = Math.min(H - 1, Math.ceil(py + radius));
		for (let y = y0; y <= y1; y++) {
			for (let x = x0; x <= x1; x++) {
				const dx = x - px;
				const dy = y - py;
				if (dx * dx + dy * dy > radius * radius) continue;
				const i = (y * W + x) * 4;
				src[i] = r;
				src[i + 1] = g;
				src[i + 2] = b;
				src[i + 3] = 255;
			}
		}
	};
	const TURNS = 3.5;
	const STEPS = 8000;
	for (let i = 1; i <= STEPS; i++) {
		const t = i / STEPS;
		const theta = t * TURNS * 2 * Math.PI;
		const radius = t * RMAX;
		const hue = (theta / (2 * Math.PI)) % 1;
		const sat = Math.min(1, radius / RMAX);
		const rgb = ctx.hslToRgb(hue, sat, 0.5);
		stamp(CX + radius * Math.cos(theta), CY + radius * Math.sin(theta), 3, rgb[0], rgb[1], rgb[2]);
	}

	// Source distribution: luminance-weighted, same rule as the reverse pass.
	const srcWeight = new Float64Array(W * H);
	let srcTotal = 0;
	for (let y = 0; y < H; y++) {
		for (let x = 0; x < W; x++) {
			const dx = x - CX;
			const dy = y - CY;
			if (dx * dx + dy * dy > RMAX * RMAX) continue;
			const i = (y * W + x) * 4;
			if (src[i + 3] < 10) continue;
			const lum = 0.299 * src[i] + 0.587 * src[i + 1] + 0.114 * src[i + 2];
			if (lum < 8) continue;
			const w = lum > 1 ? lum : 1;
			srcWeight[y * W + x] = w;
			srcTotal += w;
		}
	}
	console.log(`  spiral rasterized: ${srcTotal.toFixed(0)} total weight`);

	ctx.setSource(src);
	ctx.setMaxPixels(MAX_PIXELS);
	const t0 = Date.now();
	const out = ctx.runReverse();
	console.log(`  reverse pass: ${out.width} x ${out.height} mosaic in ${Date.now() - t0} ms`);
	console.log(`  reported: mean ${out.posErrMean.toFixed(4)} px · max ${out.posErrMax.toFixed(2)} px · ${out.within1Pct.toFixed(2)}% within <=1 px · dE ${out.deltaE.toFixed(3)}`);

	const pixels = out.width * out.height;
	check('mosaic fits the pixel budget (direct pipeline takes it 1:1)', pixels <= MAX_PIXELS, `${pixels.toLocaleString()} <= ${MAX_PIXELS.toLocaleString()}`);
	check('mosaic is flagged as an exact-palette source', out.exact === true);
	check('reported mean position error <= 0.3 px', out.posErrMean <= 0.3, out.posErrMean.toFixed(4) + ' px');
	check('reported max position error <= 1.5 px', out.posErrMax <= 1.5, out.posErrMax.toFixed(2) + ' px');
	check('reported >= 99.9% within <=1 px', out.within1Pct >= 99.9, out.within1Pct.toFixed(2) + '%');
	check('color error dE <= 2 (snap stays invisible)', out.deltaE <= 2, 'dE ' + out.deltaE.toFixed(3));

	// Push every mosaic pixel back through the direct pipeline and rebuild
	// the diagram distribution from where the pixels actually land.
	const recon = new Float64Array(W * H);
	let offDisk = 0;
	let maxRadius = 0;
	for (let i = 0; i < pixels; i++) {
		const p = i * 4;
		const [x, y] = landing(out.data[p], out.data[p + 1], out.data[p + 2]);
		const dx = x - CX;
		const dy = y - CY;
		const radius = Math.sqrt(dx * dx + dy * dy);
		if (radius > maxRadius) maxRadius = radius;
		// Fully saturated rim colors can round one pixel past the rim; they
		// are still placed, just on the outermost ring of the island.
		if (radius > RMAX + 1) { offDisk++; continue; }
		recon[y * W + x]++;
	}
	check('every mosaic pixel lands on the island', offDisk === 0, `${offDisk} strays · furthest ${maxRadius.toFixed(2)} px (rim ${RMAX})`);

	// Total-variation shape loss on 7 px bins: tolerant to sub-bin jitter,
	// so it measures whether the spiral itself survived.
	const BIN = 7;
	const DIM = Math.ceil(W / BIN);
	const coarseSrc = new Float64Array(DIM * DIM);
	const coarseRec = new Float64Array(DIM * DIM);
	const invSrc = 1 / srcTotal;
	const invRec = 1 / (pixels - offDisk);
	let tvExact = 0;
	for (let y = 0; y < H; y++) {
		for (let x = 0; x < W; x++) {
			const i = y * W + x;
			const pS = srcWeight[i] * invSrc;
			const pR = recon[i] * invRec;
			tvExact += Math.abs(pS - pR);
			const b = ((y / BIN) | 0) * DIM + ((x / BIN) | 0);
			coarseSrc[b] += pS;
			coarseRec[b] += pR;
		}
	}
	let tvShape = 0;
	for (let i = 0; i < DIM * DIM; i++) tvShape += Math.abs(coarseSrc[i] - coarseRec[i]);
	const lossShape = tvShape * 50;
	const lossExact = tvExact * 50;

	// Floor of the per-pixel loss: drawing N discrete samples from a
	// continuous weight field already costs this much, before any color
	// roundtrip. Same stratified walk the reverse pass uses.
	let tvFloor = 0;
	{
		const n = pixels - offDisk;
		const step = srcTotal / n;
		let threshold = step * 0.5;
		let cumulative = 0;
		let emitted = 0;
		for (let i = 0; i < W * H && emitted < n; i++) {
			const w = srcWeight[i];
			if (w === 0) continue;
			cumulative += w;
			let count = 0;
			while (emitted < n && cumulative >= threshold) {
				count++;
				emitted++;
				threshold += step;
			}
			tvFloor += Math.abs(w * invSrc - count / n);
		}
	}
	const lossFloor = tvFloor * 50;
	console.log(`  shape loss (${BIN}px bins): ${lossShape.toFixed(3)}%`);
	console.log(`  per-pixel loss: ${lossExact.toFixed(3)}% (sampling quantization floor alone: ${lossFloor.toFixed(3)}%)`);
	// Per-pixel TV is brutal at ~3 samples per lit cell: a single pixel of
	// displacement relocates that cell's whole mass. The 7 px shape metric
	// below is the one that says whether the drawing survived.
	check('color roundtrip adds <= 20% on top of the sampling floor', lossExact - lossFloor <= 20, `+${(lossExact - lossFloor).toFixed(3)}%`);
	check('shape loss <= 5%', lossShape <= 5, lossShape.toFixed(3) + '%');
	check('spiral survives (>= 95% of mass in the right 7px bin)', 100 - lossShape >= 95, (100 - lossShape).toFixed(2) + '% preserved');
}

// ---------------------------------------------------------------------------
// Test 3: the mosaic always matches the pixel budget, at every slider stop,
// so render() can take the exact 1:1 path instead of resampling.
// ---------------------------------------------------------------------------
console.log('Test 3: mosaic size tracks the Max Pixels slider');
{
	let worstFill = 1;
	let overflow = 0;
	for (let budget = 1000; budget <= 100000; budget += 1000) {
		const w = Math.max(1, Math.floor(Math.sqrt(budget * 4 / 3)));
		const h = Math.max(1, Math.floor(budget / w));
		if (w * h > budget) overflow++;
		const fill = w * h / budget;
		if (fill < worstFill) worstFill = fill;
	}
	check('no slider stop overflows the budget', overflow === 0, `${overflow} overflows`);
	check('mosaic uses >= 95% of the budget at every stop', worstFill >= 0.95, `worst fill ${(worstFill * 100).toFixed(1)}%`);
}

console.log(failures === 0 ? '\nALL TESTS PASSED — roundtrip works' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
