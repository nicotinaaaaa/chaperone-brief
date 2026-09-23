export function parseArgs(argv) {
	const force = argv.includes('--force');
	const slugIndex = argv.indexOf('--slug');
	const slug = slugIndex !== -1 ? argv[slugIndex + 1] : undefined;
	const positional = argv.filter((arg, i) => {
		if (arg.startsWith('--')) return false;
		if (slugIndex !== -1 && i === slugIndex + 1) return false;
		return true;
	});
	return { force, slug, inputPath: positional[0] };
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

export function printValidationErrors(filename, issues) {
	console.error(`✗ ${filename} failed schema validation:`);
	for (const issue of issues) {
		const fieldPath = issue.path.join('.') || '(root)';
		console.error(`  - ${fieldPath}: ${issue.message}`);
	}
}
