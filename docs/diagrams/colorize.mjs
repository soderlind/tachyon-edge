#!/usr/bin/env node
// Tints PR Lens SVGs by lane. PR Lens only colors by delta, so this runs after render.mjs.
// Usage: node colorize.mjs <graph.json> <svg-directory>

import { readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

// Lane id → color family. Keep in sync with the other repo's diagrams.
const LANE_COLORS = {
	wordpress: 'blue',
	worker: 'orange',
	cloudflare: 'amber',
	origin: 'rose',
};

const PALETTE = {
	blue: { light: [9, 105, 218], dark: [68, 147, 248] },
	purple: { light: [130, 80, 223], dark: [171, 125, 248] },
	orange: { light: [188, 76, 0], dark: [240, 136, 62] },
	amber: { light: [154, 103, 0], dark: [210, 153, 34] },
	teal: { light: [27, 124, 131], dark: [57, 197, 207] },
	rose: { light: [191, 57, 137], dark: [219, 97, 162] },
};

const MARK = 'data-lane-colors="1"';

const rgba = ([r, g, b], a) => `rgba(${r},${g},${b},${a})`;
const hex = (rgb) => '#' + rgb.map((v) => v.toString(16).padStart(2, '0')).join('');
const num = (tag, attr) => Number((tag.match(new RegExp(`\\s${attr}="([-\\d.]+)"`)) || [])[1]);
const setAttr = (tag, attr, value) =>
	new RegExp(`\\s${attr}="[^"]*"`).test(tag)
		? tag.replace(new RegExp(`(\\s${attr}=)"[^"]*"`), `$1"${value}"`)
		: tag.replace(/\s*\/?>$/, (end) => ` ${attr}="${value}"${end}`);
const unescape = (text) =>
	text.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&amp;/g, '&');

function colors(lane, theme) {
	const family = PALETTE[LANE_COLORS[lane]];
	if (!family) return null;
	const rgb = family[theme];
	const dark = theme === 'dark';
	return {
		accent: hex(rgb),
		lane: rgba(rgb, dark ? 0.07 : 0.06),
		laneStroke: rgba(rgb, dark ? 0.3 : 0.25),
		card: rgba(rgb, dark ? 0.6 : 0.55),
		chip: rgba(rgb, dark ? 0.2 : 0.12),
		lifeline: rgba(rgb, dark ? 0.45 : 0.4),
		cardFill: dark ? '#1c2128' : '#ffffff',
		actbar: rgba(rgb, dark ? 0.35 : 0.3),
	};
}

function laneOf(labels, title) {
	if (labels.has(title)) return labels.get(title);
	// Long titles are truncated with an ellipsis.
	const stem = title.replace(/…$/, '');
	for (const [label, lane] of labels) if (label.startsWith(stem)) return lane;
	return null;
}

function colorize(svg, labels, theme) {
	if (svg.includes(MARK)) return svg;

	// Cards: the group runs from the cardsh <g> to the end of its nsub text.
	const cards = [];
	let out = '';
	let pos = 0;
	const cardRe = /<g class="cardsh[^"]*"[^>]*>/g;
	for (let m; (m = cardRe.exec(svg)); ) {
		const nsub = svg.indexOf('class="nsub"', m.index);
		const end = svg.indexOf('</text>', nsub) + '</text>'.length;
		let seg = svg.slice(m.index, end);
		const title = unescape((seg.match(/class="ntitle"[^>]*>([^<]*)</) || [])[1] || '');
		const lane = laneOf(labels, title);
		const c = lane && colors(lane, theme);
		const rect = seg.match(/<rect class="card"[^>]*>/)[0];
		const [x, y, w, h] = ['x', 'y', 'width', 'height'].map((a) => num(rect, a));
		cards.push({ lane, x: x + w / 2, y: y + h / 2, box: { x, y, w, h } });
		if (c) {
			seg = seg
				.replace(/<rect class="card"[^>]*>/, (t) => setAttr(setAttr(t, 'stroke', c.card), 'stroke-width', '1.5'))
				.replace(/<rect class="chip"[^>]*>/, (t) => setAttr(t, 'fill', c.chip))
				.replace(/<[a-z]+ class="glyph-stroke"[^>]*>/g, (t) => setAttr(t, 'stroke', c.accent))
				.replace(/<[a-z]+ class="glyph"[^>]*>/g, (t) => setAttr(t, 'fill', c.accent));
		} else {
			console.warn(`  no lane color for card "${title}"`);
		}
		out += svg.slice(pos, m.index) + seg;
		pos = end;
		cardRe.lastIndex = end;
	}
	svg = out + svg.slice(pos);

	// Badges sit on a card's top edge; the dark fill is translucent, so add an opaque base.
	svg = svg.replace(/<g class="bdg[^"]*"><rect[^>]*>(<text[^>]*>)/g, (group, text) => {
		const rect = group.match(/<rect[^>]*>/)[0];
		const cx = num(rect, 'x') + num(rect, 'width') / 2;
		const cy = num(rect, 'y') + num(rect, 'height') / 2;
		const card = cards.find(({ lane, box: b }) => lane && cx >= b.x && cx <= b.x + b.w && cy >= b.y - 2 && cy <= b.y + b.h + 2);
		const c = card && colors(card.lane, theme);
		if (!c) return group;
		const base = setAttr(setAttr(rect, 'fill', c.cardFill), 'stroke', 'none');
		const tint = setAttr(setAttr(rect, 'fill', c.chip), 'stroke', c.card);
		return group.replace(rect, base + tint).replace(text, setAttr(text, 'fill', c.accent));
	});

	// Lane boxes take the lane of the cards inside them.
	const boxes = [];
	svg = svg.replace(/<rect class="lanebox"[^>]*>/g, (t) => {
		const box = { x: num(t, 'x'), y: num(t, 'y'), w: num(t, 'width'), h: num(t, 'height') };
		const card = cards.find((k) => k.lane && k.x >= box.x && k.x <= box.x + box.w && k.y >= box.y && k.y <= box.y + box.h);
		box.lane = card?.lane;
		boxes.push(box);
		const c = box.lane && colors(box.lane, theme);
		return c ? setAttr(setAttr(setAttr(t, 'fill', c.lane), 'stroke', c.laneStroke), 'stroke-width', '1') : t;
	});
	const boxAt = (x, y) =>
		boxes.find((b) => b.lane && x >= b.x && x <= b.x + b.w && (Number.isNaN(y) || (y >= b.y && y <= b.y + b.h)));

	svg = svg.replace(/<text class="lanelabel"[^>]*>/g, (t) => {
		const box = boxAt(num(t, 'x'), num(t, 'y'));
		return box ? setAttr(t, 'fill', colors(box.lane, theme).accent) : t;
	});
	svg = svg.replace(/<line class="lifeline"[^>]*>/g, (t) => {
		const box = boxAt(num(t, 'x1'), NaN);
		return box ? setAttr(t, 'stroke', colors(box.lane, theme).lifeline) : t;
	});

	svg = svg.replace(/<rect class="actbar"[^>]*>/g, (t) => {
		const box = boxAt(num(t, 'x') + num(t, 'width') / 2, NaN);
		if (!box) return t;
		const c = colors(box.lane, theme);
		return setAttr(setAttr(t, 'fill', c.actbar), 'stroke', c.card);
	});

	return svg.replace(/^<svg /, `<svg ${MARK} `);
}

const [graphPath, dir] = process.argv.slice(2);
if (!graphPath || !dir) {
	console.error('Usage: node colorize.mjs <graph.json> <svg-directory>');
	process.exit(1);
}
const graph = JSON.parse(await readFile(graphPath, 'utf8'));
const labels = new Map(graph.nodes.map((n) => [n.label, n.lane]));
for (const lane of new Set(labels.values())) {
	if (!LANE_COLORS[lane]) console.warn(`Lane "${lane}" has no color in LANE_COLORS.`);
}
for (const file of (await readdir(dir)).filter((f) => f.endsWith('.svg')).sort()) {
	const theme = /-dark\.svg$/.test(file) ? 'dark' : 'light';
	const target = path.join(dir, file);
	await writeFile(target, colorize(await readFile(target, 'utf8'), labels, theme));
	console.log(`${target} (${theme})`);
}
