import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const sourceDir = join(root, "src", "content", "resources");
const targetFile = join(root, "netlify", "functions", "_lib", "seed-resources.mjs");

function parseScalar(value) {
  const raw = value.trim();
  if (raw === "true") return true;
  if (raw === "false") return false;
  if (/^-?\d+$/.test(raw)) return Number(raw);
  if (raw.startsWith("[") && raw.endsWith("]")) {
    return raw
      .slice(1, -1)
      .split(",")
      .map((item) => item.trim().replace(/^["']|["']$/g, ""))
      .filter(Boolean);
  }
  return raw.replace(/^["']|["']$/g, "");
}

function parseFrontmatter(text) {
  const match = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?/);
  if (!match) return { data: {}, body: text.trim() };

  const data = {};
  for (const line of match[1].split(/\r?\n/)) {
    const separator = line.indexOf(":");
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    const value = line.slice(separator + 1);
    if (key) data[key] = parseScalar(value);
  }

  return { data, body: text.slice(match[0].length).trim() };
}

const files = (await readdir(sourceDir)).filter((name) => name.endsWith(".md")).sort();
const resources = [];

for (const file of files) {
  const text = await readFile(join(sourceDir, file), "utf8");
  const { data, body } = parseFrontmatter(text);
  const slug = file.replace(/\.md$/, "");

  resources.push({
    slug,
    title: data.title ?? slug,
    description: data.description ?? "",
    category: data.category ?? "Plantillas",
    format: data.format ?? "SVG",
    image: data.image ?? "/uploads/resources/default.svg",
    fileUrl: data.fileUrl ?? "#",
    premium: Boolean(data.premium),
    featured: Boolean(data.featured),
    tags: Array.isArray(data.tags) ? data.tags : [],
    order: Number(data.order ?? 0),
    draft: Boolean(data.draft),
    body,
  });
}

await mkdir(dirname(targetFile), { recursive: true });
await writeFile(
  targetFile,
  `// Generado desde src/content/resources por scripts/generate-seed-resources.mjs\nexport const seedResources = ${JSON.stringify(resources, null, 2)};\n`,
  "utf8",
);

console.log(`Semilla generada: ${resources.length} recursos -> ${targetFile}`);
