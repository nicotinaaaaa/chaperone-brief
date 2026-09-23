import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { briefsSchema, reviewsSchema } from './content/schemas';

const briefs = defineCollection({
	loader: glob({ pattern: '**/*.md', base: './src/content/briefs' }),
	schema: briefsSchema,
});

const reviews = defineCollection({
	loader: glob({ pattern: '**/*.md', base: './src/content/reviews' }),
	schema: reviewsSchema,
});

export const collections = { briefs, reviews };
