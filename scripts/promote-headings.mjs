#!/usr/bin/env node
// Finds paragraphs that look like pseudo-headings (either a whole paragraph
// wrapped in **bold**, or a plain "N. Title"/"N.M Title" line — docx-to-md
// output has used both styles) and, by default, only reports them with a
// proposed level and surrounding context. Never writes anything unless
// --apply is passed, and even then only acts on paragraphs this file's
// MANIFEST explicitly names — nothing is inferred at apply time, because a
// bad automatic call here would silently corrupt a document's structure.
//
// The manifest encodes decisions already reviewed and approved for this
// specific backfill batch (kicker lines and vestigial labels to delete,
// title paragraphs to promote to H1, non-numbered top-level sections to
// promote to H2). A future docx conversion with different kicker text would
// need its own manifest entry — the numbered-heading promotion is the only
// part of this that's genuinely generic.
import fs from 'node:fs';
import path from 'node:path';

const MANIFEST = {
	'ferroptosis-persister-cells-review.md': {
		deleteText: ['REVIEW · CANCER CELL BIOLOGY'],
		h1Text: ["Ferroptosis as an Achilles' Heel of Drug-Tolerant Persister Cancer Cells"],
		h2Text: ['Registry records', 'Note on sources and figures'],
	},
	'gdf15-gfral-cancer-cachexia-review.md': {
		deleteText: ['REVIEW ARTICLE'],
		h1Text: ['Somatic Distress as a Drug Target: The GDF-15–GFRAL Axis in Cancer Cachexia'],
		h2Text: [],
	},
	'glymphatic-clearance-review.md': {
		deleteText: ['REVIEW ARTICLE · NEUROSCIENCE'],
		h1Text: ['Sleep-Dependent Glymphatic Clearance and Neurodegeneration'],
		h2Text: [],
	},
	'hiv-latent-reservoir-review.md': {
		deleteText: ['Weekly Science Review', 'Contents'],
		h1Text: [
			'The Latent HIV-1 Reservoir: Molecular Architecture of Proviral Silencing, Clonal Persistence, and the Path to a Cure',
		],
		h2Text: ['Acknowledgements and Scope'],
	},
	'intercellular-mitochondrial-transfer-review.md': {
		deleteText: [],
		h1Text: ['Organelles on the Move: Intercellular Mitochondrial Transfer in Tissue Homeostasis, Cancer and Cell Therapy'],
		h2Text: ['Clinical trial registry records'],
	},
	'phage-therapy-mdr-review.md': {
		deleteText: ['WEEKLY REVIEW IN THE BIOLOGICAL SCIENCES'],
		h1Text: [
			'Bacteriophage Therapy for Multidrug-Resistant Bacterial Infection: Molecular Mechanism, the Coevolutionary Arms Race, and the Gap Between Compassionate Use and Randomised Evidence',
		],
		h2Text: ['Note on sources and figures'],
	},
	'trained-immunity-bcg-review.md': {
		deleteText: [],
		h1Text: ['Trained Immunity: How BCG Vaccination Reprograms Innate Immune Memory'],
		h2Text: [],
	},
};

const inputPath = process.argv[2];
const apply = process.argv.includes('--apply');
if (!inputPath) {
	console.error('Usage: node scripts/promote-headings.mjs <path-to-markdown> [--apply]');
	process.exit(1);
}

const resolvedPath = path.resolve(inputPath);
const raw = fs.readFileSync(resolvedPath, 'utf-8');
const frontmatterEnd = raw.startsWith('---') ? raw.indexOf('\n---', 3) + 4 : 0;
const frontmatter = raw.slice(0, frontmatterEnd);
const body = raw.slice(frontmatterEnd);
const lines = body.split('\n');

const BOLD_ONLY = /^\*\*([^*]+)\*\*$/;
const PLAIN_NUMBERED = /^(\d+)\\?\.((?:\d+)?)\s+(.+)$/;
const CAPTION_TRAP = /^(figure|table)\s+\d/i;

const manifest = MANIFEST[path.basename(resolvedPath)] ?? { deleteText: [], h1Text: [], h2Text: [] };

function classify(text) {
	if (manifest.deleteText.includes(text)) return { action: 'delete', reason: 'manifest: kicker/vestigial label' };
	if (manifest.h1Text.includes(text)) return { action: 'h1', reason: 'manifest: title paragraph' };
	if (manifest.h2Text.includes(text)) return { action: 'h2', reason: 'manifest: trailing top-level section' };
	if (/^abstract$/i.test(text)) return { action: 'h2', text: 'Abstract', reason: 'top-level section (normalized casing)' };
	if (/^references$/i.test(text)) return { action: 'h2', text: 'References', reason: 'top-level section (normalized casing)' };
	if (CAPTION_TRAP.test(text)) return { action: null, reason: 'caption trap — handled separately, not by this pass' };

	const numbered = text.match(/^(\d+)\\?\.((?:\d+)?)\s+(.+)$/);
	if (numbered) {
		const [, major, minor] = numbered;
		return { action: minor ? 'h3' : 'h2', reason: minor ? `numbered ${major}.${minor} subsection` : `numbered ${major}. top-level section` };
	}
	return { action: null, reason: 'unnumbered, not in manifest — needs manual judgment' };
}

const BARE_WORD = /^(abstract|references)$/i;

const candidates = [];
// Numbered candidates (plain or bold "N. …") are only meaningful as section
// headings BEFORE References — a numbered reference-list entry ("1. Iliff
// JJ, Wang M...") has the exact same shape and would otherwise be promoted
// right along with genuine headings. Manifest-listed trailing sections
// (Registry records, etc.) are unaffected since they're matched by exact
// text, not by the numbered pattern, so they still work after this point.
let pastReferences = false;
for (let i = 0; i < lines.length; i++) {
	const trimmed = lines[i].trim();
	if (trimmed === '') continue;

	// Only treat as a candidate if it's alone in its paragraph (blank line
	// or document boundary on both sides) — this is what rules out a bold
	// phrase that merely starts a longer paragraph.
	const prevBlank = i === 0 || lines[i - 1].trim() === '';
	const nextBlank = i === lines.length - 1 || lines[i + 1].trim() === '';
	if (!prevBlank || !nextBlank) continue;

	let text = null;
	let style = null;
	const boldMatch = trimmed.match(BOLD_ONLY);
	if (boldMatch) {
		text = boldMatch[1].trim();
		style = 'bold';
	} else if (!pastReferences && PLAIN_NUMBERED.test(trimmed)) {
		text = trimmed.replace(/\\\./, '.');
		style = 'plain';
	} else if (BARE_WORD.test(trimmed)) {
		// Trained-Immunity-BCG's section labels are plain text, not bold —
		// "Abstract"/"References" alone on a line, no ** and no digits.
		text = trimmed;
		style = 'plain';
	}
	if (text === null) continue;
	if (pastReferences && style === 'plain' && !manifest.h2Text.includes(text)) continue;

	if (/^references$/i.test(text)) pastReferences = true;

	const context = {
		before: lines.slice(Math.max(0, i - 2), i).map((l) => l.trim()).filter(Boolean),
		after: lines.slice(i + 1, i + 3).map((l) => l.trim()).filter(Boolean),
	};
	candidates.push({ line: i, text, style, ...classify(text), context });
}

if (!apply) {
	console.log(`${candidates.length} candidate(s) in ${path.relative(process.cwd(), inputPath)}\n`);
	for (const c of candidates) {
		console.log(`L${c.line + 1} [${c.style}] "${c.text}"`);
		console.log(`  ${c.action ? `-> ${c.action}` : 'no action'}  (${c.reason})`);
		if (c.context.before.length) console.log(`  before: ${c.context.before.join(' / ').slice(0, 100)}`);
		if (c.context.after.length) console.log(`  after:  ${c.context.after.join(' / ').slice(0, 100)}`);
		console.log('');
	}
	process.exit(0);
}

// --apply: only touch lines with a resolved action. Deletions remove the
// line only; excess blank lines from the surrounding paragraph structure
// are collapsed in one pass at the end rather than computed per-deletion.
let deleted = 0;
let promoted = 0;
for (const c of candidates) {
	if (!c.action) continue;
	if (c.action === 'delete') {
		lines[c.line] = null;
		deleted++;
		continue;
	}
	const prefix = c.action === 'h1' ? '# ' : c.action === 'h2' ? '## ' : '### ';
	lines[c.line] = prefix + c.text;
	promoted++;
}

const newBody = lines
	.filter((l) => l !== null)
	.join('\n')
	.replace(/\n{3,}/g, '\n\n');

fs.writeFileSync(resolvedPath, frontmatter + newBody);
console.log(`✓ ${path.relative(process.cwd(), inputPath)}: ${promoted} heading(s) promoted, ${deleted} line(s) deleted`);
