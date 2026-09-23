#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import matter from 'gray-matter';
import { briefsSchema } from '../src/content/schemas.ts';
import {
	parseArgs,
	fail,
	deriveTitleFromH1,
	deriveSummary,
	deriveCoverageWindow,
	countTopLevelItems,
	stripTableOfContents,
	stripLeadingHeading,
	toDateOnly,
	printValidationErrors,
} from './lib/ingest-helpers.mjs';

const { force, inputPath } = parseArgs(process.argv.slice(2));

if (!inputPath) {
	fail('Usage: node scripts/new-brief.mjs <path-to-markdown> [--force]');
}

const resolvedInput = path.resolve(inputPath);
if (!fs.existsSync(resolvedInput)) {
	fail(`File not found: ${resolvedInput}`);
}

const filename = path.basename(resolvedInput);
const dateMatch = filename.match(/(\d{4}-\d{2}-\d{2})/);
if (!dateMatch) {
	fail(
		`Could not find a YYYY-MM-DD date in filename "${filename}". Expected something like science-brief-2026-09-20.md`,
	);
}
const dateFromFilename = dateMatch[1];

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
	data.date = dateFromFilename;
	guesses.push(`date ← filename: ${dateFromFilename}`);
}

if (!data.summary) {
	const derived = deriveSummary(body);
	if (derived) {
		data.summary = derived;
		guesses.push(`summary ← derived from body: "${derived}"`);
	}
}

if (!data.windowStart || !data.windowEnd) {
	const window = deriveCoverageWindow(body);
	if (window) {
		data.windowStart ??= window.windowStart;
		data.windowEnd ??= window.windowEnd;
		guesses.push(
			`windowStart/windowEnd ← "Coverage window:" line: ${window.windowStart} to ${window.windowEnd}`,
		);
	}
}

data.tags ??= [];
data.draft ??= false;

const itemCount = countTopLevelItems(body);
data.itemCount = itemCount;

const headingResult = stripLeadingHeading(body, data.title);
if (headingResult.removed && !headingResult.removed.matchesTitle) {
	console.error(
		`⚠ WARNING: the body's leading heading ("${headingResult.removed.text}") does not match ` +
			`the frontmatter title ("${data.title}"). Stripping it anyway, but this usually means ` +
			`something upstream picked a different title than the brief itself — check the source.`,
	);
}
const bodyAfterHeading = headingResult.removed ? headingResult.body : body;

const tocResult = stripTableOfContents(bodyAfterHeading);
const finalBody = tocResult.removed ? tocResult.body : bodyAfterHeading;

const result = briefsSchema.safeParse(data);
if (!result.success) {
	printValidationErrors(filename, result.error.issues);
	process.exit(1);
}

const destDir = path.resolve('src/content/briefs');
const destFilename = `science-brief-${dateFromFilename}.md`;
const destPath = path.join(destDir, destFilename);

if (fs.existsSync(destPath) && !force) {
	fail(`${destPath} already exists. Re-run with --force to overwrite.`);
}

const outputData = {
	...result.data,
	date: toDateOnly(result.data.date),
	windowStart: toDateOnly(result.data.windowStart),
	windowEnd: toDateOnly(result.data.windowEnd),
};

fs.mkdirSync(destDir, { recursive: true });
fs.writeFileSync(destPath, matter.stringify(finalBody, outputData));

console.log(`✓ Wrote ${path.relative(process.cwd(), destPath)}`);
if (guesses.length > 0) {
	console.log('Guessed:');
	for (const g of guesses) console.log(`  - ${g}`);
} else {
	console.log('All frontmatter was present and valid — nothing guessed.');
}
console.log(`itemCount: ${itemCount} (### headings)`);
if (headingResult.removed) {
	console.log(
		`Removed leading heading "${headingResult.removed.text}" (${headingResult.removed.matchesTitle ? 'matched the title' : 'did NOT match the title — see warning above'}) — the page template renders the title itself.`,
	);
} else {
	console.log('No leading heading found to remove.');
}
if (tocResult.removed) {
	const { text, itemCount: tocItemCount, consumedTrailingRule } = tocResult.removed;
	console.log(
		`Removed embedded table of contents (${tocItemCount} link${tocItemCount === 1 ? '' : 's'}${consumedTrailingRule ? ', including its trailing rule' : ''}) — the sticky ToC replaces it:`,
	);
	for (const line of text.split('\n')) console.log(`    ${line}`);
} else {
	console.log('No embedded table of contents found — nothing removed.');
}
