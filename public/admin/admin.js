(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  let selection = null;
  let resources = [];
  let products = [];
  let users = [];
  let mediaItems = [];
  let mediaPickTarget = null;
  const MAX_FILE_BYTES = Math.floor(4.5 * 1024 * 1024 * 1024);

  async function api(url, options = {}) {
    const response = await fetch(url, options);
    let data = {};
    try {
      data = await response.json();
    } catch {
      data = {};
    }
    if (!response.ok) throw new Error(data.error || `Error ${response.status}`);
    return data;
  }

  function toast(message, isError = false) {
    const node = $("toast");
    node.textContent = message;
    node.classList.toggle("is-error", isError);
    node.classList.add("is-visible");
    clearTimeout(toast.timer);
    toast.timer = setTimeout(() => node.classList.remove("is-visible"), 3500);
  }

  function esc(value) {
    return String(value ?? "").replace(/[&<>"']/g, (char) => ({
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;",
    })[char]);
  }

  function formatSize(bytes) {
    const size = Number(bytes || 0);
    if (size < 1024) return `${size} B`;
    if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
    if (size < 1024 * 1024 * 1024) return `${(size / 1024 / 1024).toFixed(1)} MB`;
    return `${(size / 1024 / 1024 / 1024).toFixed(2)} GB`;
  }

  function showDashboard() {
    $("login-view").hidden = true;
    $("dashboard").hidden = false;
    loadChanges();
    loadProducts();
    loadUsers();
    loadBranding();
    loadResources();
    loadMedia();
  }

  function activateTab(name) {
    document.querySelectorAll(".tab").forEach((tab) => {
      tab.classList.toggle("is-active", tab.dataset.tab === name);
    });
    document.querySelectorAll(".tab-panel").forEach((panel) => {
      panel.classList.toggle("is-active", panel.dataset.panel === name);
    });
    if (name === "visual") loadChanges();
    if (name === "productos") loadProducts();
    if (name === "usuarios") loadUsers();
    if (name === "marca") loadBranding();
    if (name === "recursos") loadResources();
    if (name === "medios") loadMedia();
  }

  function framePath() {
    try {
      return new URL($("site-frame").contentWindow.location.href).pathname;
    } catch {
      return "/";
    }
  }

  function reloadFrame() {
    $("site-frame").src = `/?edit=1&_=${Date.now()}`;
  }

  // --- Editor visual -------------------------------------------------------
  function populateSelection(element) {
    selection = element;
    $("selection-hint").textContent = "";
    $("selection-form").hidden = false;
    $("selected-selector").textContent = `${element.path} · ${element.selector}`;
    $("edit-mode").value = element.html && !element.text ? "html" : "text";
    $("edit-text").value = element.text || "";
    $("edit-html").value = element.html || "";
    $("edit-src").value = element.src || "";
    $("edit-href").value = element.href || "";
    $("edit-alt").value = element.alt || "";
    $("edit-class").value = element.class || "";
    $("edit-style").value = element.style || "";
    $("section-selector").value = element.selector || "";
    updateModeFields();
  }

  function updateModeFields() {
    const isHtml = $("edit-mode").value === "html";
    $("field-text").hidden = isHtml;
    $("field-html").hidden = !isHtml;
  }

  function readSelectionForm() {
    return {
      mode: $("edit-mode").value,
      text: $("edit-text").value,
      html: $("edit-html").value,
      src: $("edit-src").value,
      href: $("edit-href").value,
      alt: $("edit-alt").value,
      class: $("edit-class").value,
      style: $("edit-style").value,
    };
  }

  async function saveSelection() {
    if (!selection) return toast("Selecciona un elemento primero.", true);
    const form = readSelectionForm();
    const patch = form.mode === "html" ? { html: form.html } : { text: form.text };
    ["src", "href", "alt", "class", "style"].forEach((key) => {
      if (form[key]) patch[key] = form[key];
    });

    try {
      await api("/api/content", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: selection.path, selector: selection.selector, patch }),
      });
      toast("Cambio guardado en la nube.");
      reloadFrame();
      loadChanges();
    } catch (error) {
      toast(error.message, true);
    }
  }

  async function deleteSelection() {
    if (!selection) return;
    if (!window.confirm("¿Restaurar este elemento a su contenido original?")) return;
    try {
      await api("/api/content", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: selection.path, selector: selection.selector }),
      });
      toast("Cambio eliminado.");
      reloadFrame();
      loadChanges();
    } catch (error) {
      toast(error.message, true);
    }
  }

  async function saveSection() {
    const html = $("section-html").value.trim();
    if (!html) return toast("Escribe el HTML de la sección.", true);
    try {
      await api("/api/content", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          path: selection ? selection.path : framePath(),
          section: {
            id: crypto.randomUUID ? crypto.randomUUID() : undefined,
            position: $("section-position").value,
            selector: $("section-selector").value.trim(),
            html,
            enabled: true,
          },
        }),
      });
      $("section-html").value = "";
      toast("Sección añadida.");
      reloadFrame();
      loadChanges();
    } catch (error) {
      toast(error.message, true);
    }
  }

  async function loadChanges() {
    try {
      const data = await api("/api/content/all");
      const overrides = Object.entries(data.overrides || {});
      const sections = data.sections || [];
      const total = overrides.reduce((sum, [, patches]) => sum + Object.keys(patches).length, 0) + sections.length;

      if (total === 0) {
        $("changes-list").innerHTML = '<p class="muted">Todavía no hay cambios guardados.</p>';
        return;
      }

      const items = [];
      overrides.forEach(([page, patches]) => {
        Object.entries(patches).forEach(([selector]) => {
          items.push({ page, label: selector, type: "override", selector });
        });
      });
      sections.forEach((section) => {
        items.push({ page: section.path, label: `Sección ${section.id.slice(0, 8)}`, type: "section", id: section.id });
      });

      $("changes-list").innerHTML = items
        .map(
          (item) => `
            <div class="change-item">
              <div>
                <code>${esc(item.label)}</code>
                <div class="media-meta">${esc(item.page)}</div>
              </div>
              <div class="inline-actions">
                <button class="btn btn-ghost btn-small" data-view-page="${esc(item.page)}" type="button">Ver</button>
                <button class="btn btn-danger btn-small" data-delete-${item.type}="${esc(item.id || item.selector)}" data-page="${esc(item.page)}" type="button">Quitar</button>
              </div>
            </div>`,
        )
        .join("");

      $("changes-list").querySelectorAll("[data-view-page]").forEach((button) => {
        button.addEventListener("click", () => {
          $("site-frame").src = `${button.dataset.viewPage}?edit=1&_=${Date.now()}`;
        });
      });

      $("changes-list").querySelectorAll("[data-delete-override]").forEach((button) => {
        button.addEventListener("click", () => removeChange({ path: button.dataset.page, selector: button.dataset.deleteOverride }));
      });

      $("changes-list").querySelectorAll("[data-delete-section]").forEach((button) => {
        button.addEventListener("click", () => removeChange({ path: button.dataset.page, sectionId: button.dataset.deleteSection }));
      });
    } catch (error) {
      toast(error.message, true);
    }
  }

  async function removeChange(payload) {
    try {
      await api("/api/content", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      toast("Cambio eliminado.");
      reloadFrame();
      loadChanges();
    } catch (error) {
      toast(error.message, true);
    }
  }

  // --- Productos -----------------------------------------------------------
  function resetProductForm() {
    $("product-form").reset();
    $("product-original-slug").value = "";
    $("product-price").value = "0";
    $("product-order").value = "0";
    $("product-requires").checked = true;
  }

  function linesToTextarea(value) {
    return Array.isArray(value) ? value.join("\n") : String(value || "");
  }

  async function loadProducts() {
    try {
      const data = await api("/api/products?all=1");
      products = data.products || [];
      if (!products.length) {
        $("products-list").innerHTML = '<p class="muted">No hay productos todavía.</p>';
        return;
      }
      $("products-list").innerHTML = products
        .map(
          (item) => `
            <div class="resource-row">
              <img src="${esc(item.logo || item.image || "/og-image.png")}" alt="" loading="lazy" />
              <div>
                <strong>${esc(item.title)}</strong>
                <span>${esc(item.category || "Producto")} · ${esc(item.priceLabel || "Gratis")}${item.draft ? " · Borrador" : ""}${item.requiresAccount ? " · Con cuenta" : ""}</span>
              </div>
              <div class="resource-actions">
                <button class="btn btn-ghost btn-small" data-edit-product="${esc(item.slug)}" type="button">Editar</button>
                <button class="btn btn-danger btn-small" data-delete-product="${esc(item.slug)}" type="button">✕</button>
              </div>
            </div>`,
        )
        .join("");

      $("products-list").querySelectorAll("[data-edit-product]").forEach((button) => {
        button.addEventListener("click", () => editProduct(button.dataset.editProduct));
      });
      $("products-list").querySelectorAll("[data-delete-product]").forEach((button) => {
        button.addEventListener("click", () => deleteProduct(button.dataset.deleteProduct));
      });
    } catch (error) {
      toast(error.message, true);
    }
  }

  function editProduct(slug) {
    const item = products.find((product) => product.slug === slug);
    if (!item) return;
    $("product-original-slug").value = item.slug;
    $("product-title").value = item.title || "";
    $("product-slug").value = item.slug || "";
    $("product-tagline").value = item.tagline || "";
    $("product-category").value = item.category || "Software";
    $("product-price").value = item.price || 0;
    $("product-price-label").value = item.priceLabel || "";
    $("product-description").value = item.description || "";
    $("product-image").value = item.image || "";
    $("product-logo").value = item.logo || "";
    $("product-trailer").value = item.trailer || "";
    $("product-gallery").value = linesToTextarea(item.gallery);
    $("product-sale-details").value = linesToTextarea(item.saleDetails);
    $("product-functionalities").value = linesToTextarea(item.functionalities);
    $("product-tags").value = (item.tags || []).join(", ");
    $("product-file-key").value = item.fileKey || "";
    $("product-file-url").value = item.fileUrl || "";
    $("product-order").value = item.order || 0;
    $("product-featured").checked = Boolean(item.featured);
    $("product-draft").checked = Boolean(item.draft);
    $("product-requires").checked = item.requiresAccount !== false;
    $("product-public").checked = Boolean(item.publicDownload);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function deleteProduct(slug) {
    if (!window.confirm("¿Eliminar este producto del catálogo?")) return;
    try {
      await api("/api/products", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug }),
      });
      toast("Producto eliminado.");
      if ($("product-original-slug").value === slug) resetProductForm();
      loadProducts();
    } catch (error) {
      toast(error.message, true);
    }
  }

  async function saveProduct(event) {
    event.preventDefault();
    const payload = {
      title: $("product-title").value.trim(),
      slug: $("product-slug").value.trim(),
      tagline: $("product-tagline").value.trim(),
      category: $("product-category").value,
      price: Number($("product-price").value || 0),
      priceLabel: $("product-price-label").value.trim(),
      description: $("product-description").value.trim(),
      image: $("product-image").value.trim(),
      logo: $("product-logo").value.trim(),
      trailer: $("product-trailer").value.trim(),
      gallery: $("product-gallery").value,
      saleDetails: $("product-sale-details").value,
      functionalities: $("product-functionalities").value,
      tags: $("product-tags").value,
      fileKey: $("product-file-key").value.trim(),
      fileUrl: $("product-file-url").value.trim(),
      order: Number($("product-order").value || 0),
      featured: $("product-featured").checked,
      draft: $("product-draft").checked,
      requiresAccount: $("product-requires").checked,
      publicDownload: $("product-public").checked,
    };

    try {
      const original = $("product-original-slug").value.trim();
      if (original && original !== payload.slug) {
        await api("/api/products", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ slug: original }),
        });
      }
      const result = await api("/api/products", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      $("product-original-slug").value = result.product.slug;
      $("product-slug").value = result.product.slug;
      toast("Producto guardado.");
      loadProducts();
    } catch (error) {
      toast(error.message, true);
    }
  }

  // --- Usuarios ------------------------------------------------------------
  function renderUserProducts() {
    if (!products.length) {
      $("user-products").innerHTML = '<p class="muted">No hay productos disponibles.</p>';
      return;
    }
    $("user-products").innerHTML = products
      .map(
        (item) => `
          <label class="check">
            <input type="checkbox" class="user-product" value="${esc(item.slug)}" />
            ${esc(item.title)}
          </label>`,
      )
      .join("");
  }

  async function loadUsers() {
    try {
      const data = await api("/api/admin/users");
      users = data.users || [];
      products = data.products || products;
      renderUserProducts();

      if (!users.length) {
        $("users-list").innerHTML = '<p class="muted">No hay usuarios todavía.</p>';
        return;
      }
      $("users-list").innerHTML = users
        .map(
          (item) => `
            <div class="resource-row">
              <div class="user-avatar">${esc((item.name || item.email || "?").slice(0, 1).toUpperCase())}</div>
              <div>
                <strong>${esc(item.name || item.email)}</strong>
                <span>${esc(item.email)} · ${(item.products || []).length} producto(s)${item.active === false ? " · Inactivo" : ""}</span>
              </div>
              <div class="resource-actions">
                <button class="btn btn-ghost btn-small" data-edit-user="${esc(item.id)}" type="button">Editar</button>
                <button class="btn btn-danger btn-small" data-delete-user="${esc(item.id)}" type="button">✕</button>
              </div>
            </div>`,
        )
        .join("");

      $("users-list").querySelectorAll("[data-edit-user]").forEach((button) => {
        button.addEventListener("click", () => editUser(button.dataset.editUser));
      });
      $("users-list").querySelectorAll("[data-delete-user]").forEach((button) => {
        button.addEventListener("click", () => deleteUser(button.dataset.deleteUser));
      });
    } catch (error) {
      toast(error.message, true);
    }
  }

  function resetUserForm() {
    $("user-form").reset();
    $("user-id").value = "";
    $("user-active").checked = true;
    document.querySelectorAll(".user-product").forEach((box) => { box.checked = false; });
  }

  function editUser(id) {
    const item = users.find((user) => user.id === id);
    if (!item) return;
    $("user-id").value = item.id;
    $("user-email").value = item.email || "";
    $("user-name").value = item.name || "";
    $("user-password").value = "";
    $("user-role").value = item.role || "cliente";
    $("user-active").checked = item.active !== false;
    document.querySelectorAll(".user-product").forEach((box) => {
      box.checked = (item.products || []).includes(box.value);
    });
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function deleteUser(id) {
    if (!window.confirm("¿Eliminar este usuario?")) return;
    try {
      await api("/api/admin/users", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      toast("Usuario eliminado.");
      if ($("user-id").value === id) resetUserForm();
      loadUsers();
    } catch (error) {
      toast(error.message, true);
    }
  }

  async function saveUser(event) {
    event.preventDefault();
    const payload = {
      id: $("user-id").value,
      email: $("user-email").value.trim(),
      name: $("user-name").value.trim(),
      password: $("user-password").value,
      role: $("user-role").value,
      active: $("user-active").checked,
      products: Array.from(document.querySelectorAll(".user-product:checked")).map((box) => box.value),
    };
    try {
      const result = await api("/api/admin/users", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      $("user-id").value = result.user.id;
      $("user-password").value = "";
      toast("Usuario guardado con sus accesos.");
      loadUsers();
    } catch (error) {
      toast(error.message, true);
    }
  }

  // --- Marca ---------------------------------------------------------------
  async function loadBranding() {
    try {
      const data = await api("/api/branding");
      const brand = data.branding || {};
      $("brand-site-name").value = brand.siteName || "CREATIVOX";
      $("brand-tagline").value = brand.tagline || "";
      $("brand-logo-url").value = brand.logoUrl || "";
      $("brand-primary").value = brand.primary || "#2900ff";
      $("brand-primary-2").value = brand.primary2 || "#5b21b6";
      $("brand-accent").value = brand.accent || "#c4b5fd";
      $("brand-email").value = brand.email || "";
      updateBrandPreview();
    } catch (error) {
      toast(error.message, true);
    }
  }

  function updateBrandPreview() {
    if ($("brand-preview-name")) $("brand-preview-name").textContent = $("brand-site-name").value || "CREATIVOX";
    if ($("brand-preview-tagline")) $("brand-preview-tagline").textContent = $("brand-tagline").value || "";
    const mark = document.querySelector(".brand-preview-mark");
    if (mark) {
      mark.style.background = `linear-gradient(135deg, ${$("brand-primary").value}, ${$("brand-primary-2").value})`;
    }
    const preview = $("brand-preview");
    if (preview) preview.style.borderColor = $("brand-accent").value;
  }

  async function saveBranding(event) {
    event.preventDefault();
    const payload = {
      siteName: $("brand-site-name").value.trim(),
      tagline: $("brand-tagline").value.trim(),
      logoUrl: $("brand-logo-url").value.trim(),
      primary: $("brand-primary").value,
      primary2: $("brand-primary-2").value,
      accent: $("brand-accent").value,
      email: $("brand-email").value.trim(),
    };
    try {
      await api("/api/branding", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      toast("Marca guardada. Recarga el sitio público para ver los cambios.");
    } catch (error) {
      toast(error.message, true);
    }
  }

  // --- Recursos ------------------------------------------------------------
  function resetResourceForm() {
    $("resource-form").reset();
    $("resource-original-slug").value = "";
    $("resource-format").value = "SVG";
    $("resource-order").value = "0";
  }

  async function loadResources() {
    try {
      const data = await api("/api/resources");
      resources = data.resources || [];
      if (resources.length === 0) {
        $("resources-list").innerHTML = '<p class="muted">No hay recursos todavía.</p>';
        return;
      }
      $("resources-list").innerHTML = resources
        .map(
          (item) => `
            <div class="resource-row">
              <img src="${esc(item.image)}" alt="" loading="lazy" />
              <div>
                <strong>${esc(item.title)}</strong>
                <span>${esc(item.category)} · ${esc(item.format)} · ${item.premium ? "PRO" : "Gratis"}${item.draft ? " · Borrador" : ""}</span>
              </div>
              <div class="resource-actions">
                <button class="btn btn-ghost btn-small" data-edit-resource="${esc(item.slug)}" type="button">Editar</button>
                <button class="btn btn-danger btn-small" data-delete-resource="${esc(item.slug)}" type="button">✕</button>
              </div>
            </div>`,
        )
        .join("");

      $("resources-list").querySelectorAll("[data-edit-resource]").forEach((button) => {
        button.addEventListener("click", () => editResource(button.dataset.editResource));
      });
      $("resources-list").querySelectorAll("[data-delete-resource]").forEach((button) => {
        button.addEventListener("click", () => deleteResource(button.dataset.deleteResource));
      });
    } catch (error) {
      toast(error.message, true);
    }
  }

  function editResource(slug) {
    const item = resources.find((resource) => resource.slug === slug);
    if (!item) return;
    $("resource-original-slug").value = item.slug;
    $("resource-title").value = item.title || "";
    $("resource-slug").value = item.slug || "";
    $("resource-category").value = item.category || "Plantillas";
    $("resource-format").value = item.format || "SVG";
    $("resource-description").value = item.description || "";
    $("resource-image").value = item.image || "";
    $("resource-file").value = item.fileUrl || "";
    $("resource-tags").value = (item.tags || []).join(", ");
    $("resource-order").value = item.order || 0;
    $("resource-body").value = item.body || "";
    $("resource-premium").checked = Boolean(item.premium);
    $("resource-featured").checked = Boolean(item.featured);
    $("resource-draft").checked = Boolean(item.draft);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  async function deleteResource(slug) {
    if (!window.confirm("¿Eliminar este recurso?")) return;
    try {
      await api("/api/resources", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ slug }),
      });
      toast("Recurso eliminado.");
      if ($("resource-original-slug").value === slug) resetResourceForm();
      loadResources();
    } catch (error) {
      toast(error.message, true);
    }
  }

  async function saveResource(event) {
    event.preventDefault();
    const payload = {
      title: $("resource-title").value.trim(),
      slug: $("resource-slug").value.trim(),
      category: $("resource-category").value,
      format: $("resource-format").value.trim(),
      description: $("resource-description").value.trim(),
      image: $("resource-image").value.trim(),
      fileUrl: $("resource-file").value.trim(),
      tags: $("resource-tags").value,
      order: Number($("resource-order").value || 0),
      body: $("resource-body").value.trim(),
      premium: $("resource-premium").checked,
      featured: $("resource-featured").checked,
      draft: $("resource-draft").checked,
    };

    try {
      const original = $("resource-original-slug").value.trim();
      if (original && original !== payload.slug) {
        await api("/api/resources", {
          method: "DELETE",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ slug: original }),
        });
      }
      const result = await api("/api/resources", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      $("resource-original-slug").value = result.resource.slug;
      $("resource-slug").value = result.resource.slug;
      toast("Recurso guardado.");
      loadResources();
    } catch (error) {
      toast(error.message, true);
    }
  }

  // --- Medios --------------------------------------------------------------
  function randomUploadId() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    return `u${Date.now()}${Math.random().toString(36).slice(2)}`;
  }

  function progressRow(name) {
    const row = document.createElement("div");
    row.className = "progress-row";
    row.innerHTML = `
      <div class="progress-label"><span>${esc(name)}</span><span data-percent>0%</span></div>
      <div class="progress-track"><div class="progress-bar" data-bar></div></div>
    `;
    $("upload-progress").appendChild(row);
    return {
      update(percent) {
        row.querySelector("[data-bar]").style.width = `${percent}%`;
        row.querySelector("[data-percent]").textContent = `${percent}%`;
      },
      done() {
        setTimeout(() => row.remove(), 1200);
      },
    };
  }

  function safeUploadKey(value) {
    return String(value || "").replace(/[^a-zA-Z0-9_-]/g, "_").slice(0, 80);
  }

  async function uploadChunk(uploadId, index, total, file, chunkSize) {
    const start = index * chunkSize;
    const chunk = file.slice(start, Math.min(start + chunkSize, file.size));
    await api("/api/admin/media/chunk", {
      method: "POST",
      headers: {
        "content-type": "application/octet-stream",
        "x-upload-id": uploadId,
        "x-chunk-index": String(index),
        "x-chunk-total": String(total),
      },
      body: chunk,
    });
  }

  async function uploadFile(file) {
    if (file.size > MAX_FILE_BYTES) {
      toast(`${file.name}: el archivo supera el límite de 4.5 GB.`, true);
      return false;
    }

    const chunkSize = 4 * 1024 * 1024;
    const total = Math.max(1, Math.ceil(file.size / chunkSize));
    const progress = progressRow(file.name);

    const storageKey = `creativox_upload_${safeUploadKey(file.name)}_${file.size}`;
    let uploadId = "";
    try { uploadId = window.localStorage.getItem(storageKey) || ""; } catch {}
    if (!/^[a-zA-Z0-9_-]{8,100}$/.test(uploadId)) uploadId = randomUploadId();

    try {
      window.localStorage.setItem(storageKey, uploadId);
    } catch {}

    let completed = new Set();
    try {
      const status = await api(`/api/admin/media/status?uploadId=${encodeURIComponent(uploadId)}`);
      completed = new Set(status.indexes || []);
    } catch {}

    const pending = [];
    for (let index = 0; index < total; index += 1) {
      if (!completed.has(index)) pending.push(index);
    }

    let done = completed.size;
    const update = () => progress.update(Math.round((done / total) * 92));
    update();

    try {
      const workers = [];
      for (let worker = 0; worker < 3; worker += 1) {
        workers.push(
          (async () => {
            while (pending.length) {
              const index = pending.shift();
              if (index === undefined) break;
              await uploadChunk(uploadId, index, total, file, chunkSize);
              done += 1;
              update();
            }
          })(),
        );
      }
      await Promise.all(workers);

      const result = await api("/api/admin/media/finalize", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          uploadId,
          name: file.name,
          type: file.type || "",
          folder: $("media-folder") ? $("media-folder").value.trim() : "",
          alt: $("media-alt") ? $("media-alt").value.trim() : "",
        }),
      });

      progress.update(100);
      progress.done();
      try { window.localStorage.removeItem(storageKey); } catch {}
      mediaItems.unshift(result.item);
      return true;
    } catch (error) {
      progress.done();
      toast(`${file.name}: ${error.message}. La subida se puede retomar.`, true);
      return false;
    }
  }

  async function uploadFiles(files) {
    const list = Array.from(files || []);
    if (!list.length) return;
    for (const file of list) await uploadFile(file);
    toast(`${list.length} archivo(s) procesado(s).`);
    loadMedia();
  }

  function mediaPreview(item) {
    if ((item.type || "").startsWith("image/")) {
      return `<img src="${esc(item.url)}" alt="${esc(item.alt || item.name)}" loading="lazy" />`;
    }
    if ((item.type || "").startsWith("video/")) {
      return `<video src="${esc(item.url)}" controls preload="metadata"></video>`;
    }
    return `<div class="file-icon">${esc((item.name || "?").split(".").pop() || "FILE").toUpperCase()}</div>`;
  }

  async function loadMedia() {
    try {
      const data = await api("/api/admin/media");
      mediaItems = data.items || [];
      if (mediaItems.length === 0) {
        $("media-grid").innerHTML = '<p class="muted">Todavía no has subido archivos.</p>';
        return;
      }
      $("media-grid").innerHTML = mediaItems
        .map(
          (item) => `
            <div class="media-card">
              <div class="media-preview">${mediaPreview(item)}</div>
              <div class="media-body">
                <div class="media-name" title="${esc(item.name)}">${esc(item.name)}</div>
                <div class="media-meta">${formatSize(item.size)} · ${esc((item.type || "archivo").split("/").pop())}</div>
                <div class="media-actions">
                  <button class="btn btn-ghost btn-small" data-copy-media="${esc(item.key)}" type="button">Copiar URL</button>
                  <button class="btn btn-ghost btn-small" data-use-image="${esc(item.key)}" type="button">Usar imagen</button>
                  <button class="btn btn-ghost btn-small" data-use-file="${esc(item.key)}" type="button">Usar archivo</button>
                  <button class="btn btn-danger btn-small" data-delete-media="${esc(item.key)}" type="button">✕</button>
                </div>
              </div>
            </div>`,
        )
        .join("");

      $("media-grid").querySelectorAll("[data-copy-media]").forEach((button) => {
        button.addEventListener("click", () => copyMediaUrl(button.dataset.copyMedia));
      });
      $("media-grid").querySelectorAll("[data-use-image]").forEach((button) => {
        button.addEventListener("click", () => useMedia(button.dataset.useImage, "image"));
      });
      $("media-grid").querySelectorAll("[data-use-file]").forEach((button) => {
        button.addEventListener("click", () => useMedia(button.dataset.useFile, "file"));
      });
      $("media-grid").querySelectorAll("[data-delete-media]").forEach((button) => {
        button.addEventListener("click", () => deleteMedia(button.dataset.deleteMedia));
      });
    } catch (error) {
      toast(error.message, true);
    }
  }

  function mediaByKey(key) {
    return mediaItems.find((item) => item.key === key);
  }

  async function copyMediaUrl(key) {
    const item = mediaByKey(key);
    if (!item) return;
    const url = new URL(item.url, window.location.origin).href;
    try {
      await navigator.clipboard.writeText(url);
      toast("URL copiada al portapapeles.");
    } catch {
      window.prompt("Copia esta URL:", url);
    }
  }

  function tabForTarget(target) {
    if (!target) return "recursos";
    if (target.startsWith("product-")) return "productos";
    if (target.startsWith("brand-")) return "marca";
    return "recursos";
  }

  function useMedia(key, kind) {
    const item = mediaByKey(key);
    if (!item) return;
    const url = new URL(item.url, window.location.origin).href;

    if (mediaPickTarget && $(mediaPickTarget)) {
      $(mediaPickTarget).value = url;
      const target = mediaPickTarget;
      mediaPickTarget = null;
      activateTab(tabForTarget(target));
      toast("URL aplicada al formulario.");
      return;
    }

    if (kind === "image") $("resource-image").value = url;
    else $("resource-file").value = url;
    activateTab("recursos");
    toast("URL aplicada al formulario de recursos.");
  }

  async function deleteMedia(key) {
    if (!window.confirm("¿Eliminar este archivo de la nube?")) return;
    try {
      await api("/api/admin/media", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key }),
      });
      toast("Archivo eliminado.");
      loadMedia();
    } catch (error) {
      toast(error.message, true);
    }
  }

  // --- Ajustes -------------------------------------------------------------
  async function changePassword(event) {
    event.preventDefault();
    try {
      await api("/api/admin/password", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          currentPassword: $("current-password").value,
          newPassword: $("new-password").value,
        }),
      });
      $("password-form").reset();
      toast("Clave actualizada.");
    } catch (error) {
      toast(error.message, true);
    }
  }

  async function resetContent() {
    if (!window.confirm("¿Restablecer todas las ediciones visuales de la página indicada?")) return;
    try {
      await api("/api/content/reset", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ path: $("reset-path").value.trim() }),
      });
      toast("Ediciones restablecidas.");
      reloadFrame();
      loadChanges();
    } catch (error) {
      toast(error.message, true);
    }
  }

  // --- Arranque ------------------------------------------------------------
  function bindEvents() {
    $("login-form").addEventListener("submit", async (event) => {
      event.preventDefault();
      $("login-error").textContent = "";
      const button = event.currentTarget.querySelector("button");
      button.disabled = true;
      try {
        await api("/api/admin/login", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ password: $("admin-password").value }),
        });
        showDashboard();
      } catch (error) {
        $("login-error").textContent = error.message;
      } finally {
        button.disabled = false;
      }
    });

    $("logout-button").addEventListener("click", async () => {
      try {
        await api("/api/admin/logout", { method: "POST" });
      } finally {
        window.location.reload();
      }
    });

    document.querySelectorAll(".tab").forEach((tab) => {
      tab.addEventListener("click", () => activateTab(tab.dataset.tab));
    });

    window.addEventListener("message", (event) => {
      if (event.origin !== window.location.origin) return;
      if (event.data && event.data.source === "creativox-editor" && event.data.type === "select") {
        populateSelection(event.data.element);
      }
    });

    $("edit-mode").addEventListener("change", updateModeFields);
    $("save-selection").addEventListener("click", saveSelection);
    $("delete-selection").addEventListener("click", deleteSelection);
    $("save-section").addEventListener("click", saveSection);
    $("reload-frame").addEventListener("click", reloadFrame);

    $("new-product").addEventListener("click", resetProductForm);
    $("product-form").addEventListener("submit", saveProduct);
    $("new-user").addEventListener("click", resetUserForm);
    $("user-form").addEventListener("submit", saveUser);
    $("brand-form").addEventListener("submit", saveBranding);
    [
      "brand-site-name",
      "brand-tagline",
      "brand-primary",
      "brand-primary-2",
      "brand-accent",
    ].forEach((id) => {
      $(id)?.addEventListener("input", updateBrandPreview);
    });

    document.querySelectorAll("[data-pick-target]").forEach((button) => {
      button.addEventListener("click", () => {
        mediaPickTarget = button.dataset.pickTarget;
        activateTab("medios");
        toast("Elige un archivo de la biblioteca para aplicar la URL.");
      });
    });

    $("new-resource").addEventListener("click", resetResourceForm);
    $("resource-form").addEventListener("submit", saveResource);

    const dropzone = $("dropzone");
    dropzone.addEventListener("click", () => $("media-input").click());
    $("media-input").addEventListener("change", (event) => {
      uploadFiles(event.target.files);
      event.target.value = "";
    });
    ["dragenter", "dragover"].forEach((type) => {
      dropzone.addEventListener(type, (event) => {
        event.preventDefault();
        dropzone.classList.add("is-dragging");
      });
    });
    ["dragleave", "drop"].forEach((type) => {
      dropzone.addEventListener(type, (event) => {
        event.preventDefault();
        dropzone.classList.remove("is-dragging");
      });
    });
    dropzone.addEventListener("drop", (event) => uploadFiles(event.dataTransfer.files));
    $("refresh-media").addEventListener("click", loadMedia);

    $("password-form").addEventListener("submit", changePassword);
    $("reset-content").addEventListener("click", resetContent);
  }

  async function init() {
    bindEvents();
    try {
      await api("/api/admin/session");
      showDashboard();
    } catch {
      $("login-view").hidden = false;
      $("dashboard").hidden = true;
    }
  }

  init();
})();
