#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { newsSchema } from '../src/content/schemas.ts';
import {
	parseArgs,
	fail,
	slugify,
	deriveTitleFromH1,
	deriveSummary,
	toDateOnly,
	printValidationErrors,
} from './lib/ingest-helpers.mjs';

const { force, slug: slugFlag, inputPath } = parseArgs(process.argv.slice(2), ['slug']);

if (!inputPath) {
	fail('Usage: node scripts/new-news.mjs <path-to-markdown> [--slug custom-slug] [--force]');
}

const resolvedInput = path.resolve(inputPath);
if (!fs.existsSync(resolvedInput)) {
	fail(`File not found: ${resolvedInput}`);
}

const filename = path.basename(resolvedInput);
const dateMatch = filename.match(/(\d{4}-\d{2}-\d{2})/);
const dateFromFilename = dateMatch ? dateMatch[1] : undefined;

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
	if (dateFromFilename) {
		data.date = dateFromFilename;
		guesses.push(`date ← filename: ${dateFromFilename}`);
	} else {
		const today = toDateOnly(new Date());
		data.date = today;
		guesses.push(`date ← today (no date in filename or frontmatter): ${today}`);
	}
}

if (!data.summary) {
	const derived = deriveSummary(body);
	if (derived) {
		data.summary = derived;
		guesses.push(`summary ← derived from body: "${derived}"`);
	}
}

data.tags ??= [];

const result = newsSchema.safeParse(data);
if (!result.success) {
	printValidationErrors(filename, result.error.issues);
	console.error('  (link and source cannot be guessed — add them to the frontmatter yourself.)');
	process.exit(1);
}

const dateForFilename = dateFromFilename ?? toDateOnly(result.data.date);
const slug =
	slugFlag ??
	(result.data.title ? slugify(result.data.title) : undefined) ??
	slugify(path.basename(resolvedInput, path.extname(resolvedInput)).replace(/^\d{4}-\d{2}-\d{2}-?/, ''));

if (!slug) {
	fail('Could not determine a slug. Pass one explicitly with --slug.');
}

const destDir = path.resolve('src/content/news');
const destPath = path.join(destDir, `${dateForFilename}-${slug}.md`);

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
