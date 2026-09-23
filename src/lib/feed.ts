import type { CollectionEntry } from 'astro:content';
import type { FeedItem } from '../components/ContentCard.astro';

export function briefToFeedItem(entry: CollectionEntry<'briefs'>): FeedItem {
	return {
		type: 'brief',
		title: entry.data.title,
		summary: entry.data.summary,
		date: entry.data.date,
		href: `/briefs/${entry.id}`,
	};
}

export function reviewToFeedItem(entry: CollectionEntry<'reviews'>): FeedItem {
	return {
		type: 'review',
		title: entry.data.title,
		summary: entry.data.summary,
		date: entry.data.date,
		href: `/reviews/${entry.id}`,
	};
}

export function newsToFeedItem(entry: CollectionEntry<'news'>): FeedItem {
	return {
		type: 'news',
		title: entry.data.title,
		summary: entry.data.summary,
		date: entry.data.date,
		href: `/news/${entry.id}`,
		externalHref: entry.data.link,
	};
}

export function byDateDesc(a: FeedItem, b: FeedItem): number {
	return b.date.valueOf() - a.date.valueOf();
}

export function prodFilter<T extends { data: { draft?: boolean } }>(entry: T): boolean {
	return import.meta.env.PROD ? entry.data.draft !== true : true;
}
