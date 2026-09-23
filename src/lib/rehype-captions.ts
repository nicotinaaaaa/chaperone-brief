// Transforms the site's figure/table caption convention into semantic HTML:
//
//   <p><img ...></p>                              (or a <table>)
//   <p><strong>Figure 1.</strong> Body. Source: X, 2025, Journal, CC-BY.</p>
//
// becomes:
//
//   <figure>
//     <img ...>
//     <figcaption>
//       <span class="caption-label">Figure 1.</span>
//       <span class="caption-body"> Body.</span>
//       <span class="caption-source">Source: X, 2025, Journal, CC-BY.</span>
//     </figcaption>
//   </figure>
//
// The bold-prefix ("Figure N." / "Table N.") is the authoritative signal. A
// caption paragraph that isn't recognised is left alone — global.css's
// italic-paragraph rule is a cheap fallback for that case, not this one.

interface HastNode {
	type: string;
	tagName?: string;
	value?: string;
	properties?: Record<string, unknown>;
	children?: HastNode[];
}

const LABEL_PATTERN = /^(Figure|Table)\s+\d+\.$/;

const ABBREVIATIONS = new Set([
	'et al',
	'vs',
	'approx',
	'fig',
	'figs',
	'eq',
	'eqs',
	'etc',
	'ca',
	'cf',
	'e.g',
	'i.e',
	'no',
	'vol',
	'pp',
	'ed',
	'eds',
	'trans',
	'dr',
	'mr',
	'mrs',
	'ms',
	'prof',
]);

function isElement(node: HastNode | undefined | null, tagName?: string): node is HastNode {
	return !!node && node.type === 'element' && (!tagName || node.tagName === tagName);
}

function textOf(node: HastNode | undefined | null): string {
	if (!node) return '';
	if (node.type === 'text') return node.value ?? '';
	if (node.children) return node.children.map(textOf).join('');
	return '';
}

function isImageOnlyParagraph(node: HastNode): HastNode | null {
	if (!isElement(node, 'p') || !node.children) return null;
	const meaningful = node.children.filter((c) => !(c.type === 'text' && (c.value ?? '').trim() === ''));
	return meaningful.length === 1 && isElement(meaningful[0], 'img') ? meaningful[0] : null;
}

function matchCaptionParagraph(node: HastNode): { label: string; bodyNodes: HastNode[] } | null {
	if (!isElement(node, 'p') || !node.children) return null;
	let i = 0;
	while (i < node.children.length && node.children[i].type === 'text' && (node.children[i].value ?? '').trim() === '') {
		i++;
	}
	const first = node.children[i];
	if (!isElement(first, 'strong')) return null;
	const label = textOf(first).trim();
	if (!LABEL_PATTERN.test(label)) return null;
	return { label, bodyNodes: node.children.slice(i + 1) };
}

function trimLeadingSpace(nodes: HastNode[]): HastNode[] {
	if (nodes.length === 0) return nodes;
	const [first, ...rest] = nodes;
	if (first.type === 'text') {
		const trimmed = (first.value ?? '').replace(/^\s+/, '');
		return trimmed ? [{ type: 'text', value: trimmed }, ...rest] : rest;
	}
	return nodes;
}

function isLikelyAbbreviation(precedingText: string): boolean {
	const words = precedingText.match(/[A-Za-z]+(?:\.[A-Za-z]+)*/g) ?? [];
	if (words.length === 0) return false;
	const last = words[words.length - 1].toLowerCase();
	if (last.length === 1) return true;
	if (ABBREVIATIONS.has(last)) return true;
	if (words.length >= 2) {
		const lastTwo = `${words[words.length - 2]} ${words[words.length - 1]}`.toLowerCase();
		if (ABBREVIATIONS.has(lastTwo)) return true;
	}
	return false;
}

// Returns the character offset where the final sentence begins, or null if
// the text is a single sentence (nothing to split out as "the source line").
function findFinalSentenceOffset(text: string): number | null {
	const boundaries: number[] = [];
	const re = /[.!?]+(?=\s|$)/g;
	let match: RegExpExecArray | null;
	while ((match = re.exec(text))) {
		const before = text.slice(0, match.index);
		if (isLikelyAbbreviation(before)) continue;
		boundaries.push(match.index + match[0].length);
	}
	if (boundaries.length < 2) return null;
	return boundaries[boundaries.length - 2];
}

function splitNodesAtTextOffset(nodes: HastNode[], offset: number): [HastNode[], HastNode[]] {
	const before: HastNode[] = [];
	const after: HastNode[] = [];
	let consumed = 0;
	let splitting = false;

	for (const node of nodes) {
		if (splitting) {
			after.push(node);
			continue;
		}
		const length = textOf(node).length;
		if (consumed + length <= offset) {
			before.push(node);
			consumed += length;
			continue;
		}
		if (node.type === 'text') {
			const local = offset - consumed;
			const beforeText = (node.value ?? '').slice(0, local);
			const afterText = (node.value ?? '').slice(local);
			if (beforeText) before.push({ type: 'text', value: beforeText });
			if (afterText) after.push({ type: 'text', value: afterText });
		} else {
			// Split point lands inside a nested element (e.g. a link) — keep
			// it whole on the source side rather than mangling it.
			after.push(node);
		}
		consumed += length;
		splitting = true;
	}
	return [before, after];
}

function buildFigcaption(label: string, rawBodyNodes: HastNode[]): HastNode {
	const bodyNodes = trimLeadingSpace(rawBodyNodes);
	const fullText = bodyNodes.map(textOf).join('');
	const splitOffset = findFinalSentenceOffset(fullText);

	const children: HastNode[] = [
		{
			type: 'element',
			tagName: 'span',
			properties: { className: ['caption-label'] },
			children: [{ type: 'text', value: label }],
		},
	];

	if (splitOffset == null) {
		children.push({
			type: 'element',
			tagName: 'span',
			properties: { className: ['caption-body'] },
			children: [{ type: 'text', value: ' ' }, ...bodyNodes],
		});
	} else {
		const [bodyPart, sourcePart] = splitNodesAtTextOffset(bodyNodes, splitOffset);
		children.push({
			type: 'element',
			tagName: 'span',
			properties: { className: ['caption-body'] },
			children: [{ type: 'text', value: ' ' }, ...bodyPart],
		});
		if (sourcePart.length > 0) {
			// sourcePart already carries its own leading space (the boundary is
			// right after the period, before the following whitespace).
			children.push({
				type: 'element',
				tagName: 'span',
				properties: { className: ['caption-source'] },
				children: sourcePart,
			});
		}
	}

	return { type: 'element', tagName: 'figcaption', properties: {}, children };
}

function isWhitespaceText(node: HastNode): boolean {
	return node.type === 'text' && (node.value ?? '').trim() === '';
}

function transformChildren(nodes: HastNode[]): HastNode[] {
	const result: HastNode[] = [];
	let i = 0;

	while (i < nodes.length) {
		const node = nodes[i];
		const image = isImageOnlyParagraph(node);
		const isTable = isElement(node, 'table');

		if (image || isTable) {
			// The caption paragraph is the next *significant* sibling — markdown-to-hast
			// leaves whitespace-only text nodes between block elements, so skip those.
			let j = i + 1;
			while (j < nodes.length && isWhitespaceText(nodes[j])) j++;
			const caption = j < nodes.length ? matchCaptionParagraph(nodes[j]) : null;

			if (caption) {
				result.push({
					type: 'element',
					tagName: 'figure',
					properties: { className: [image ? 'figure-image' : 'figure-table'] },
					children: [image ?? node, buildFigcaption(caption.label, caption.bodyNodes)],
				});
				i = j + 1; // skip the whitespace gap and the consumed caption paragraph
				continue;
			}
		}

		if (node.children) {
			node.children = transformChildren(node.children);
		}
		result.push(node);
		i++;
	}

	return result;
}

export default function rehypeCaptions() {
	return (tree: HastNode) => {
		if (tree.children) {
			tree.children = transformChildren(tree.children);
		}
	};
}
