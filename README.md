# PROLYRICS PRO — sitio web

Web estática para **PROLYRICS PRO**, una biblioteca de recursos visuales y plantillas para iglesias modernas.

Basada en el starter open-source [MauCariApa-com/maucariapacom-church-starter](https://github.com/MauCariApa-com/maucariapacom-church-starter) (licencia MIT), adaptada y rebrandeada.

## Tecnología

- [Astro 7](https://astro.build) (salida 100% estática)
- [Tailwind CSS](https://tailwindcss.com)
- [Preact](https://preactjs.com) (solo para interactividad ligera)
- Node.js 24+

## Desarrollo

```bash
npm install
npm run dev      # http://localhost:4321
npm run build    # genera dist/
npm run preview
```

## Estructura

- `src/pages/` — páginas (`/`, `/recursos`, `/planes`, `/nosotros`, `/contacto`, legales).
- `src/content/resources/` — recursos en Markdown con frontmatter (categoría, formato, imagen, archivo descargable, etc.).
- `public/uploads/resources/` — vistas previas SVG de cada recurso.
- `public/descargas/` — archivos de ejemplo descargables.
- `netlify.toml` / `vercel.json` — configuración de despliegue.

## Añadir un recurso

Crea un archivo Markdown en `src/content/resources/`:

```md
---
title: "Mi nuevo recurso"
description: "Breve descripción."
category: "Plantillas"
format: "SVG"
image: "/uploads/resources/mi-recurso.svg"
fileUrl: "/descargas/mi-recurso.svg"
premium: false
featured: false
tags: ["verso", "alabanza"]
order: 20
draft: false
---

Texto de la página de detalle en Markdown.
```

## Despliegue

El repositorio incluye configuración para **Netlify** y **Vercel**:

- Build command: `npm run build`
- Publish directory: `dist`
- Variable de entorno opcional: `SITE_URL` (URL final del sitio, para el sitemap y OG).

## Licencia

Código base bajo licencia MIT. Consulta `LICENSE`.
