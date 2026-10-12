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

// Greek letters carry real meaning in biology titles (β-cell, TNF-α, Aβ) and
// would otherwise be dropped outright, leaving "cell-dedifferentiation…".
const GREEK_LETTER_NAMES = {
	α: 'alpha', β: 'beta', γ: 'gamma', δ: 'delta', ε: 'epsilon', ζ: 'zeta', η: 'eta', θ: 'theta',
	ι: 'iota', κ: 'kappa', λ: 'lambda', μ: 'mu', ν: 'nu', ξ: 'xi', π: 'pi', ρ: 'rho', σ: 'sigma',
	τ: 'tau', φ: 'phi', χ: 'chi', ψ: 'psi', ω: 'omega',
};

export function slugify(input) {
	return input
		.toLowerCase()
		.replace(/[α-ω]/g, (c) => ` ${GREEK_LETTER_NAMES[c] ?? ''} `)
		.normalize('NFKD')
		.replace(/[̀-ͯ]/g, '')
		// An apostrophe joins rather than splits: "Huntington's" → "huntingtons".
		.replace(/['’‘`]/g, '')
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

// Once frontmatter carries a title (original or just derived from this same
// heading), a leading "# Heading" in the body renders as a second, duplicate
// <h1> alongside the page template's own title. Strips it; a no-op if the
// body doesn't start with an h1, or if there's no title to compare against.
// Deterministic, same shape as stripTableOfContents.
//
// Blank lines and horizontal rules before the heading are skipped (and
// dropped with it): a kicker line deleted ahead of a "rule, then title"
// layout leaves the rule as the first thing in the body, and a leading rule
// otherwise hides the heading from this check, leaving a second <h1>.
export function stripLeadingHeading(body, title) {
	if (!title) return { body, removed: null };

	const lines = body.split('\n');
	let i = 0;
	while (i < lines.length && (lines[i].trim() === '' || HR_PATTERN.test(lines[i]))) i++;
	if (i >= lines.length || !/^#(?!#)\s+.+$/.test(lines[i])) {
		return { body, removed: null };
	}

	const headingText = lines[i].replace(/^#\s+/, '').trim();
	let end = i + 1;
	while (end < lines.length && lines[end].trim() === '') end++;

	return {
		body: lines.slice(end).join('\n'),
		removed: {
			text: headingText,
			matchesTitle: headingText === String(title).trim(),
		},
	};
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

const MONTH_NUMBERS = {
	jan: '01', january: '01',
	feb: '02', february: '02',
	mar: '03', march: '03',
	apr: '04', april: '04',
	may: '05',
	jun: '06', june: '06',
	jul: '07', july: '07',
	aug: '08', august: '08',
	sep: '09', sept: '09', september: '09',
	oct: '10', october: '10',
	nov: '11', november: '11',
	dec: '12', december: '12',
};

const MONTH_PATTERN =
	'(January|February|March|April|May|June|July|August|September|October|November|December|Jan|Feb|Mar|Apr|Jun|Jul|Aug|Sept|Sep|Oct|Nov|Dec)\\.?';

// Tries a date range against one piece of text, in three shapes: strict ISO
// ("2026-09-06 to 2026-09-20"), month-first prose ("August 16–30, 2026" or
// "July 27 – August 9, 2026"), or day-first prose ("roughly 6–20 September
// 2026"). Returns { windowStart, windowEnd } (ISO date strings) or undefined.
function matchDateRange(rawText) {
	// A hedge ("roughly October 4 – October 11, 2026") would otherwise defeat
	// every start-anchored pattern below.
	const text = rawText.replace(/^(?:roughly|about|approximately|around|circa|c\.|~)\s*/i, '');

	const isoMatch = text.match(/^(\d{4}-\d{2}-\d{2})\s*(?:to|–|—|-)\s*(\d{4}-\d{2}-\d{2})/i);
	if (isoMatch) {
		return { windowStart: isoMatch[1], windowEnd: isoMatch[2] };
	}

	const monthFirst = new RegExp(
		`^${MONTH_PATTERN}\\s+(\\d{1,2})\\s*(?:[–—-]\\s*(?:${MONTH_PATTERN}\\s+)?(\\d{1,2}))?,?\\s*(\\d{4})`,
		'i',
	);
	const mf = text.match(monthFirst);
	if (mf && mf[4]) {
		const [, month1, day1, month2, day2, year] = mf;
		const m1 = MONTH_NUMBERS[month1.toLowerCase()];
		const m2 = month2 ? MONTH_NUMBERS[month2.toLowerCase()] : m1;
		return {
			windowStart: `${year}-${m1}-${day1.padStart(2, '0')}`,
			windowEnd: `${year}-${m2}-${day2.padStart(2, '0')}`,
		};
	}

	const dayFirst = new RegExp(
		`^(?:roughly\\s+)?(\\d{1,2})\\s*[–—-]\\s*(\\d{1,2})\\s+${MONTH_PATTERN}\\s+(\\d{4})`,
		'i',
	);
	const df = text.match(dayFirst);
	if (df) {
		const [, day1, day2, month, year] = df;
		const m = MONTH_NUMBERS[month.toLowerCase()];
		return {
			windowStart: `${year}-${m}-${day1.padStart(2, '0')}`,
			windowEnd: `${year}-${m}-${day2.padStart(2, '0')}`,
		};
	}

	return undefined;
}

// Looks for an explicit "Coverage window:"/"Period covered:" line first (the
// label itself may carry markdown emphasis, e.g. `**Coverage window:**`,
// between the colon and the date). Falls back to parsing the date range
// directly out of the title (e.g. "Science & Biotech Brief — September
// 15–29, 2026") when no such line exists — some briefs state the window
// only there, not as a separate labelled line in the body.
export function deriveCoverageWindow(body, title) {
	const labelMatch = body.match(/(coverage window|period covered)\s*:?\s*[*_]*\s*/i);
	if (labelMatch) {
		const fromLabel = matchDateRange(body.slice(labelMatch.index + labelMatch[0].length));
		if (fromLabel) return fromLabel;
	}

	if (title) {
		const fromTitle = matchDateRange(title.replace(/^.*?—\s*/, ''));
		if (fromTitle) return fromTitle;
	}

	return undefined;
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

// ---------------------------------------------------------------------------
// Figure and table captions, and figure alt text.
//
// The site's caption transform (src/lib/rehype-captions.ts) only recognises a
// paragraph that directly FOLLOWS an image or a table and opens with a bold
// "Figure N." / "Table N." label. docx conversions produce plenty of other
// shapes — a caption that sits above its table, a title above plus a source
// note below, fully-bold / fully-italic / plain / blockquoted captions — none
// of which get the figure/figcaption treatment. This rewrites them all to the
// one recognised shape, and gives every image real alt text taken from its
// own caption rather than a placeholder.
// ---------------------------------------------------------------------------

const CAPTION_ABBREVIATIONS = new Set(['et al', 'vs', 'approx', 'fig', 'figs', 'eq', 'etc', 'ca', 'cf', 'e.g', 'i.e', 'no', 'vol', 'pp']);
const ALT_MAX_LENGTH = 200;

function parseCaption(raw) {
	const t = raw
		.split('\n')
		.map((l) => l.replace(/^\s*>\s?/, ''))
		.join(' ')
		.replace(/\s+/g, ' ')
		.trim();
	const m =
		t.match(/^\*\*(Figure|Table)\s+(\d+)\.\*\*\s*(.*)$/s) || // **Figure 1.** body
		t.match(/^\*\*(Figure|Table)\s+(\d+)\.\s+(.*?)\*\*$/s) || // **Figure 1. body**
		t.match(/^[*_](Figure|Table)\s+(\d+)\.\s+(.*)[*_]$/s) || // *Figure 1. body*
		t.match(/^(Figure|Table)\s+(\d+)\.\s+(.*)$/s); // Figure 1. body
	if (!m) return null;
	let body = m[3].trim();
	const wholeItalic = body.match(/^\*(?!\*)(.+)\*$/s);
	if (wholeItalic && !wholeItalic[1].includes('*')) body = wholeItalic[1].trim();
	return { kind: m[1], n: m[2], body };
}

function canonicalCaption(kind, n, body) {
	return `**${kind} ${n}.** ${body}`.trim();
}

function endsSentence(text) {
	return /[.!?]["')\]]?$/.test(text.trim());
}

function altFromCaptionBody(body) {
	const plain = body
		.replace(/\\\[[^\]]*\\\]/g, '') // \[12\] style citation markers
		.replace(/<sup>.*?<\/sup>/gi, '')
		.replace(/\\(.)/g, '$1')
		.replace(/[*_`]/g, '')
		.replace(/[\[\]]/g, '')
		.replace(/\s+/g, ' ')
		.replace(/\s+([;,.:])/g, '$1') // gaps left where a citation marker was removed
		.trim();
	const re = /[.!?](?=\s|$)/g;
	let sentence = plain;
	let m;
	while ((m = re.exec(plain))) {
		// A period straight after ")" ends a sentence ("…investigation (B).");
		// otherwise a lone letter or a known abbreviation is not a sentence end.
		if (plain[m.index - 1] !== ')') {
			const words = plain.slice(0, m.index).match(/[A-Za-z]+(?:\.[A-Za-z]+)*/g) ?? [];
			const last = (words[words.length - 1] ?? '').toLowerCase();
			const lastTwo = words.length >= 2 ? `${words[words.length - 2]} ${words[words.length - 1]}`.toLowerCase() : '';
			if (last.length === 1 || CAPTION_ABBREVIATIONS.has(last) || CAPTION_ABBREVIATIONS.has(lastTwo)) continue;
		}
		sentence = plain.slice(0, m.index + 1);
		break;
	}
	if (sentence.length > ALT_MAX_LENGTH) {
		// Too long for alt text: a caption's opening clause is its title, and
		// what trails it is usually provenance ("…, synthesized from X et al.").
		// Cut at the first clause boundary past a minimum length rather than
		// mid-phrase with an ellipsis; only fall back to a word-boundary cut
		// when there's no clause boundary within the limit.
		const window = sentence.slice(0, ALT_MAX_LENGTH);
		const boundary = window.slice(60).search(/[,;:]|\s—\s/);
		if (boundary !== -1) {
			sentence = window.slice(0, 60 + boundary).trimEnd();
		} else {
			sentence = `${window.slice(0, window.lastIndexOf(' ')).trimEnd()}…`;
		}
	}
	return sentence;
}

function isImageBlock(text) {
	return /^!\[[^\]]*\]\([^)]*\)$/.test(text.trim());
}

// "| --- | :-: |" — the second line of every pipe table.
const PIPE_DELIMITER_ROW = /^\|?\s*:?-{1,}:?\s*(\|\s*:?-{1,}:?\s*)+\|?\s*$/;
// A row's closing pipe; an escaped "\|" at the end of a line is cell text.
const ROW_CLOSED = /(?<!\\)\|\s*$/;

function isPipeTable(lines) {
	return lines.length >= 2 && lines[0].trim().startsWith('|') && PIPE_DELIMITER_ROW.test(lines[1].trim());
}

function isTableBlock(text) {
	const s = text.trim();
	if (/^<table[\s>][\s\S]*<\/table>$/i.test(s)) return true;
	const lines = s.split('\n');
	return isPipeTable(lines) || (lines.length >= 2 && lines.every((l) => l.trim().startsWith('|')));
}

// A table cell that held a soft line break comes out of pandoc as a row split
// across two lines ("| NCT04328441" / "(BCG-CORONA) | BCG to reduce…"). Markdown
// reads that as two rows — a one-cell stub plus a misaligned remainder — so
// rejoin each unterminated row with the lines that continue it. A soft break
// is a space; nothing else about the cell text changes.
function repairWrappedRows(text) {
	const lines = text.split('\n');
	if (!isPipeTable(lines)) return { text, repaired: [] };
	const out = [];
	const repaired = [];
	for (const line of lines) {
		const prev = out[out.length - 1];
		if (prev !== undefined && prev.trim().startsWith('|') && !ROW_CLOSED.test(prev) && !line.trim().startsWith('|')) {
			out[out.length - 1] = `${prev.trimEnd()} ${line.trim()}`;
			repaired.push(out[out.length - 1].trim().slice(0, 70));
		} else {
			out.push(line);
		}
	}
	return { text: out.join('\n'), repaired };
}

// Returns { body, report }. Never throws on unrecognised content — anything it
// can't confidently classify is left exactly as it was.
export function normalizeFiguresAndCaptions(body) {
	const pieces = body.split(/(\n[ \t]*\n+)/);
	const blocks = [];
	for (let i = 0; i < pieces.length; i += 2) {
		blocks.push({ text: pieces[i], sep: pieces[i + 1] ?? '' });
	}

	// A raw-HTML table can contain blank lines; rejoin it into one block.
	for (let i = 0; i < blocks.length; i++) {
		if (/^<table[\s>]/i.test(blocks[i].text.trim()) && !/<\/table>/i.test(blocks[i].text)) {
			while (i + 1 < blocks.length && !/<\/table>/i.test(blocks[i].text)) {
				blocks[i].text += blocks[i].sep + blocks[i + 1].text;
				blocks[i].sep = blocks[i + 1].sep;
				blocks.splice(i + 1, 1);
			}
		}
	}

	const report = { rewritten: [], moved: [], merged: [], alt: [], missingAlt: [], repairedRows: [] };
	for (const block of blocks) {
		const { text, repaired } = repairWrappedRows(block.text);
		if (repaired.length > 0) {
			block.text = text;
			report.repairedRows.push(...repaired);
		}
	}
	const consumed = new Set();
	const dropped = new Set();
	const appendAfter = new Map();

	for (let i = 0; i < blocks.length; i++) {
		const text = blocks[i].text;

		if (isImageBlock(text)) {
			const next = i + 1 < blocks.length ? parseCaption(blocks[i + 1].text) : null;
			const cap = next && next.kind === 'Figure' && !consumed.has(i + 1) ? next : null;
			let altSource = null;
			if (cap) {
				const canonical = canonicalCaption(cap.kind, cap.n, cap.body);
				if (canonical !== blocks[i + 1].text.trim()) {
					report.rewritten.push({ from: blocks[i + 1].text.trim().slice(0, 70), to: canonical.slice(0, 70) });
					blocks[i + 1].text = canonical;
				}
				consumed.add(i + 1);
				altSource = cap;
			}
			const im = text.trim().match(/^!\[([^\]]*)\]\((.*)\)$/s);
			if (im) {
				const currentAlt = im[1].trim();
				if (currentAlt === '' || /^TODO alt text$/i.test(currentAlt)) {
					if (altSource) {
						const alt = altFromCaptionBody(altSource.body);
						blocks[i].text = `![${alt}](${im[2]})`;
						report.alt.push({ label: `Figure ${altSource.n}`, alt });
					} else {
						blocks[i].text = `![](${im[2]})`;
						report.missingAlt.push(im[2]);
					}
				}
			}
			continue;
		}

		if (isTableBlock(text)) {
			const afterIdx = i + 1;
			const beforeIdx = i - 1;
			const after = afterIdx < blocks.length && !consumed.has(afterIdx) ? parseCaption(blocks[afterIdx].text) : null;
			const before = beforeIdx >= 0 && !consumed.has(beforeIdx) ? parseCaption(blocks[beforeIdx].text) : null;
			const afterOk = after && after.kind === 'Table' ? after : null;
			const beforeOk = before && before.kind === 'Table' && (!afterOk || afterOk.n === before.n) ? before : null;

			if (afterOk && beforeOk) {
				// A title above the table and a note/source below it: one caption.
				const title = endsSentence(beforeOk.body) ? beforeOk.body : `${beforeOk.body}.`;
				const merged = canonicalCaption('Table', afterOk.n, `${title} ${afterOk.body}`);
				blocks[afterIdx].text = merged;
				dropped.add(beforeIdx);
				consumed.add(afterIdx);
				consumed.add(beforeIdx);
				report.merged.push({ label: `Table ${afterOk.n}`, to: merged.slice(0, 90) });
			} else if (afterOk) {
				const canonical = canonicalCaption('Table', afterOk.n, afterOk.body);
				if (canonical !== blocks[afterIdx].text.trim()) {
					report.rewritten.push({ from: blocks[afterIdx].text.trim().slice(0, 70), to: canonical.slice(0, 70) });
					blocks[afterIdx].text = canonical;
				}
				consumed.add(afterIdx);
			} else if (beforeOk) {
				// Caption above the table: move it below.
				const canonical = canonicalCaption('Table', beforeOk.n, beforeOk.body);
				dropped.add(beforeIdx);
				consumed.add(beforeIdx);
				appendAfter.set(i, canonical);
				report.moved.push({ label: `Table ${beforeOk.n}`, to: canonical.slice(0, 90) });
			}
		}
	}

	const out = [];
	for (let i = 0; i < blocks.length; i++) {
		if (dropped.has(i)) continue;
		const isLastKept = (() => {
			for (let j = i + 1; j < blocks.length; j++) if (!dropped.has(j)) return false;
			return true;
		})();
		if (appendAfter.has(i)) {
			out.push(blocks[i].text, '\n\n', appendAfter.get(i), isLastKept ? '' : (blocks[i].sep || '\n\n'));
		} else {
			out.push(blocks[i].text, isLastKept ? '' : blocks[i].sep);
		}
	}
	return { body: out.join(''), report };
}

export function printValidationErrors(filename, issues) {
	console.error(`✗ ${filename} failed schema validation:`);
	for (const issue of issues) {
		const fieldPath = issue.path.join('.') || '(root)';
		console.error(`  - ${fieldPath}: ${issue.message}`);
	}
}
