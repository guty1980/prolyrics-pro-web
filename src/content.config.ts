import { defineCollection } from 'astro:content';
import { glob } from 'astro/loaders';
import { z } from 'astro/zod';

const resourcesCollection = defineCollection({
  loader: glob({ pattern: '**/[^_]*.{md,mdx}', base: './src/content/resources' }),
  schema: z.object({
    title: z.string(),
    description: z.string(),
    category: z.enum(['Plantillas', 'Fondos', 'Canciones', 'Videos', 'Iconos']),
    format: z.string(),
    image: z.string().startsWith('/uploads/resources/'),
    fileUrl: z.string(),
    premium: z.boolean().default(false),
    featured: z.boolean().default(false),
    tags: z.array(z.string()).default([]),
    order: z.number().default(0),
    draft: z.boolean().default(false),
  }),
});

export const collections = { resources: resourcesCollection };
