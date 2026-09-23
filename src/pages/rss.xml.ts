import rss, { type RSSFeedItem } from '@astrojs/rss';
import { getCollection, render } from 'astro:content';
import { experimental_AstroContainer as AstroContainer } from 'astro/container';
import type { APIContext } from 'astro';
import { SITE_TITLE, SITE_DESCRIPTION } from '../consts';
import { prodFilter } from '../lib/feed';

// Reviews may carry figures under restricted licensing — the site itself is
// the only place cleared to display them, so the feed keeps the caption text
// (including the source line) but drops the <img> itself rather than
// hotlinking a restricted image into every feed reader.
function stripFigureImages(html: string): string {
	return html.replace(/<img\b[^>]*>/gi, '');
}

export async function GET(context: APIContext) {
	const container = await AstroContainer.create();

	const [briefs, reviews, news] = await Promise.all([
		getCollection('briefs', prodFilter),
		getCollection('reviews', prodFilter),
		getCollection('news'),
	]);

	const briefItems: RSSFeedItem[] = await Promise.all(
		briefs.map(async (entry) => {
			const { Content } = await render(entry);
			const content = await container.renderToString(Content);
			return {
				title: entry.data.title,
				description: entry.data.summary,
				pubDate: entry.data.date,
				link: `/briefs/${entry.id}/`,
				categories: entry.data.tags,
				content,
			};
		}),
	);

	const reviewItems: RSSFeedItem[] = await Promise.all(
		reviews.map(async (entry) => {
			const { Content } = await render(entry);
			const rendered = await container.renderToString(Content);
			return {
				title: entry.data.title,
				description: entry.data.summary,
				pubDate: entry.data.date,
				link: `/reviews/${entry.id}/`,
				categories: entry.data.tags,
				content: stripFigureImages(rendered),
			};
		}),
	);

	const newsItems: RSSFeedItem[] = news.map((entry) => ({
		title: entry.data.title,
		description: entry.data.summary,
		pubDate: entry.data.date,
		link: `/news/${entry.id}/`,
		categories: entry.data.tags,
		content: `<p>${entry.data.summary}</p><p><a href="${entry.data.link}">Read at ${entry.data.source}</a></p>`,
	}));

	const items = [...briefItems, ...reviewItems, ...newsItems].sort(
		(a, b) => (b.pubDate?.valueOf() ?? 0) - (a.pubDate?.valueOf() ?? 0),
	);

	return rss({
		title: SITE_TITLE,
		description: SITE_DESCRIPTION,
		site: context.site!,
		items,
		customData: '<language>en-us</language>',
	});
}
