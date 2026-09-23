import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { briefsSchema, reviewsSchema, newsSchema } from './content/schemas';

const briefs = defineCollection({
	loader: glob({ pattern: '**/*.md', base: './src/content/briefs' }),
	schema: briefsSchema,
});

const reviews = defineCollection({
	loader: glob({ pattern: '**/*.md', base: './src/content/reviews' }),
	schema: reviewsSchema,
});

const news = defineCollection({
	loader: glob({ pattern: '**/*.md', base: './src/content/news' }),
	schema: newsSchema,
});

export const collections = { briefs, reviews, news };
