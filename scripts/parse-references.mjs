#!/usr/bin/env node
// Extraction only — prints structured candidates for a References section,
// flagging anything that doesn't fit the standard "Authors. Title. Journal.
// Year;Vol(Issue):Pages. doi:X. PMID: Y." shape rather than guessing at it.
// Output is a draft for a human to correct, not a final sources: list.
import fs from 'node:fs';
import path from 'node:path';

const inputPath = process.argv[2];
if (!inputPath) {
	console.error('Usage: node scripts/parse-references.mjs <path-to-markdown>');
	process.exit(1);
}

const raw = fs.readFileSync(path.resolve(inputPath), 'utf-8');

const refsHeadingMatch = raw.match(/^#{1,6}\s*References\s*$|^\*\*References\*\*\s*$|^References\s*$/im);
if (!refsHeadingMatch) {
	console.error('No "References" section found.');
	process.exit(1);
}
let refsBody = raw.slice(refsHeadingMatch.index + refsHeadingMatch[0].length);
// Stop at the next heading (e.g. "## Registry records"), bold or real.
const nextSectionMatch = refsBody.match(/\n#{1,6}\s+\S|\n\*\*[A-Z][^*\n]*\*\*\s*\n/);
if (nextSectionMatch) refsBody = refsBody.slice(0, nextSectionMatch.index);

// Three numbering styles seen in practice: "**[1]**", "**1.**", and plain
// "1\." (pandoc-escaped, unbolded). All three share one shape: a numeric
// marker alone at the start of a line, followed by the entry text. Find
// every marker position first, then slice the text between consecutive
// markers — simpler and easier to verify than one greedy match/lookahead.
const MARKER = /^(?:\*\*\\?\[(\d+)\\?\]\*\*|\*\*(\d+)\.\*\*|(\d+)\\?\.)(?=\s)/gm;

const markers = [];
let mm;
while ((mm = MARKER.exec(refsBody)) !== null) {
	const num = mm[1] ?? mm[2] ?? mm[3];
	markers.push({ start: mm.index, end: mm.index + mm[0].length, num });
}

const entries = [];
for (let i = 0; i < markers.length; i++) {
	const textStart = markers[i].end;
	const textEnd = i + 1 < markers.length ? markers[i + 1].start : refsBody.length;
	const text = refsBody.slice(textStart, textEnd).replace(/\s+/g, ' ').trim();
	entries.push({ num: markers[i].num, text });
}

// HIV's file uses no numeric marker at all — APA-style "Authors (Year).
// Title. Journal..." with each reference as its own blank-line-delimited
// paragraph. Fall back to paragraph splitting when the marker-based pass
// found nothing, rather than silently reporting zero references.
if (entries.length === 0) {
	const paragraphs = refsBody
		.split(/\n\s*\n/)
		.map((p) => p.replace(/\s+/g, ' ').trim())
		.filter((p) => p.length > 20 && !p.startsWith('*'));
	paragraphs.forEach((text, i) => entries.push({ num: String(i + 1), text, noExplicitMarker: true }));
}

function extractCommon(text) {
	// Two DOI spellings appear: "doi:10.xxx/yyy" and a direct
	// "https://doi.org/10.xxx/yyy" URL (HIV's APA-style entries use the
	// latter, with no "doi:" label at all). DOI suffixes can legitimately
	// contain balanced parens (Lancet's 10.1016/S0140-6736(24)01867-1), so
	// only whitespace ends the match — a trailing ") citation annotation"
	// like "(PMID 123)" is preceded by a space and so is excluded naturally.
	const doiMatch = text.match(/(?:doi:?\s*|https?:\/\/doi\.org\/)(10\.\d{4,}(?:\.\d+)*\/[^\s]+)/i);
	const doi = doiMatch ? doiMatch[1].replace(/[.,;]+$/, '') : undefined;
	const pmidMatch = text.match(/PMID:?\s*(\d{6,9})/i);
	const pmid = pmidMatch ? pmidMatch[1] : undefined;
	const nctMatches = [...text.matchAll(/\bNCT\d{8}\b/g)].map((x) => x[0]);
	const consensusUrlMatch = text.match(/https:\/\/consensus\.app\/\S+/);
	let url;
	if (doi) url = `https://doi.org/${doi}`;
	else if (pmid) url = `https://pubmed.ncbi.nlm.nih.gov/${pmid}/`;
	else if (consensusUrlMatch) url = consensusUrlMatch[0];
	return { doiMatch, doi, pmid, nctMatches, url };
}

function parseVancouver(text) {
	const { doiMatch, doi, pmid, url } = extractCommon(text);
	const beforeDoi = doiMatch ? text.slice(0, doiMatch.index) : text;
	// Anchor on "YEAR;" specifically — a bare 4-digit number can appear
	// inside a title (e.g. "...1990-2021: a systematic analysis...") and
	// would otherwise be mistaken for the pub year, truncating everything
	// after it out of the title/journal split.
	const yearMatch = beforeDoi.match(/\b((?:19|20)\d{2})[;,]/);
	const head = yearMatch ? beforeDoi.slice(0, yearMatch.index) : beforeDoi;
	const parts = head.split(/\.\s+/).map((s) => s.trim()).filter(Boolean);
	const [authors, title, journal] = parts;
	const year = yearMatch?.[1];
	const needsReview = !title || !url || !journal;
	return { kind: needsReview ? 'needs-review' : 'article', authors, title, journal, year, doi, pmid, url, text };
}

// HIV's file: "Authors (Year). Title. Journal, Vol(Issue), Pages.
// https://doi.org/DOI (PMID N)" or "...Journal. Retrieved via Consensus: URL"
// — year sits right after the authors, not at the end, so Vancouver's
// tail-anchored split doesn't apply; title/journal are the two segments
// right after "(Year). ".
function parseApa(text) {
	const { doiMatch, doi, pmid, url } = extractCommon(text);
	const yearMatch = text.match(/^(.+?)\s\((\d{4})\)\.\s*/);
	if (!yearMatch) return { kind: 'needs-review', url, text };
	const authors = yearMatch[1];
	const year = yearMatch[2];
	const rest = text.slice(yearMatch.index + yearMatch[0].length);
	const stopAt = doiMatch ? doiMatch.index - (text.length - rest.length) : rest.search(/Retrieved via Consensus/i);
	const head = stopAt > -1 ? rest.slice(0, stopAt) : rest;
	const parts = head.split(/\.\s+/).map((s) => s.trim()).filter(Boolean);
	const [title, journal] = parts;
	const needsReview = !title || !url || !journal;
	return { kind: needsReview ? 'needs-review' : 'article', authors, title, journal, year, doi, pmid, url, text };
}

function parseOne(entry) {
	const text = entry.text.replace(/\*/g, '');
	const { nctMatches } = extractCommon(text);
	if (nctMatches.length > 1) return { kind: 'trial-bundle', text, nctNumbers: nctMatches };
	if (nctMatches.length === 1 && /clinicaltrials\.gov/i.test(text)) {
		// Shape is consistently "<Sponsor or source label>. <Actual trial
		// name>. <NCT + other details>." — the trial name is the second
		// segment, not the first (which is just the sponsor/source label).
		const segments = text.split(/\.\s/);
		return { kind: 'trial', title: segments[1] ?? segments[0], url: `https://clinicaltrials.gov/study/${nctMatches[0]}`, nct: nctMatches[0], text };
	}
	return entry.noExplicitMarker ? parseApa(text) : parseVancouver(text);
}

const parsed = entries.map((e) => ({ num: e.num, ...parseOne(e) }));
const compact = process.argv.includes('--compact');

if (process.argv.includes('--json')) {
	console.log(JSON.stringify(parsed, null, 2));
	process.exit(0);
}

if (compact) {
	for (const p of parsed) {
		if (p.kind === 'article') console.log(`[${p.num}] ${p.title} (${p.year ?? '?'}) — ${p.url}`);
		else if (p.kind === 'trial') console.log(`[${p.num}] TRIAL ${p.nct} — ${p.title}`);
		else if (p.kind === 'trial-bundle') console.log(`[${p.num}] BUNDLE (${p.nctNumbers.length} NCTs, not auto-split): ${p.nctNumbers.join(', ')}`);
		else console.log(`[${p.num}] NEEDS REVIEW — ${p.text.slice(0, 160)}`);
	}
	process.exit(0);
}

console.log(`${parsed.length} reference(s) in ${path.relative(process.cwd(), inputPath)}\n`);
for (const p of parsed) {
	console.log(`[${p.num}] (${p.kind})`);
	if (p.kind === 'article') {
		console.log(`  title:   ${p.title}`);
		console.log(`  authors: ${p.authors}`);
		console.log(`  journal: ${p.journal}  year: ${p.year}`);
		console.log(`  url:     ${p.url}`);
	} else if (p.kind === 'trial') {
		console.log(`  title: ${p.title}`);
		console.log(`  url:   ${p.url}`);
	} else if (p.kind === 'trial-bundle') {
		console.log(`  ${p.nctNumbers.length} NCT numbers bundled — not auto-split: ${p.nctNumbers.join(', ')}`);
	} else {
		console.log(`  NEEDS REVIEW — raw: ${p.text.slice(0, 200)}`);
	}
	console.log('');
}
