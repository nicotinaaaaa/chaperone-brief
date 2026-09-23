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
	toDateOnly,
	printValidationErrors,
} from './lib/ingest-helpers.mjs';

const { force, slug: slugFlag, inputPath } = parseArgs(process.argv.slice(2));

if (!inputPath) {
	fail('Usage: node scripts/new-review.mjs <path-to-markdown> [--slug custom-slug] [--force]');
}

const resolvedInput = path.resolve(inputPath);
if (!fs.existsSync(resolvedInput)) {
	fail(`File not found: ${resolvedInput}`);
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

const result = reviewsSchema.safeParse(data);
if (!result.success) {
	printValidationErrors(path.basename(resolvedInput), result.error.issues);
	process.exit(1);
}

const slug =
	slugFlag ??
	(result.data.title ? slugify(result.data.title) : undefined) ??
	slugify(path.basename(resolvedInput, path.extname(resolvedInput)));

if (!slug) {
	fail('Could not determine a slug. Pass one explicitly with --slug.');
}

const destDir = path.resolve('src/content/reviews');
const destPath = path.join(destDir, `${slug}.md`);

if (fs.existsSync(destPath) && !force) {
	fail(`${destPath} already exists. Re-run with --force to overwrite.`);
}

const outputData = {
	...result.data,
	date: toDateOnly(result.data.date),
};

fs.mkdirSync(destDir, { recursive: true });
fs.writeFileSync(destPath, matter.stringify(body, outputData));

console.log(`✓ Wrote ${path.relative(process.cwd(), destPath)}`);
if (guesses.length > 0) {
	console.log('Guessed:');
	for (const g of guesses) console.log(`  - ${g}`);
} else {
	console.log('All frontmatter was present and valid — nothing guessed.');
}
