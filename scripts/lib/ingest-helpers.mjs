// valueFlags: names of flags that take a following value, e.g. ['slug', 'docx']
// for --slug <value> --docx <value>. Returns { force, inputPath, ...values }.
export function parseArgs(argv, valueFlags = []) {
	const force = argv.includes('--force');
	const values = {};
	const consumed = new Set();
	for (const flag of valueFlags) {
		const index = argv.indexOf(`--${flag}`);
		if (index !== -1) {
			values[flag] = argv[index + 1];
			consumed.add(index);
			consumed.add(index + 1);
		}
	}
	const positional = argv.filter((arg, i) => {
		if (consumed.has(i)) return false;
		if (arg.startsWith('--')) return false;
		return true;
	});
	return { force, ...values, inputPath: positional[0] };
}

export function fail(message) {
	console.error(`✗ ${message}`);
	process.exit(1);
}

export function slugify(input) {
	return input
		.toLowerCase()
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '')
		.replace(/-{2,}/g, '-');
}

export function toDateOnly(date) {
	const y = date.getUTCFullYear();
	const m = String(date.getUTCMonth() + 1).padStart(2, '0');
	const d = String(date.getUTCDate()).padStart(2, '0');
	return `${y}-${m}-${d}`;
}

export function deriveTitleFromH1(body) {
	const match = body.match(/^#\s+(.+)$/m);
	return match ? match[1].trim() : undefined;
}

function stripInlineMarkdown(text) {
	return text
		.replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
		.replace(/(\*\*|__)(.*?)\1/g, '$2')
		.replace(/(\*|_)(.*?)\1/g, '$2')
		.replace(/`([^`]+)`/g, '$1');
}

function clean(text) {
	const trimmed = stripInlineMarkdown(text).replace(/\s+/g, ' ').trim();
	return trimmed.length > 300 ? `${trimmed.slice(0, 297).trimEnd()}…` : trimmed;
}

function deriveFromTakeaways(lines) {
	const headingIndex = lines.findIndex((l) => /^#{2,3}\s*top takeaways\s*$/i.test(l.trim()));
	if (headingIndex === -1) return undefined;
	for (let i = headingIndex + 1; i < lines.length; i++) {
		const line = lines[i];
		if (/^#{1,6}\s/.test(line)) break;
		const itemMatch = line.match(/^\s*[-*]\s+(.+)$/);
		if (itemMatch) return clean(itemMatch[1]);
	}
	return undefined;
}

function deriveFirstParagraph(lines) {
	const h1Index = lines.findIndex((l) => /^#\s+/.test(l));
	let i = h1Index === -1 ? 0 : h1Index + 1;
	while (i < lines.length) {
		const line = lines[i];
		if (line.trim() === '' || /^#{1,6}\s/.test(line) || /^[-*>]/.test(line.trim())) {
			i++;
			continue;
		}
		const paraLines = [];
		while (i < lines.length && lines[i].trim() !== '' && !/^#{1,6}\s/.test(lines[i])) {
			paraLines.push(lines[i]);
			i++;
		}
		return clean(paraLines.join(' '));
	}
	return undefined;
}

export function deriveSummary(body) {
	const lines = body.split('\n');
	return deriveFromTakeaways(lines) ?? deriveFirstParagraph(lines);
}

export function deriveCoverageWindow(body) {
	const match = body.match(
		/coverage window:?\s*(\d{4}-\d{2}-\d{2})\s*(?:to|–|—|-)\s*(\d{4}-\d{2}-\d{2})/i,
	);
	if (!match) return undefined;
	return { windowStart: match[1], windowEnd: match[2] };
}

export function countTopLevelItems(body) {
	const matches = body.match(/^###\s+.+$/gm);
	return matches ? matches.length : 0;
}

export function wordCount(body) {
	const stripped = body.replace(/```[\s\S]*?```/g, ' ');
	const words = stripped.trim().match(/\S+/g);
	return words ? words.length : 0;
}

const HR_PATTERN = /^ {0,3}(-{3,}|\*{3,}|_{3,})\s*$/;
const H2_PATTERN = /^##(?!#)\s+/;
const TOC_HEADING_PATTERN = /^##(?!#)\s*table of contents\s*$/i;
const ANCHOR_LIST_ITEM_PATTERN = /^\s*(?:\d+[.)]|[-*+])\s+\[.+\]\(#.+\)\s*$/;

// Detects a "## Table of contents" heading followed by a list of anchor links,
// and removes it through to the next h2 (excluded — real content) or the next
// horizontal rule (included — treated as the section's own closing delimiter).
// Deterministic; a no-op (returns the body unchanged) when no such section exists,
// or when the heading isn't actually followed by an anchor-link list.
export function stripTableOfContents(body) {
	const lines = body.split('\n');
	const headingIndex = lines.findIndex((line) => TOC_HEADING_PATTERN.test(line.trim()));
	if (headingIndex === -1) {
		return { body, removed: null };
	}

	let firstItemIndex = headingIndex + 1;
	while (firstItemIndex < lines.length && lines[firstItemIndex].trim() === '') {
		firstItemIndex++;
	}
	if (firstItemIndex >= lines.length || !ANCHOR_LIST_ITEM_PATTERN.test(lines[firstItemIndex])) {
		return { body, removed: null };
	}

	let end = lines.length;
	let consumedTrailingRule = false;
	for (let i = firstItemIndex; i < lines.length; i++) {
		if (H2_PATTERN.test(lines[i])) {
			end = i;
			break;
		}
		if (HR_PATTERN.test(lines[i])) {
			end = i + 1;
			consumedTrailingRule = true;
			break;
		}
	}

	const removedLines = lines.slice(headingIndex, end);
	const remainingBody = [...lines.slice(0, headingIndex), ...lines.slice(end)]
		.join('\n')
		.replace(/\n{3,}/g, '\n\n');

	return {
		body: remainingBody,
		removed: {
			text: removedLines.join('\n').trim(),
			itemCount: removedLines.filter((l) => ANCHOR_LIST_ITEM_PATTERN.test(l)).length,
			consumedTrailingRule,
		},
	};
}

export function printValidationErrors(filename, issues) {
	console.error(`✗ ${filename} failed schema validation:`);
	for (const issue of issues) {
		const fieldPath = issue.path.join('.') || '(root)';
		console.error(`  - ${fieldPath}: ${issue.message}`);
	}
}
