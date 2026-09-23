import { z } from 'astro/zod';

export const briefsSchema = z.object({
	title: z.string(),
	date: z.coerce.date(),
	windowStart: z.coerce.date(),
	windowEnd: z.coerce.date(),
	summary: z.string(),
	tags: z.array(z.string()).default([]),
	itemCount: z.number().int().nonnegative().optional(),
	draft: z.boolean().default(false),
});

export const reviewSourceSchema = z.object({
	title: z.string(),
	url: z.url(),
	authors: z.string().optional(),
	year: z.coerce.number().int().optional(),
	journal: z.string().optional(),
	doi: z.string().optional(),
	pmid: z.coerce.number().int().optional(),
});

export const reviewsSchema = z.object({
	title: z.string(),
	date: z.coerce.date(),
	summary: z.string(),
	tags: z.array(z.string()).default([]),
	subfield: z.string().optional(),
	readingTime: z.number().int().positive().optional(),
	sources: z.array(reviewSourceSchema).optional(),
	docxPath: z.string().startsWith('/').optional(),
	draft: z.boolean().default(false),
});

export const newsSchema = z.object({
	title: z.string(),
	date: z.coerce.date(),
	summary: z.string(),
	link: z.url(),
	source: z.string(),
	tags: z.array(z.string()).default([]),
});

export type BriefData = z.infer<typeof briefsSchema>;
export type ReviewData = z.infer<typeof reviewsSchema>;
export type NewsData = z.infer<typeof newsSchema>;
