import crypto from "node:crypto";
import {
  checkPassword,
  clearSessionCookie,
  getSessionSecret,
  isSecureRequest,
  issueSession,
  setPasswordHash,
} from "./_lib/auth.mjs";
import {
  chunkStore,
  contentStore,
  mediaStore,
  readJSON,
  writeJSON,
} from "./_lib/blobs.mjs";
import {
  error,
  json,
  readJson,
  requireAdmin,
  safeFileName,
  slugify,
  unauthorized,
} from "./_lib/http.mjs";
import { seedResources } from "./_lib/seed-resources.mjs";
import { defaultBranding, seedProducts } from "./_lib/seed-products.mjs";
import {
  clearUserSessionCookie,
  findUserByEmail,
  getUsers,
  getUserFromRequest,
  hashPassword,
  issueUserSession,
  publicUser,
  saveUsers,
  userSessionCookie,
  verifyPassword,
} from "./_lib/users.mjs";

export const config = { path: "/api/*" };

const MAX_CHUNK_BYTES = 5 * 1024 * 1024;
// Netlify Blobs permite hasta 5 GB por objeto. Dejamos margen.
const MAX_FILE_BYTES = Math.floor(4.5 * 1024 * 1024 * 1024);

function getRoute(url) {
  const fromQuery = url.searchParams.get("route");
  if (fromQuery) return fromQuery.replace(/^\/+|\/+$/g, "");

  const match = url.pathname.match(/(?:^|\/)api\/(.*)$/);
  if (match) return match[1].replace(/^\/+|\/+$/g, "");

  return "";
}

function normalizePath(value) {
  const raw = String(value || "/");
  const withSlash = raw.startsWith("/") ? raw : `/${raw}`;
  return withSlash.length > 1 ? withSlash.replace(/\/+$/, "") : "/";
}

function textList(value) {
  if (Array.isArray(value)) return value.map((item) => String(item).trim()).filter(Boolean);
  return String(value || "")
    .split("\n")
    .map((line) => line.replace(/^[-*•]\s*/, "").trim())
    .filter(Boolean);
}

async function getSiteContent() {
  const content = await readJSON(contentStore(), "site", {});
  return {
    overrides: content.overrides && typeof content.overrides === "object" ? content.overrides : {},
    sections: Array.isArray(content.sections) ? content.sections : [],
  };
}

async function saveSiteContent(content) {
  await writeJSON(contentStore(), "site", {
    ...content,
    updatedAt: new Date().toISOString(),
  });
}

async function getResources() {
  const stored = await readJSON(contentStore(), "resources", null);
  if (Array.isArray(stored)) return stored;
  await writeJSON(contentStore(), "resources", seedResources);
  return seedResources;
}

async function getProducts() {
  const stored = await readJSON(contentStore(), "products", null);
  if (Array.isArray(stored)) return stored;
  await writeJSON(contentStore(), "products", seedProducts);
  return seedProducts;
}

async function getBranding() {
  const stored = await readJSON(contentStore(), "branding", null);
  return { ...defaultBranding, ...(stored && typeof stored === "object" ? stored : {}) };
}

async function getMediaItems() {
  const store = mediaStore();
  const { blobs } = await store.list();
  const items = await Promise.all(
    blobs.map(async ({ key }) => {
      const entry = await store.getWithMetadata(key, { consistency: "strong" });
      const metadata = entry?.metadata || {};
      return {
        key,
        name: metadata.name || key.split("/").pop() || key,
        type: metadata.type || "application/octet-stream",
        size: Number(metadata.size || 0),
        alt: metadata.alt || "",
        folder: metadata.folder || "",
        uploadedAt: metadata.uploadedAt || "",
        url: `/api/media?key=${encodeURIComponent(key)}`,
      };
    }),
  );
  return items.sort((a, b) => String(b.uploadedAt).localeCompare(String(a.uploadedAt)));
}

function contentTypeFor(name, fallback) {
  const ext = String(name || "").split(".").pop()?.toLowerCase();
  const types = {
    png: "image/png",
    jpg: "image/jpeg",
    jpeg: "image/jpeg",
    gif: "image/gif",
    webp: "image/webp",
    svg: "image/svg+xml",
    avif: "image/avif",
    mp4: "video/mp4",
    webm: "video/webm",
    mov: "video/quicktime",
    m4v: "video/x-m4v",
    pdf: "application/pdf",
    zip: "application/zip",
    json: "application/json",
    txt: "text/plain; charset=utf-8",
  };
  return types[ext] || fallback || "application/octet-stream";
}

function adminSessionCookie(request, token, maxAge) {
  const secure = isSecureRequest(request);
  return [
    `pl_admin=${encodeURIComponent(token)}`,
    "HttpOnly",
    "SameSite=Lax",
    "Path=/",
    `Max-Age=${maxAge}`,
    secure ? "Secure" : "",
  ]
    .filter(Boolean)
    .join("; ");
}

function notFoundMedia() {
  return json({ ok: false, error: "Archivo no encontrado." }, 404);
}

async function streamMedia(key) {
  const entry = await mediaStore().getWithMetadata(key, {
    type: "stream",
    consistency: "strong",
  });
  if (!entry || !entry.data) return notFoundMedia();

  const metadata = entry.metadata || {};
  const name = metadata.name || key.split("/").pop() || "archivo";
  const type = metadata.type || contentTypeFor(name);

  return new Response(entry.data, {
    status: 200,
    headers: {
      "content-type": type,
      "content-disposition": `inline; filename="${safeFileName(name)}"; filename*=UTF-8''${encodeURIComponent(name)}`,
      "cache-control": "public, max-age=31536000, immutable",
      "x-content-type-options": "nosniff",
    },
  });
}

export default async function handler(request) {
  const url = new URL(request.url);
  const route = getRoute(url);
  const method = request.method.toUpperCase();

  if (route === "health" && method === "GET") {
    return json({ ok: true, service: "creativox-api", time: new Date().toISOString() });
  }

  // --- Autenticación de administrador --------------------------------------
  if (route === "admin/login" && method === "POST") {
    const secret = getSessionSecret();
    if (!secret) return error("Falta configurar SESSION_SECRET en Netlify.", 500);

    const body = await readJson(request);
    const password = String(body.password || "");
    if (!password) return error("Escribe la clave de administrador.", 400);
    if (!(await checkPassword(password))) return error("Clave incorrecta.", 401);

    const { token, maxAge } = issueSession(secret);
    return json({ ok: true }, 200, { "set-cookie": adminSessionCookie(request, token, maxAge) });
  }

  if (route === "admin/logout" && method === "POST") {
    return json({ ok: true }, 200, {
      "set-cookie": clearSessionCookie({ secure: isSecureRequest(request) }),
    });
  }

  if (route === "admin/session" && method === "GET") {
    if (!requireAdmin(request)) return unauthorized();
    return json({ ok: true, user: "admin", brand: "CREATIVOX" });
  }

  if (route === "admin/password" && method === "POST") {
    if (!requireAdmin(request)) return unauthorized();
    const body = await readJson(request);
    if (!(await checkPassword(String(body.currentPassword || "")))) {
      return error("La clave actual no es correcta.", 401);
    }
    const next = String(body.newPassword || "");
    if (next.length < 6) return error("La nueva clave debe tener al menos 6 caracteres.", 400);
    await setPasswordHash(next);
    return json({ ok: true });
  }

  // --- Contenido editable --------------------------------------------------
  if (route === "content" && method === "GET") {
    const site = await getSiteContent();
    const page = normalizePath(url.searchParams.get("path") || "/");
    return json({
      ok: true,
      path: page,
      overrides: site.overrides[page] || {},
      sections: site.sections.filter((section) => normalizePath(section.path) === page),
    });
  }

  if (route === "content" && method === "POST") {
    if (!requireAdmin(request)) return unauthorized();
    const body = await readJson(request);
    const page = normalizePath(body.path);
    const site = await getSiteContent();

    if (body.section) {
      const section = { ...body.section, path: page };
      if (!section.id) section.id = crypto.randomUUID();
      if (!section.html) return error("La sección necesita contenido HTML.", 400);
      section.position = ["append", "before", "after"].includes(section.position)
        ? section.position
        : "append";
      section.enabled = section.enabled !== false;
      site.sections = site.sections.filter((item) => item.id !== section.id);
      site.sections.push(section);
      await saveSiteContent(site);
      return json({ ok: true, section });
    }

    const selector = String(body.selector || "").trim();
    if (!selector) return error("Falta el selector del elemento.", 400);

    const pageOverrides = site.overrides[page] || {};
    if (body.patch === null || body.remove === true || body.delete === true) {
      delete pageOverrides[selector];
    } else {
      const patch = body.patch && typeof body.patch === "object" ? body.patch : {};
      const allowed = ["text", "html", "src", "href", "alt", "style", "class", "title"];
      const next = { ...(pageOverrides[selector] || {}) };
      for (const key of allowed) {
        if (Object.prototype.hasOwnProperty.call(patch, key)) next[key] = String(patch[key] ?? "");
      }
      pageOverrides[selector] = next;
    }

    site.overrides[page] = pageOverrides;
    await saveSiteContent(site);
    return json({ ok: true, overrides: pageOverrides });
  }

  if (route === "content" && method === "DELETE") {
    if (!requireAdmin(request)) return unauthorized();
    const body = await readJson(request);
    const page = normalizePath(body.path);
    const site = await getSiteContent();

    if (body.sectionId) {
      site.sections = site.sections.filter((item) => item.id !== body.sectionId);
    } else if (body.selector && site.overrides[page]) {
      delete site.overrides[page][body.selector];
      if (Object.keys(site.overrides[page]).length === 0) delete site.overrides[page];
    } else {
      return error("No se indicó qué eliminar.", 400);
    }

    await saveSiteContent(site);
    return json({ ok: true });
  }

  if (route === "content/reset" && method === "POST") {
    if (!requireAdmin(request)) return unauthorized();
    const body = await readJson(request);
    const site = await getSiteContent();

    if (body.path) {
      const page = normalizePath(body.path);
      delete site.overrides[page];
      site.sections = site.sections.filter((section) => normalizePath(section.path) !== page);
    } else {
      site.overrides = {};
      site.sections = [];
    }

    await saveSiteContent(site);
    return json({ ok: true });
  }

  if (route === "content/all" && method === "GET") {
    if (!requireAdmin(request)) return unauthorized();
    return json({ ok: true, ...(await getSiteContent()) });
  }

  // --- Marca (CREATIVOX) ---------------------------------------------------
  if (route === "branding" && method === "GET") {
    return json({ ok: true, branding: await getBranding() });
  }

  if (route === "branding" && method === "POST") {
    if (!requireAdmin(request)) return unauthorized();
    const body = await readJson(request);
    const current = await getBranding();
    const branding = {
      ...current,
      siteName: String(body.siteName || current.siteName),
      tagline: String(body.tagline || current.tagline),
      logoUrl: String(body.logoUrl || ""),
      logoText: String(body.logoText || current.siteName),
      primary: String(body.primary || current.primary),
      primary2: String(body.primary2 || current.primary2),
      accent: String(body.accent || current.accent),
      email: String(body.email || current.email),
      updatedAt: new Date().toISOString(),
    };
    await writeJSON(contentStore(), "branding", branding);
    return json({ ok: true, branding });
  }

  // --- Productos digitales -------------------------------------------------
  if (route === "products" && method === "GET") {
    const products = await getProducts();
    const includeAll = url.searchParams.get("all") === "1" && requireAdmin(request);
    const list = includeAll ? products : products.filter((item) => !item.draft);
    return json({
      ok: true,
      products: [...list].sort((a, b) => Number(a.order || 0) - Number(b.order || 0)),
      branding: await getBranding(),
    });
  }

  if (route === "products" && method === "POST") {
    if (!requireAdmin(request)) return unauthorized();
    const body = await readJson(request);
    const products = await getProducts();
    const slug = slugify(body.slug || body.title, "producto");
    if (!body.title) return error("El producto necesita un título.", 400);

    const price = Number(body.price || 0) || 0;
    const product = {
      slug,
      title: String(body.title),
      tagline: String(body.tagline || ""),
      description: String(body.description || ""),
      category: String(body.category || "Software"),
      price,
      priceLabel: String(body.priceLabel || (price > 0 ? `$${price}` : "Gratis")),
      image: String(body.image || ""),
      logo: String(body.logo || ""),
      trailer: String(body.trailer || ""),
      gallery: Array.isArray(body.gallery) ? body.gallery.map(String) : textList(body.gallery),
      saleDetails: textList(body.saleDetails),
      functionalities: textList(body.functionalities),
      tags: Array.isArray(body.tags) ? body.tags.map(String) : textList(body.tags),
      featured: Boolean(body.featured),
      draft: Boolean(body.draft),
      requiresAccount: body.requiresAccount !== false,
      publicDownload: Boolean(body.publicDownload),
      fileKey: String(body.fileKey || ""),
      fileUrl: String(body.fileUrl || ""),
      order: Number(body.order || 0),
      updatedAt: new Date().toISOString(),
    };

    const index = products.findIndex((item) => item.slug === slug);
    if (index >= 0) products[index] = { ...products[index], ...product };
    else products.push({ createdAt: new Date().toISOString(), ...product });

    await writeJSON(contentStore(), "products", products);
    return json({ ok: true, product });
  }

  if (route === "products" && method === "DELETE") {
    if (!requireAdmin(request)) return unauthorized();
    const body = await readJson(request);
    const slug = String(body.slug || "");
    if (!slug) return error("Falta el slug.", 400);
    const products = await getProducts();
    await writeJSON(
      contentStore(),
      "products",
      products.filter((item) => item.slug !== slug),
    );
    return json({ ok: true });
  }

  if (route === "product/file" && method === "GET") {
    const slug = String(url.searchParams.get("slug") || "");
    const key = String(url.searchParams.get("key") || "");
    if (!slug || !key) return error("Faltan datos del archivo.", 400);

    const product = (await getProducts()).find((item) => item.slug === slug);
    if (!product) return error("Producto no encontrado.", 404);

    if (product.requiresAccount && !product.publicDownload) {
      const secret = getSessionSecret();
      const user = secret ? await getUserFromRequest(request, secret) : null;
      if (!user) return error("Inicia sesión para descargar este producto.", 401);
      if (!user.products.includes(slug) && user.role !== "admin") {
        return error("Tu cuenta no tiene acceso a este producto.", 403);
      }
    }

    return streamMedia(key);
  }

  // --- Cuentas de clientes -------------------------------------------------
  if (route === "account/session" && method === "GET") {
    const secret = getSessionSecret();
    const user = secret ? await getUserFromRequest(request, secret) : null;
    if (!user) return json({ ok: false, user: null });
    const products = await getProducts();
    const available = products.filter(
      (item) => !item.draft && user.products.includes(item.slug),
    );
    return json({ ok: true, user, products: available });
  }

  if (route === "account/register" && method === "POST") {
    const secret = getSessionSecret();
    if (!secret) return error("Falta configurar SESSION_SECRET en Netlify.", 500);
    const body = await readJson(request);
    const email = String(body.email || "").trim().toLowerCase();
    const password = String(body.password || "");
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return error("Escribe un email válido.", 400);
    if (password.length < 6) return error("La contraseña debe tener al menos 6 caracteres.", 400);
    if (await findUserByEmail(email)) return error("Ya existe una cuenta con ese email.", 409);

    const users = await getUsers();
    const user = {
      id: crypto.randomUUID(),
      email,
      name: String(body.name || ""),
      passwordHash: hashPassword(password),
      products: [],
      role: "cliente",
      active: true,
      createdAt: new Date().toISOString(),
    };
    users.push(user);
    await saveUsers(users);

    const { token, maxAge } = issueUserSession(user.id, secret);
    return json({ ok: true, user: publicUser(user) }, 200, {
      "set-cookie": userSessionCookie(token, { secure: isSecureRequest(request), maxAge }),
    });
  }

  if (route === "account/login" && method === "POST") {
    const secret = getSessionSecret();
    if (!secret) return error("Falta configurar SESSION_SECRET en Netlify.", 500);
    const body = await readJson(request);
    const email = String(body.email || "").trim().toLowerCase();
    const user = await findUserByEmail(email);
    if (!user || user.active === false) return error("Email o contraseña incorrectos.", 401);
    if (!verifyPassword(String(body.password || ""), user.passwordHash)) {
      return error("Email o contraseña incorrectos.", 401);
    }

    const { token, maxAge } = issueUserSession(user.id, secret);
    return json({ ok: true, user: publicUser(user) }, 200, {
      "set-cookie": userSessionCookie(token, { secure: isSecureRequest(request), maxAge }),
    });
  }

  if (route === "account/logout" && method === "POST") {
    return json({ ok: true }, 200, {
      "set-cookie": clearUserSessionCookie({ secure: isSecureRequest(request) }),
    });
  }

  // --- Usuarios (admin) ----------------------------------------------------
  if (route === "admin/users" && method === "GET") {
    if (!requireAdmin(request)) return unauthorized();
    const products = await getProducts();
    const users = await getUsers().then((list) => list.map(publicUser));
    return json({ ok: true, users, products });
  }

  if (route === "admin/users" && method === "POST") {
    if (!requireAdmin(request)) return unauthorized();
    const body = await readJson(request);
    const email = String(body.email || "").trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return error("Escribe un email válido.", 400);

    const users = await getUsers();
    let user = users.find((item) => String(item.email || "").toLowerCase() === email);
    if (!user) {
      const password = String(body.password || "");
      if (password.length < 6) return error("La contraseña debe tener al menos 6 caracteres.", 400);
      user = {
        id: crypto.randomUUID(),
        email,
        createdAt: new Date().toISOString(),
      };
      users.push(user);
    }

    user.name = String(body.name || user.name || "");
    user.products = Array.isArray(body.products) ? body.products.map(String) : [];
    user.role = body.role === "admin" ? "admin" : "cliente";
    user.active = body.active !== false;
    if (body.password) {
      const password = String(body.password);
      if (password.length < 6) return error("La contraseña debe tener al menos 6 caracteres.", 400);
      user.passwordHash = hashPassword(password);
    }
    if (!user.passwordHash) user.passwordHash = hashPassword(crypto.randomUUID());

    await saveUsers(users);
    return json({ ok: true, user: publicUser(user) });
  }

  if (route === "admin/users" && method === "DELETE") {
    if (!requireAdmin(request)) return unauthorized();
    const body = await readJson(request);
    const id = String(body.id || "");
    if (!id) return error("Falta el id del usuario.", 400);
    const users = await getUsers();
    await saveUsers(users.filter((item) => item.id !== id));
    return json({ ok: true });
  }

  // --- Recursos (PROLYRICS) ------------------------------------------------
  if (route === "resources" && method === "GET") {
    const resources = await getResources();
    return json({ ok: true, resources: resources.filter((item) => !item.draft) });
  }

  if (route === "resources" && method === "POST") {
    if (!requireAdmin(request)) return unauthorized();
    const body = await readJson(request);
    const resources = await getResources();
    const slug = slugify(body.slug || body.title, "recurso");
    if (!body.title) return error("El recurso necesita un título.", 400);

    const resource = {
      slug,
      title: String(body.title),
      description: String(body.description || ""),
      category: ["Plantillas", "Fondos", "Canciones", "Videos", "Iconos"].includes(body.category)
        ? body.category
        : "Plantillas",
      format: String(body.format || "SVG"),
      image: String(body.image || "/uploads/resources/default.svg"),
      fileUrl: String(body.fileUrl || "#"),
      premium: Boolean(body.premium),
      featured: Boolean(body.featured),
      tags: Array.isArray(body.tags)
        ? body.tags.map(String)
        : String(body.tags || "")
            .split(",")
            .map((tag) => tag.trim())
            .filter(Boolean),
      order: Number(body.order || 0),
      draft: Boolean(body.draft),
      body: String(body.body || ""),
    };

    const index = resources.findIndex((item) => item.slug === slug);
    if (index >= 0) resources[index] = { ...resources[index], ...resource };
    else resources.push(resource);

    await writeJSON(contentStore(), "resources", resources);
    return json({ ok: true, resource });
  }

  if (route === "resources" && method === "DELETE") {
    if (!requireAdmin(request)) return unauthorized();
    const body = await readJson(request);
    const slug = String(body.slug || "");
    if (!slug) return error("Falta el slug.", 400);
    const resources = await getResources();
    await writeJSON(
      contentStore(),
      "resources",
      resources.filter((item) => item.slug !== slug),
    );
    return json({ ok: true });
  }

  // --- Medios --------------------------------------------------------------
  if (route === "admin/media" && method === "GET") {
    if (!requireAdmin(request)) return unauthorized();
    return json({ ok: true, items: await getMediaItems(), maxFileBytes: MAX_FILE_BYTES });
  }

  if (route === "admin/media/status" && method === "GET") {
    if (!requireAdmin(request)) return unauthorized();
    const uploadId = String(url.searchParams.get("uploadId") || "");
    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(uploadId)) return error("ID de subida no válido.", 400);
    const { blobs } = await chunkStore().list({ prefix: `${uploadId}/` });
    const indexes = blobs
      .map(({ key }) => Number(key.split("/").pop()))
      .filter((value) => Number.isInteger(value));
    return json({ ok: true, indexes });
  }

  if (route === "admin/media/chunk" && method === "POST") {
    if (!requireAdmin(request)) return unauthorized();

    const uploadId = String(request.headers.get("x-upload-id") || "");
    const index = Number(request.headers.get("x-chunk-index"));
    const total = Number(request.headers.get("x-chunk-total"));

    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(uploadId)) return error("ID de subida no válido.", 400);
    if (
      !Number.isInteger(index) ||
      !Number.isInteger(total) ||
      index < 0 ||
      total < 1 ||
      index >= total
    ) {
      return error("Fragmento no válido.", 400);
    }

    const data = await request.arrayBuffer();
    if (data.byteLength > MAX_CHUNK_BYTES) return error("El fragmento es demasiado grande.", 413);

    await chunkStore().set(`${uploadId}/${String(index).padStart(6, "0")}`, data);
    return json({ ok: true, index, received: data.byteLength });
  }

  if (route === "admin/media/finalize" && method === "POST") {
    if (!requireAdmin(request)) return unauthorized();
    const body = await readJson(request);
    const uploadId = String(body.uploadId || "");
    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(uploadId)) return error("ID de subida no válido.", 400);

    const prefix = `${uploadId}/`;
    const { blobs } = await chunkStore().list({ prefix });
    if (blobs.length === 0) return error("No se recibieron fragmentos.", 400);

    const parts = [];
    for (const { key } of blobs.sort((a, b) => a.key.localeCompare(b.key))) {
      const part = await chunkStore().get(key, { type: "arrayBuffer", consistency: "strong" });
      if (part) parts.push(Buffer.from(part));
    }

    const fileBuffer = Buffer.concat(parts);
    if (fileBuffer.byteLength > MAX_FILE_BYTES) {
      await Promise.all(blobs.map(({ key }) => chunkStore().delete(key)));
      return error("El archivo supera el límite de 4.5 GB.", 413);
    }

    const name = safeFileName(body.name, "archivo");
    const type = String(body.type || contentTypeFor(name));
    const id = crypto.randomUUID();
    const key = `${id}/${name}`;
    const uploadedAt = new Date().toISOString();

    await mediaStore().set(key, new Blob([fileBuffer], { type }), {
      metadata: {
        name,
        type,
        size: fileBuffer.byteLength,
        alt: String(body.alt || ""),
        folder: String(body.folder || ""),
        uploadedAt,
      },
    });

    await Promise.all(blobs.map(({ key: chunkKey }) => chunkStore().delete(chunkKey)));

    return json({
      ok: true,
      item: {
        key,
        name,
        type,
        size: fileBuffer.byteLength,
        alt: String(body.alt || ""),
        folder: String(body.folder || ""),
        uploadedAt,
        url: `/api/media?key=${encodeURIComponent(key)}`,
      },
    });
  }

  if (route === "admin/media" && method === "DELETE") {
    if (!requireAdmin(request)) return unauthorized();
    const body = await readJson(request);
    const key = String(body.key || "");
    if (!key) return error("Falta la clave del archivo.", 400);
    await mediaStore().delete(key);
    return json({ ok: true });
  }

  if (route === "media" && method === "GET") {
    const key = String(url.searchParams.get("key") || "");
    if (!key) return error("Falta la clave del archivo.", 400);
    return streamMedia(key);
  }

  return error(`Ruta no encontrada: ${route || "/"}`, 404);
}
