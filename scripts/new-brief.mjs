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

// Does all the work for one file and never throws or exits — every failure
// mode (bad filename, unparsable frontmatter, schema violation, existing
// destination) comes back as { ok: false, ... } so a batch can isolate one
// bad file without aborting the rest.
function ingestOneBrief(resolvedInput, { force }) {
	const filename = path.basename(resolvedInput);
	try {
		return ingestOneBriefUnsafe(resolvedInput, filename, { force });
	} catch (err) {
		return { ok: false, filename, error: err instanceof Error ? err.message : String(err) };
	}
}

function ingestOneBriefUnsafe(resolvedInput, filename, { force }) {
	const dateMatch = filename.match(/(\d{4}-\d{2}-\d{2})/);
	if (!dateMatch) {
		return {
			ok: false,
			filename,
			error: `Could not find a YYYY-MM-DD date in filename "${filename}". Expected something like science-brief-2026-09-20.md`,
		};
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
			guesses.push({ field: 'title', detail: `title ← first "# " heading: "${derived}"` });
		}
	}

	if (!data.date) {
		data.date = dateFromFilename;
		guesses.push({ field: 'date', detail: `date ← filename: ${dateFromFilename}` });
	}

	if (!data.summary) {
		const derived = deriveSummary(body);
		if (derived) {
			data.summary = derived;
			guesses.push({ field: 'summary', detail: `summary ← derived from body: "${derived}"` });
		}
	}

	if (!data.windowStart || !data.windowEnd) {
		const window = deriveCoverageWindow(body);
		if (window) {
			data.windowStart ??= window.windowStart;
			data.windowEnd ??= window.windowEnd;
			guesses.push({
				field: 'windowStart/windowEnd',
				detail: `windowStart/windowEnd ← "Coverage window:" line: ${window.windowStart} to ${window.windowEnd}`,
			});
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
		return {
			ok: false,
			filename,
			error: result.error.issues
				.map((issue) => `${issue.path.join('.') || '(root)'}: ${issue.message}`)
				.join('; '),
			issues: result.error.issues,
		};
	}

	const destDir = path.resolve('src/content/briefs');
	const destFilename = `science-brief-${dateFromFilename}.md`;
	const destPath = path.join(destDir, destFilename);

	if (fs.existsSync(destPath) && !force) {
		return {
			ok: false,
			filename,
			error: `${destPath} already exists. Re-run with --force to overwrite.`,
		};
	}

	const outputData = {
		...result.data,
		date: toDateOnly(result.data.date),
		windowStart: toDateOnly(result.data.windowStart),
		windowEnd: toDateOnly(result.data.windowEnd),
	};

	fs.mkdirSync(destDir, { recursive: true });
	fs.writeFileSync(destPath, matter.stringify(finalBody, outputData));

	return {
		ok: true,
		filename,
		destPath,
		title: outputData.title,
		date: outputData.date,
		itemCount,
		guesses,
		headingResult,
		tocResult,
	};
}

function printSingleFileSuccess(result) {
	console.log(`✓ Wrote ${path.relative(process.cwd(), result.destPath)}`);
	if (result.guesses.length > 0) {
		console.log('Guessed:');
		for (const g of result.guesses) console.log(`  - ${g.detail}`);
	} else {
		console.log('All frontmatter was present and valid — nothing guessed.');
	}
	console.log(`itemCount: ${result.itemCount} (### headings)`);
	if (result.headingResult.removed) {
		console.log(
			`Removed leading heading "${result.headingResult.removed.text}" (${result.headingResult.removed.matchesTitle ? 'matched the title' : 'did NOT match the title — see warning above'}) — the page template renders the title itself.`,
		);
	} else {
		console.log('No leading heading found to remove.');
	}
	if (result.tocResult.removed) {
		const { text, itemCount: tocItemCount, consumedTrailingRule } = result.tocResult.removed;
		console.log(
			`Removed embedded table of contents (${tocItemCount} link${tocItemCount === 1 ? '' : 's'}${consumedTrailingRule ? ', including its trailing rule' : ''}) — the sticky ToC replaces it:`,
		);
		for (const line of text.split('\n')) console.log(`    ${line}`);
	} else {
		console.log('No embedded table of contents found — nothing removed.');
	}
}

function truncate(str, max) {
	if (!str || str.length <= max) return str ?? '';
	return `${str.slice(0, max - 1).trimEnd()}…`;
}

function printSummaryTable(results) {
	const columns = ['Filename', 'Status', 'Title', 'Date', 'Items', 'Notes'];
	const rows = results.map((r) =>
		r.ok
			? [
					r.filename,
					'ok',
					truncate(r.title, 50),
					r.date,
					String(r.itemCount),
					r.guesses.length > 0 ? r.guesses.map((g) => g.field).join(', ') : '—',
				]
			: [r.filename, 'FAILED', '—', '—', '—', truncate(r.error, 70)],
	);

	const widths = columns.map((label, i) => Math.max(label.length, ...rows.map((row) => row[i].length)));
	const printRow = (cells) => console.log(cells.map((cell, i) => cell.padEnd(widths[i])).join('  '));

	printRow(columns);
	printRow(widths.map((w) => '-'.repeat(w)));
	for (const row of rows) printRow(row);
}

function extractDateForSort(filename) {
	const m = filename.match(/(\d{4}-\d{2}-\d{2})/);
	return m ? m[1] : null;
}

// ---------------------------------------------------------------------

const { force, inputPath } = parseArgs(process.argv.slice(2));

if (!inputPath) {
	fail('Usage: node scripts/new-brief.mjs <path-to-markdown-or-directory> [--force]');
}

const resolvedInput = path.resolve(inputPath);
if (!fs.existsSync(resolvedInput)) {
	fail(`File not found: ${resolvedInput}`);
}

if (!fs.statSync(resolvedInput).isDirectory()) {
	const result = ingestOneBrief(resolvedInput, { force });
	if (!result.ok) {
		if (result.issues) {
			printValidationErrors(result.filename, result.issues);
			process.exit(1);
		}
		fail(result.error);
	}
	printSingleFileSuccess(result);
} else {
	const entries = fs
		.readdirSync(resolvedInput)
		.filter((f) => f.toLowerCase().endsWith('.md'))
		.sort((a, b) => {
			const da = extractDateForSort(a);
			const db = extractDateForSort(b);
			if (da && db) return da.localeCompare(db);
			if (da) return -1;
			if (db) return 1;
			return a.localeCompare(b);
		});

	if (entries.length === 0) {
		fail(`No .md files found in ${resolvedInput}`);
	}

	console.log(
		`Found ${entries.length} .md file${entries.length === 1 ? '' : 's'} in ${path.relative(process.cwd(), resolvedInput)}\n`,
	);

	const results = [];
	for (const entry of entries) {
		const entryPath = path.join(resolvedInput, entry);
		const result = ingestOneBrief(entryPath, { force });
		results.push(result);
		if (result.ok) {
			console.log(`✓ ${result.filename} -> ${path.relative(process.cwd(), result.destPath)}`);
		} else if (result.issues) {
			printValidationErrors(result.filename, result.issues);
		} else {
			console.error(`✗ ${result.filename}: ${result.error}`);
		}
	}

	console.log('\nSummary:\n');
	printSummaryTable(results);

	const failedCount = results.filter((r) => !r.ok).length;
	if (failedCount > 0) {
		console.log(`\n${failedCount} of ${results.length} file(s) failed — see details above.`);
		process.exit(1);
	} else {
		console.log(`\nAll ${results.length} file(s) ingested.`);
	}
}
