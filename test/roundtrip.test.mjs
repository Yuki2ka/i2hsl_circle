// Roundtrip test: HSL heightmap -> generated image pixels -> HSL positions.
// Runs the REAL functions extracted from index.html (initReverseColors,
// reverseGenerateSamples, rtRgbToHueSat) under Node, builds the linear
// spiral heightmap analytically, and measures how much of the distribution
// survives the full hsl -> img -> hsl cycle.
//
// Usage: node test/roundtrip.test.mjs
// Exit code 0 = roundtrip works (shape loss and position error within bounds).

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

const SIZE = 481;
const RADIUS = 240;
const CELLS = SIZE * SIZE;

// Shared state the extracted functions close over (mirrors index.html).
const src = `
	'use strict';
	const REVERSE_MAP_SIZE = ${SIZE};
	const REVERSE_MAP_RADIUS = ${RADIUS};
	const REVERSE_MAP_CELLS = ${CELLS};
	const reverseWeight = new Uint8Array(REVERSE_MAP_CELLS);
	const reverseColor = new Uint32Array(REVERSE_MAP_CELLS);
	let reverseTotalWeight = 0;
	let reverseMapHash = 0;
	let rtHue = 0;
	let rtSat = 0;
	let reverseColorsRefined = false;
	let heightmapCounts = null;

	${extractFunction('initReverseColors')}
	${extractFunction('refineReverseColors')}
	${extractFunction('reverseGenerateSamples')}
	${extractFunction('rtRgbToHueSat')}
	${extractFunction('binPixelsToHeightmap')}

	return {
		reverseWeight,
		reverseColor,
		setTotalWeight: (w) => { reverseTotalWeight = w; },
		getTotalWeight: () => reverseTotalWeight,
		initReverseColors,
		refineReverseColors,
		reverseGenerateSamples,
		binPixelsToHeightmap,
		hueSat: (r, g, b) => { rtRgbToHueSat(r, g, b); return [rtHue, rtSat]; },
	};
`;
const ctx = new Function(src)();
ctx.initReverseColors();
const tRefine = Date.now();
ctx.refineReverseColors();
console.log(`palette refined in ${Date.now() - tRefine} ms (one-time, lazy in the page)\n`);

let failures = 0;
function check(label, cond, detail) {
	const mark = cond ? 'PASS' : 'FAIL';
	if (!cond) failures++;
	console.log(`  [${mark}] ${label}${detail ? ' — ' + detail : ''}`);
}

// ---------------------------------------------------------------------------
// Test 1: palette stability. Every on-disk canonical color, pushed through
// the direct pipeline RGB -> HSL -> polar position, must land back on (or
// right next to) the cell it encodes. This is the core property that makes
// the roundtrip work despite 8-bit RGB quantization.
// ---------------------------------------------------------------------------
console.log('Test 1: palette position stability (all on-disk cells)');
{
	let n = 0;
	let errSum = 0;
	let errMax = 0;
	let exact = 0;
	let within1 = 0;
	for (let y = 0; y < SIZE; y++) {
		for (let x = 0; x < SIZE; x++) {
			const color = ctx.reverseColor[y * SIZE + x];
			if (color === 0) continue; // outside the disk
			const [h, s] = ctx.hueSat(color & 255, (color >>> 8) & 255, (color >>> 16) & 255);
			const theta = h * 2 * Math.PI;
			const x1 = Math.round(RADIUS + s * RADIUS * Math.cos(theta));
			const y1 = Math.round(RADIUS + s * RADIUS * Math.sin(theta));
			const dx = x1 - x;
			const dy = y1 - y;
			const err = Math.sqrt(dx * dx + dy * dy);
			errSum += err;
			if (err > errMax) errMax = err;
			if (err === 0) exact++;
			if (err <= 1) within1++;
			n++;
		}
	}
	const mean = errSum / n;
	const pct0 = exact * 100 / n;
	const pct1 = within1 * 100 / n;
	console.log(`  cells: ${n.toLocaleString()} · mean err ${mean.toFixed(4)} px · max err ${errMax.toFixed(2)} px · ${pct0.toFixed(2)}% exact · ${pct1.toFixed(2)}% within <=1 px`);
	check('mean position error <= 0.3 px', mean <= 0.3, mean.toFixed(4) + ' px');
	check('max position error <= 1.5 px', errMax <= 1.5, errMax.toFixed(2) + ' px');
	check('>= 99.9% of cells within <=1 px', pct1 >= 99.9, pct1.toFixed(2) + '%');
}

// ---------------------------------------------------------------------------
// Test 2: spiral roundtrip. Build the linear Archimedean spiral heightmap
// (analytic stamp of the in-page example), generate N mosaic pixels, map
// every pixel color back to its HSL position, and compare distributions.
// ---------------------------------------------------------------------------
console.log('Test 2: spiral heightmap roundtrip loss');
{
	const w = ctx.reverseWeight;
	w.fill(0);
	const c = RADIUS;
	// Stamp: wide soft under-stroke (level 48, r=8) + bright core (72..255, r=4),
	// matching loadLinearHslExample's stroked spiral.
	const stamp = (cx, cy, r, level) => {
		const x0 = Math.max(0, Math.floor(cx - r));
		const x1 = Math.min(SIZE - 1, Math.ceil(cx + r));
		const y0 = Math.max(0, Math.floor(cy - r));
		const y1 = Math.min(SIZE - 1, Math.ceil(cy + r));
		for (let y = y0; y <= y1; y++) {
			for (let x = x0; x <= x1; x++) {
				const dx = x - cx;
				const dy = y - cy;
				if (dx * dx + dy * dy > r * r) continue;
				const i = y * SIZE + x;
				if (ctx.reverseColor[i] === 0) continue; // off-disk, as in activateReverseHeightmap
				if (level > w[i]) w[i] = level;
			}
		}
	};
	const STEPS = 2000;
	for (let i = 0; i <= STEPS; i++) {
		const t = i / STEPS;
		const theta = t * Math.PI * 2;
		const radius = 4 + t * (c - 16);
		stamp(c + Math.cos(theta) * radius, c + Math.sin(theta) * radius, 8, 48);
	}
	for (let i = 0; i <= STEPS; i++) {
		const t = i / STEPS;
		const theta = t * Math.PI * 2;
		const radius = 4 + t * (c - 16);
		stamp(c + Math.cos(theta) * radius, c + Math.sin(theta) * radius, 4, Math.round(72 + t * 183));
	}
	let total = 0;
	for (let i = 0; i < CELLS; i++) total += w[i];
	ctx.setTotalWeight(total);
	console.log(`  spiral stamped: total weight ${total.toLocaleString()}`);

	// Generate the mosaic samples exactly like renderReverseHeightmap does
	// for the default 50,000 max-pixels slider value.
	const maxPixels = 50000;
	const outW = Math.max(1, Math.floor(Math.sqrt(maxPixels * 4 / 3)));
	const outH = Math.max(1, Math.floor(maxPixels / outW));
	const outputCount = outW * outH;
	const colors = new Uint32Array(outputCount);
	const cells = new Int32Array(outputCount);
	const generated = ctx.reverseGenerateSamples(colors, cells, outputCount);
	check('sample generation fills the budget', generated === outputCount, `${generated}/${outputCount}`);

	// Roundtrip every sample: color -> HSL -> polar cell.
	const recon = new Int32Array(CELLS);
	const srcCount = new Int32Array(CELLS);
	let errSum = 0;
	let errMax = 0;
	let within1 = 0;
	for (let i = 0; i < generated; i++) {
		const cell = cells[i];
		const color = colors[i];
		const [h, s] = ctx.hueSat(color & 255, (color >>> 8) & 255, (color >>> 16) & 255);
		const theta = h * 2 * Math.PI;
		const x1 = Math.round(RADIUS + s * RADIUS * Math.cos(theta));
		const y1 = Math.round(RADIUS + s * RADIUS * Math.sin(theta));
		const x0 = cell % SIZE;
		const y0 = (cell / SIZE) | 0;
		const dx = x1 - x0;
		const dy = y1 - y0;
		const err = Math.sqrt(dx * dx + dy * dy);
		errSum += err;
		if (err > errMax) errMax = err;
		if (err <= 1) within1++;
		srcCount[cell]++;
		recon[y1 * SIZE + x1]++;
	}
	const meanErr = errSum / generated;
	const pct1 = within1 * 100 / generated;

	// Total-variation losses, identical to the in-page test:
	//   sampling  = heightmap -> N samples (pure quantization floor)
	//   exact     = heightmap -> reconstructed, cell-exact
	//   shape     = heightmap -> reconstructed on 7px bins (shape survival)
	const BIN = 7;
	const CDIM = Math.ceil(SIZE / BIN);
	const coarseSrc = new Float64Array(CDIM * CDIM);
	const coarseRec = new Float64Array(CDIM * CDIM);
	const invW = 1 / total;
	const invN = 1 / generated;
	let tvSampling = 0;
	let tvExact = 0;
	for (let i = 0; i < CELLS; i++) {
		const pSrc = w[i] * invW;
		tvSampling += Math.abs(pSrc - srcCount[i] * invN);
		tvExact += Math.abs(pSrc - recon[i] * invN);
		const b = (((i / SIZE) | 0) / BIN | 0) * CDIM + ((i % SIZE) / BIN | 0);
		coarseSrc[b] += pSrc;
		coarseRec[b] += recon[i] * invN;
	}
	let tvShape = 0;
	for (let i = 0; i < CDIM * CDIM; i++) tvShape += Math.abs(coarseSrc[i] - coarseRec[i]);
	const lossSampling = tvSampling * 50;
	const lossExact = tvExact * 50;
	const lossShape = tvShape * 50;

	console.log(`  ${generated.toLocaleString()} px roundtripped`);
	console.log(`  position error: mean ${meanErr.toFixed(4)} px · max ${errMax.toFixed(2)} px · ${pct1.toFixed(2)}% within <=1 px`);
	console.log(`  shape loss (7px bins): ${lossShape.toFixed(3)}%`);
	console.log(`  exact-cell loss: ${lossExact.toFixed(3)}% (pure sampling quantization: ${lossSampling.toFixed(3)}%)`);

	check('mean position error <= 0.5 px', meanErr <= 0.5, meanErr.toFixed(4) + ' px');
	check('every pixel returns within <=1 px', pct1 >= 99.9, pct1.toFixed(2) + '%');
	check('shape loss <= 5%', lossShape <= 5, lossShape.toFixed(3) + '%');
	check('color roundtrip adds <= 20% exact-cell loss on top of sampling quantization', lossExact - lossSampling <= 20, (lossExact - lossSampling).toFixed(3) + '%');
	check('spiral survives (>= 95% of mass lands in correct 7px bin)', 100 - lossShape >= 95, (100 - lossShape).toFixed(2) + '% preserved');

	// -----------------------------------------------------------------------
	// Test 3: full toggle cycle. The mode toggle converts Reverse -> Direct
	// (mosaic pixels become the image) and Direct -> Reverse (the image is
	// binned back into a heightmap via binPixelsToHeightmap). Feed the
	// generated mosaic through the real binning function and compare the
	// reconstructed heightmap with the original spiral.
	// -----------------------------------------------------------------------
	console.log('Test 3: toggle cycle heightmap -> mosaic -> heightmap');
	{
		// Keep the original spiral distribution before it is overwritten.
		const spiralP = new Float64Array(CELLS);
		for (let i = 0; i < CELLS; i++) spiralP[i] = w[i] * invW;

		// The mosaic as RGBA pixel data, exactly what the direct pipeline's
		// exact-source path reads back from the canvas (alpha always 255).
		const srcData = new Uint8ClampedArray(generated * 4);
		for (let i = 0; i < generated; i++) {
			const color = colors[i];
			srcData[i * 4] = color & 255;
			srcData[i * 4 + 1] = (color >>> 8) & 255;
			srcData[i * 4 + 2] = (color >>> 16) & 255;
			srcData[i * 4 + 3] = 255;
		}
		const binned = ctx.binPixelsToHeightmap(srcData, generated);
		check('every mosaic pixel lands on the disk', binned === generated, `${binned}/${generated}`);

		const total2 = ctx.getTotalWeight();
		check('rebinned heightmap is non-empty', total2 > 0, total2.toLocaleString());

		// Shape loss of the full cycle on the same 7px bins.
		coarseSrc.fill(0);
		coarseRec.fill(0);
		const invW2 = 1 / total2;
		for (let i = 0; i < CELLS; i++) {
			const b = (((i / SIZE) | 0) / BIN | 0) * CDIM + ((i % SIZE) / BIN | 0);
			coarseSrc[b] += spiralP[i];
			coarseRec[b] += ctx.reverseWeight[i] * invW2;
		}
		let tvCycle = 0;
		for (let i = 0; i < CDIM * CDIM; i++) tvCycle += Math.abs(coarseSrc[i] - coarseRec[i]);
		const lossCycle = tvCycle * 50;
		console.log(`  full-cycle shape loss (7px bins): ${lossCycle.toFixed(3)}%`);
		check('full toggle cycle shape loss <= 10%', lossCycle <= 10, lossCycle.toFixed(3) + '%');
		check('spiral survives the toggle cycle (>= 90% preserved)', 100 - lossCycle >= 90, (100 - lossCycle).toFixed(2) + '% preserved');
	}
}

console.log(failures === 0 ? '\nALL TESTS PASSED — roundtrip works' : `\n${failures} CHECK(S) FAILED`);
process.exit(failures === 0 ? 0 : 1);
