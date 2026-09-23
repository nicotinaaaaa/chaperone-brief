#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { reviewsSchema } from '../src/content/schemas.ts';
import {
	parseArgs,
	fail,
	slugify,
	deriveTitleFromH1,
	deriveSummary,
	wordCount,
	stripLeadingHeading,
	toDateOnly,
	printValidationErrors,
} from './lib/ingest-helpers.mjs';

const {
	force,
	slug: slugFlag,
	docx: docxFlag,
	figures: figuresFlag,
	inputPath,
} = parseArgs(process.argv.slice(2), ['slug', 'docx', 'figures']);

if (!inputPath) {
	fail(
		'Usage: node scripts/new-review.mjs <path-to-markdown> [--slug custom-slug] [--docx <path-to-.docx>] [--figures <dir>] [--force]',
	);
}

const resolvedInput = path.resolve(inputPath);
if (!fs.existsSync(resolvedInput)) {
	fail(`File not found: ${resolvedInput}`);
}

let resolvedDocx;
if (docxFlag) {
	resolvedDocx = path.resolve(docxFlag);
	if (!fs.existsSync(resolvedDocx)) {
		fail(`--docx file not found: ${resolvedDocx}`);
	}
}

let resolvedFigures;
if (figuresFlag) {
	resolvedFigures = path.resolve(figuresFlag);
	if (!fs.existsSync(resolvedFigures) || !fs.statSync(resolvedFigures).isDirectory()) {
		fail(`--figures directory not found: ${resolvedFigures}`);
	}
}

const raw = fs.readFileSync(resolvedInput, 'utf-8');
const parsed = matter(raw);
const body = parsed.content;
const existing = parsed.data ?? {};

const guesses = [];
const data = { ...existing };

if (!data.title) {
	const derived = deriveTitleFromH1(body);
	if (derived) {
		data.title = derived;
		guesses.push(`title ← first "# " heading: "${derived}"`);
	}
}

if (!data.date) {
	const today = toDateOnly(new Date());
	data.date = today;
	guesses.push(`date ← today (reviews have no dated filename, and none was set in frontmatter): ${today}`);
}

if (!data.summary) {
	const derived = deriveSummary(body);
	if (derived) {
		data.summary = derived;
		guesses.push(`summary ← derived from body: "${derived}"`);
	}
}

data.tags ??= [];
data.draft ??= false;

if (!data.readingTime) {
	const words = wordCount(body);
	const minutes = Math.max(1, Math.round(words / 200));
	data.readingTime = minutes;
	guesses.push(`readingTime ← computed from word count (${words} words): ${minutes} min`);
}

// Computed before validation (from the pre-parse title) so --docx/--figures
// paths can reference the final slug as part of the data that gets validated.
const slug =
	slugFlag ??
	(data.title ? slugify(data.title) : undefined) ??
	slugify(path.basename(resolvedInput, path.extname(resolvedInput)));

if (!slug) {
	fail('Could not determine a slug. Pass one explicitly with --slug.');
}

if (resolvedDocx) {
	data.docxPath = `/downloads/${slug}.docx`;
}

const headingResult = stripLeadingHeading(body, data.title);
if (headingResult.removed && !headingResult.removed.matchesTitle) {
	console.error(
		`⚠ WARNING: the body's leading heading ("${headingResult.removed.text}") does not match ` +
			`the frontmatter title ("${data.title}"). Stripping it anyway, but this usually means ` +
			`something upstream picked a different title than the review itself — check the source.`,
	);
}
const bodyAfterHeading = headingResult.removed ? headingResult.body : body;

// Rewrite relative image paths to where they'll actually be served from, and
// fail if the markdown references a figure that --figures didn't provide.
let finalBody = bodyAfterHeading;
if (resolvedFigures) {
	const missing = [];
	finalBody = bodyAfterHeading.replace(/!\[([^\]]*)\]\(([^)]+)\)/g, (match, alt, src) => {
		if (/^([a-z]+:)?\/\//i.test(src) || src.startsWith('/')) {
			return match; // external or already absolute — leave untouched
		}
		if (!fs.existsSync(path.join(resolvedFigures, src))) {
			missing.push(src);
			return match;
		}
		return `![${alt}](/figures/${slug}/${src})`;
	});
	if (missing.length > 0) {
		fail(
			`--figures was given (${resolvedFigures}), but the markdown references image(s) not found there: ${missing.join(', ')}`,
		);
	}
}

const result = reviewsSchema.safeParse(data);
if (!result.success) {
	printValidationErrors(path.basename(resolvedInput), result.error.issues);
	process.exit(1);
}

const destDir = path.resolve('src/content/reviews');
const destPath = path.join(destDir, `${slug}.md`);

if (fs.existsSync(destPath) && !force) {
	fail(`${destPath} already exists. Re-run with --force to overwrite.`);
}

const downloadsDir = path.resolve('public/downloads');
const docxDestPath = resolvedDocx ? path.join(downloadsDir, `${slug}.docx`) : undefined;
if (docxDestPath && fs.existsSync(docxDestPath) && !force) {
	fail(`${docxDestPath} already exists. Re-run with --force to overwrite.`);
}

const figuresDestDir = resolvedFigures ? path.resolve('public/figures', slug) : undefined;
if (figuresDestDir && fs.existsSync(figuresDestDir) && !force) {
	fail(`${figuresDestDir} already exists. Re-run with --force to overwrite.`);
}

const outputData = {
	...result.data,
	date: toDateOnly(result.data.date),
};

fs.mkdirSync(destDir, { recursive: true });
fs.writeFileSync(destPath, matter.stringify(finalBody, outputData));

if (resolvedDocx && docxDestPath) {
	fs.mkdirSync(downloadsDir, { recursive: true });
	fs.copyFileSync(resolvedDocx, docxDestPath);
}

if (resolvedFigures && figuresDestDir) {
	fs.mkdirSync(figuresDestDir, { recursive: true });
	fs.cpSync(resolvedFigures, figuresDestDir, { recursive: true, force: true });
}

console.log(`✓ Wrote ${path.relative(process.cwd(), destPath)}`);
if (docxDestPath) {
	console.log(`✓ Copied .docx to ${path.relative(process.cwd(), docxDestPath)} (docxPath: ${outputData.docxPath})`);
}
if (figuresDestDir) {
	console.log(
		`✓ Copied figures to ${path.relative(process.cwd(), figuresDestDir)} and rewrote their image paths in the body`,
	);
}
if (headingResult.removed) {
	console.log(
		`Removed leading heading "${headingResult.removed.text}" (${headingResult.removed.matchesTitle ? 'matched the title' : 'did NOT match the title — see warning above'}) — the page template renders the title itself.`,
	);
} else {
	console.log('No leading heading found to remove.');
}
if (guesses.length > 0) {
	console.log('Guessed:');
	for (const g of guesses) console.log(`  - ${g}`);
} else {
	console.log('All frontmatter was present and valid — nothing guessed.');
}
