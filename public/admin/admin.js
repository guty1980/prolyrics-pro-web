(function () {
  "use strict";

  const $ = (id) => document.getElementById(id);
  let selection = null;
  let resources = [];
  let heroSlides = [];
  let products = [];
  let users = [];
  let mediaItems = [];
  let mediaFolders = [];
  // Netlify Blobs lista con consistencia eventual; mantenemos los cambios recientes
  // en el cliente para que la galería no “retroceda” al recargar demasiado pronto.
  let pendingMedia = new Map();
  let activeMediaFolder = "__all__";
  let mediaPickTarget = null;
  const MAX_FILE_BYTES = Math.floor(4.5 * 1024 * 1024 * 1024);
  const DOWNLOAD_SECTIONS = [
    { id: "fondos", folder: "Fondos de pantalla" },
    { id: "videos", folder: "Videos para fondos" },
    { id: "apps", folder: "APK y apps" },
  ];

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
    loadHeroSlides();
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
    if (name === "portada") loadHeroSlides();
    if (name === "productos") loadProducts();
    if (name === "usuarios") loadUsers();
    if (name === "marca") loadBranding();
    if (name === "recursos") loadResources();
    if (name === "medios") loadMedia();
    if (name === "descargas") loadMedia();
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

  // --- Portada / carrusel --------------------------------------------------
  const heroFieldMap = {
    id: "hero-id",
    active: "hero-active",
    order: "hero-order",
    eyebrow: "hero-eyebrow",
    title: "hero-title",
    highlight: "hero-highlight",
    subtitle: "hero-subtitle",
    ctaText: "hero-cta-text",
    ctaLink: "hero-cta-link",
    secondaryCtaText: "hero-secondary-text",
    secondaryCtaLink: "hero-secondary-link",
    backgroundImage: "hero-background",
    image: "hero-image",
    imageAlt: "hero-image-alt",
    deviceMode: "hero-device-mode",
    phoneImage: "hero-phone-image",
    phoneLabel: "hero-phone-label",
    phoneBadge: "hero-phone-badge",
    previewLabel: "hero-preview-label",
    previewKicker: "hero-preview-kicker",
    previewText: "hero-preview-text",
    previewBadge: "hero-preview-badge",
    stat1Value: "hero-stat1-value",
    stat1Label: "hero-stat1-label",
    stat2Value: "hero-stat2-value",
    stat2Label: "hero-stat2-label",
    stat3Value: "hero-stat3-value",
    stat3Label: "hero-stat3-label",
  };
  const heroBooleanFields = new Set(["active"]);

  function deviceModeFrom(slide) {
    if (["both", "monitor", "phone"].includes(slide.deviceMode)) return slide.deviceMode;
    return slide.showPhone === false ? "monitor" : "both";
  }

  function readHeroForm() {
    const slide = {};
    Object.entries(heroFieldMap).forEach(([key, id]) => {
      const node = $(id);
      if (!node) return;
      if (heroBooleanFields.has(key)) slide[key] = node.checked;
      else if (key === "order") slide[key] = Number(node.value || 0);
      else slide[key] = node.value.trim();
    });
    slide.showPhone = slide.deviceMode !== "monitor";
    return slide;
  }

  function fillHeroForm(slide) {
    Object.entries(heroFieldMap).forEach(([key, id]) => {
      const node = $(id);
      if (!node) return;
      if (heroBooleanFields.has(key)) node.checked = slide[key] !== false;
      else if (key === "deviceMode") node.value = deviceModeFrom(slide);
      else node.value = slide[key] ?? "";
    });
  }

  function resetHeroForm() {
    $("hero-form")?.reset();
    if ($("hero-id")) $("hero-id").value = "";
    if ($("hero-order")) $("hero-order").value = String(heroSlides.length + 1);
    if ($("hero-active")) $("hero-active").checked = true;
    if ($("hero-device-mode")) $("hero-device-mode").value = "both";
  }

  function renderHeroList() {
    const list = $("hero-list");
    if (!list) return;
    if (!heroSlides.length) {
      list.innerHTML = '<p class="muted">No hay diapositivas. Crea una nueva o restablece la portada.</p>';
      return;
    }
    list.innerHTML = heroSlides
      .slice()
      .sort((a, b) => Number(a.order || 0) - Number(b.order || 0))
      .map((slide) => {
        const image = slide.image || slide.backgroundImage || "/og-image.png";
        return `
          <div class="resource-row">
            <img src="${esc(image)}" alt="" loading="lazy" />
            <div>
              <strong>${esc(slide.title || slide.highlight || "Diapositiva sin título")}</strong>
              <span>${esc(slide.eyebrow || "Portada")} · Orden ${Number(slide.order || 0)} ${
                slide.active === false ? "· Oculta" : "· Visible"
              }</span>
            </div>
            <div class="resource-actions">
              <button class="btn btn-ghost btn-small" type="button" data-edit-hero="${esc(slide.id)}">Editar</button>
              <button class="btn btn-danger btn-small" type="button" data-delete-hero="${esc(slide.id)}">✕</button>
            </div>
          </div>`;
      })
      .join("");

    list.querySelectorAll("[data-edit-hero]").forEach((button) => {
      button.addEventListener("click", () => {
        const slide = heroSlides.find((item) => item.id === button.dataset.editHero);
        if (slide) fillHeroForm(slide);
      });
    });
    list.querySelectorAll("[data-delete-hero]").forEach((button) => {
      button.addEventListener("click", () => deleteHeroSlide(button.dataset.deleteHero));
    });
  }

  async function loadHeroSlides() {
    try {
      const data = await api("/api/admin/hero");
      heroSlides = data.slides || [];
      renderHeroList();
    } catch (error) {
      toast(error.message, true);
    }
  }

  async function saveHeroSlide(event) {
    event.preventDefault();
    const slide = readHeroForm();
    try {
      const data = await api("/api/admin/hero", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(slide),
      });
      heroSlides = data.slides || [];
      resetHeroForm();
      renderHeroList();
      reloadFrame();
      toast("Diapositiva guardada. Recarga el sitio público para verla.");
    } catch (error) {
      toast(error.message, true);
    }
  }

  async function deleteHeroSlide(id) {
    if (!window.confirm("¿Eliminar esta diapositiva de la portada?")) return;
    try {
      const data = await api("/api/admin/hero", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ id }),
      });
      heroSlides = data.slides || [];
      if ($("hero-id") && $("hero-id").value === id) resetHeroForm();
      renderHeroList();
      reloadFrame();
      toast("Diapositiva eliminada.");
    } catch (error) {
      toast(error.message, true);
    }
  }

  async function resetHeroSlides() {
    if (!window.confirm("¿Restablecer las diapositivas originales de la portada?")) return;
    try {
      const data = await api("/api/admin/hero/reset", { method: "POST" });
      heroSlides = data.slides || [];
      resetHeroForm();
      renderHeroList();
      reloadFrame();
      toast("Portada restablecida.");
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
      renderMediaProductSelect();
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

  async function uploadFile(file, folderOverride, allowRetry = true) {
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
          chunkTotal: total,
          name: file.name,
          type: file.type || "",
          folder:
            folderOverride !== undefined
              ? folderOverride
              : $("media-folder-select")
                ? $("media-folder-select").value.trim()
                : "",
          alt: $("media-alt") ? $("media-alt").value.trim() : "",
        }),
      });

      progress.update(100);
      progress.done();
      try { window.localStorage.removeItem(storageKey); } catch {}
      const uploaded = result.item;
      mediaItems.unshift(uploaded);
      if (uploaded.folder && !mediaFolders.includes(uploaded.folder)) {
        mediaFolders.push(uploaded.folder);
        mediaFolders.sort((a, b) => a.localeCompare(b, "es"));
      }
      markPendingMedia(uploaded.key, uploaded);
      return true;
    } catch (error) {
      progress.done();
      if (allowRetry && /Faltan fragmentos/i.test(error.message)) {
        // Un intento anterior pudo dejar un ID con fragmentos ya borrados.
        try { window.localStorage.removeItem(storageKey); } catch {}
        return uploadFile(file, folderOverride, false);
      }
      toast(`${file.name}: ${error.message}. La subida se puede retomar.`, true);
      return false;
    }
  }

  async function uploadFiles(files, folderOverride) {
    const list = Array.from(files || []);
    if (!list.length) return;
    for (const file of list) {
      const ok = await uploadFile(file, folderOverride);
      if (!ok) return;
    }
    toast(`${list.length} archivo(s) subido(s).`);
    refreshMediaSoon();
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

  function renderMediaFolderSelect(keepValue) {
    const select = $("media-folder-select");
    if (!select) return;
    const current = keepValue || select.value || "";
    select.innerHTML =
      '<option value="">Sin sección</option>' +
      mediaFolders
        .map((folder) => `<option value="${esc(folder)}">${esc(folder)}</option>`)
        .join("");
    select.value = current;
  }

  function renderMediaProductSelect() {
    const select = $("media-product-select");
    if (!select) return;
    const current = select.value;
    select.innerHTML = products.length
      ? products
          .map((item) => `<option value="${esc(item.slug)}">${esc(item.title)}</option>`)
          .join("")
      : '<option value="">No hay productos</option>';
    if (current && products.some((item) => item.slug === current)) select.value = current;
  }

  function mediaCardMarkup(item) {
    const folder = String(item.folder || "");
    const folderOptions = ['<option value="">Sin sección</option>']
      .concat(
        mediaFolders
          .filter((name) => name !== folder)
          .map((name) => `<option value="${esc(name)}">${esc(name)}</option>`),
      )
      .join("");
    return `
      <div class="media-card" draggable="true" data-media-key="${esc(item.key)}">
        <div class="media-preview">${mediaPreview(item)}</div>
        <div class="media-body">
          <div class="media-name" title="${esc(item.name)}">${esc(item.name)}</div>
          <div class="media-meta">${formatSize(item.size)} · ${esc((item.type || "archivo").split("/").pop())}</div>
          <div class="media-actions">
            <button class="btn btn-ghost btn-small" data-copy-media="${esc(item.key)}" type="button">Copiar URL</button>
            <button class="btn btn-ghost btn-small" data-use-media="${esc(item.key)}" data-use-kind="${(item.type || "").startsWith("image/") ? "image" : "file"}" type="button">Usar en formulario</button>
            <button class="btn btn-ghost btn-small" data-use-cover="${esc(item.key)}" type="button">Portada</button>
            <button class="btn btn-ghost btn-small" data-use-thumb="${esc(item.key)}" type="button">Miniatura</button>
            <a class="btn btn-ghost btn-small" href="${esc(item.url)}" target="_blank" rel="noopener">Descargar</a>
            <select class="media-move" data-move-media="${esc(item.key)}" title="Mover a otra sección">${folderOptions}</select>
            <button class="btn btn-danger btn-small" data-delete-media="${esc(item.key)}" type="button">✕</button>
          </div>
        </div>
      </div>`;
  }

  function bindMediaCards(root = $("media-sections")) {
    if (!root) return;
    root.querySelectorAll("[data-copy-media]").forEach((button) => {
      button.addEventListener("click", () => copyMediaUrl(button.dataset.copyMedia));
    });
    root.querySelectorAll("[data-use-media]").forEach((button) => {
      button.addEventListener("click", () => useMedia(button.dataset.useMedia, button.dataset.useKind));
    });
    root.querySelectorAll("[data-use-cover]").forEach((button) => {
      button.addEventListener("click", () => setMediaRole(button.dataset.useCover, "image"));
    });
    root.querySelectorAll("[data-use-thumb]").forEach((button) => {
      button.addEventListener("click", () => setMediaRole(button.dataset.useThumb, "logo"));
    });
    root.querySelectorAll("[data-move-media]").forEach((select) => {
      select.addEventListener("change", () => moveMedia(select.dataset.moveMedia, select.value));
    });
    root.querySelectorAll("[data-delete-media]").forEach((button) => {
      button.addEventListener("click", () => deleteMedia(button.dataset.deleteMedia));
    });
    root.querySelectorAll(".media-card").forEach((card) => {
      card.addEventListener("dragstart", (event) => {
        event.dataTransfer.setData("text/plain", card.dataset.mediaKey || "");
        event.dataTransfer.effectAllowed = "move";
      });
    });
  }

  function renderMediaGallery() {
    const filters = $("folder-filters");
    const root = $("media-sections");
    if (!filters || !root) return;

    const groups = new Map();
    const folderNames = new Set(mediaFolders.filter(Boolean).map(String));
    mediaItems.forEach((item) => {
      const folder = String(item.folder || "");
      if (folder) folderNames.add(folder);
      else folderNames.add("");
      if (!groups.has(folder)) groups.set(folder, []);
      groups.get(folder).push(item);
    });

    const visibleFolders = Array.from(folderNames).sort((a, b) => {
      if (!a) return 1;
      if (!b) return -1;
      return a.localeCompare(b, "es");
    });
    if (activeMediaFolder !== "__all__" && activeMediaFolder !== "__none__" && !visibleFolders.includes(activeMediaFolder)) {
      activeMediaFolder = "__all__";
    }
    if (activeMediaFolder === "__none__" && !visibleFolders.includes("")) {
      activeMediaFolder = "__all__";
    }

    const countFor = (folder) => (groups.get(folder) || []).length;
    const chips = [{ key: "__all__", label: "Todos", count: mediaItems.length }];
    visibleFolders.forEach((folder) => {
      chips.push({
        key: folder || "__none__",
        label: folder || "Sin sección",
        count: countFor(folder),
      });
    });

    filters.innerHTML = chips
      .map(
        (chip) => `
          <button class="folder-chip ${activeMediaFolder === chip.key ? "is-active" : ""}" data-folder-filter="${esc(chip.key)}" type="button">
            ${esc(chip.label)} <span>${chip.count}</span>
          </button>`,
      )
      .join("");

    filters.querySelectorAll("[data-folder-filter]").forEach((button) => {
      button.addEventListener("click", () => {
        activeMediaFolder = button.dataset.folderFilter;
        renderMediaGallery();
      });
    });

    const shown =
      activeMediaFolder === "__all__"
        ? visibleFolders
        : visibleFolders.filter((folder) =>
            activeMediaFolder === "__none__" ? folder === "" : folder === activeMediaFolder,
          );

    if (visibleFolders.length === 0) {
      root.innerHTML = '<p class="muted">Todavía no has subido archivos. Usá el botón “Subir archivos” o arrastralos aquí.</p>';
      return;
    }

    root.innerHTML = shown
      .map((folder) => {
        const label = folder || "Sin sección";
        const cards = (groups.get(folder) || []).map(mediaCardMarkup).join("");
        return `
          <section class="media-section" data-section-folder="${esc(folder)}">
            <header class="media-section-head">
              <h4>${esc(label)} <span>${countFor(folder)}</span></h4>
              <div class="inline-actions">
                <button class="btn btn-ghost btn-small" data-upload-here="${esc(folder)}" type="button">Subir aquí</button>
                ${folder ? `<button class="btn btn-ghost btn-small" data-remove-folder="${esc(folder)}" type="button">Quitar sección</button>` : ""}
              </div>
            </header>
            <p class="media-section-hint">Arrastrá archivos o tarjetas aquí para guardarlos en “${esc(label)}”.</p>
            <div class="media-grid">${cards || '<p class="muted media-empty">Sin archivos en esta sección. Arrastrá archivos aquí.</p>'}</div>
          </section>`;
      })
      .join("");

    root.querySelectorAll("[data-section-folder]").forEach((section) => {
      const folder = section.dataset.sectionFolder;
      const setOver = (over) => section.classList.toggle("is-drop-target", over);
      section.addEventListener("dragenter", (event) => {
        event.preventDefault();
        setOver(true);
      });
      section.addEventListener("dragover", (event) => {
        event.preventDefault();
        event.dataTransfer.dropEffect = "copy";
        setOver(true);
      });
      section.addEventListener("dragleave", (event) => {
        if (!section.contains(event.relatedTarget)) setOver(false);
      });
      section.addEventListener("drop", (event) => {
        event.preventDefault();
        setOver(false);
        const mediaKey = event.dataTransfer.getData("text/plain");
        if (mediaKey && mediaByKey(mediaKey)) {
          moveMedia(mediaKey, folder);
        } else if (event.dataTransfer.files && event.dataTransfer.files.length) {
          uploadFiles(event.dataTransfer.files, folder);
        }
      });
    });

    root.querySelectorAll("[data-upload-here]").forEach((button) => {
      button.addEventListener("click", () => {
        const folder = button.dataset.uploadHere;
        renderMediaFolderSelect(folder);
        $("media-input").click();
      });
    });
    root.querySelectorAll("[data-remove-folder]").forEach((button) => {
      button.addEventListener("click", () => {
        const name = button.dataset.removeFolder;
        if (!window.confirm(`¿Quitar la sección “${name}”? Los archivos quedarán en “Sin sección”.`)) return;
        removeMediaFolder(name);
      });
    });

    bindMediaCards();
  }

  function downloadUrl(item) {
    const url = new URL(item.url, window.location.origin);
    url.searchParams.set("download", "1");
    return url.href;
  }

  function downloadCardMarkup(item) {
    return `
      <div class="media-card download-card" data-media-key="${esc(item.key)}">
        <div class="media-preview">${mediaPreview(item)}</div>
        <div class="media-body">
          <div class="media-name" title="${esc(item.name)}">${esc(item.name)}</div>
          <div class="media-meta">${formatSize(item.size)} · ${esc((item.type || "archivo").split("/").pop())}</div>
          <div class="media-actions">
            <button class="btn btn-ghost btn-small" data-copy-download="${esc(item.key)}" type="button">Copiar URL</button>
            <a class="btn btn-primary btn-small" href="${esc(downloadUrl(item))}" target="_blank" rel="noopener">Descargar</a>
            <button class="btn btn-danger btn-small" data-delete-media="${esc(item.key)}" type="button">✕</button>
          </div>
        </div>
      </div>`;
  }

  function renderDownloadSections() {
    DOWNLOAD_SECTIONS.forEach((section) => {
      const grid = $(`download-grid-${section.id}`);
      if (!grid) return;
      const items = mediaItems.filter((item) => String(item.folder || "") === section.folder);
      grid.innerHTML = items.length
        ? items.map(downloadCardMarkup).join("")
        : '<p class="muted">Todavía no hay archivos en esta sección.</p>';
      bindMediaCards(grid);
      grid.querySelectorAll("[data-copy-download]").forEach((button) => {
        button.addEventListener("click", () => copyDownloadUrl(button.dataset.copyDownload));
      });
    });
  }

  async function ensureDownloadFolders() {
    for (const section of DOWNLOAD_SECTIONS) {
      try {
        const data = await api("/api/admin/media/folders", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ name: section.folder }),
        });
        if (Array.isArray(data.folders)) mediaFolders = data.folders;
      } catch (error) {
        console.warn("No se pudo preparar la sección de descargas:", error);
      }
    }
  }

  async function loadMedia() {
    try {
      const data = await api("/api/admin/media");
      const items = Array.isArray(data.items) ? [...data.items] : [];
      const now = Date.now();

      for (const [key, pending] of pendingMedia) {
        if (pending.expires <= now) {
          pendingMedia.delete(key);
          continue;
        }
        const index = items.findIndex((item) => item.key === key);
        if (pending.item === null) {
          if (index >= 0) items.splice(index, 1);
        } else if (index >= 0) {
          items[index] = { ...items[index], ...pending.item };
        } else {
          items.unshift(pending.item);
        }
      }

      const folders = new Set(Array.isArray(data.folders) ? data.folders : []);
      pendingMedia.forEach(({ item }) => {
        if (item && item.folder) folders.add(item.folder);
      });

      mediaItems = items;
      mediaFolders = Array.from(folders).sort((a, b) => a.localeCompare(b, "es"));
      renderMediaFolderSelect();
      renderMediaGallery();
      renderDownloadSections();
    } catch (error) {
      toast(error.message, true);
    }
  }

  async function createMediaFolder() {
    const input = $("new-folder-name");
    const name = input ? input.value.trim() : "";
    if (!name) {
      toast("Escribe un nombre para la sección.", true);
      return;
    }
    try {
      const data = await api("/api/admin/media/folders", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      mediaFolders = data.folders || [];
      renderMediaFolderSelect(name);
      if (input) input.value = "";
      renderMediaGallery();
      toast(`Sección “${name}” creada. Ahora podés soltar archivos en ella.`);
    } catch (error) {
      toast(error.message, true);
    }
  }

  async function moveMedia(key, folder) {
    try {
      await api("/api/admin/media/move", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ key, folder }),
      });
      const item = mediaByKey(key);
      if (item) {
        item.folder = folder;
        markPendingMedia(key, { ...item, folder });
      }
      mediaFolders = Array.from(new Set([...mediaFolders, folder].filter(Boolean))).sort((a, b) =>
        a.localeCompare(b, "es"),
      );
      refreshMediaSoon();
      toast(folder ? `Archivo movido a “${folder}”.` : "Archivo movido a Sin sección.");
    } catch (error) {
      toast(error.message, true);
    }
  }

  async function removeMediaFolder(name) {
    try {
      const data = await api("/api/admin/media/folders", {
        method: "DELETE",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ name }),
      });
      mediaFolders = data.folders || [];
      mediaItems.forEach((item) => {
        if (item.folder === name) item.folder = "";
      });
      if (activeMediaFolder === name) activeMediaFolder = "__all__";
      renderMediaFolderSelect();
      renderMediaGallery();
      toast("Sección quitada. Los archivos siguen en Sin sección.");
    } catch (error) {
      toast(error.message, true);
    }
  }

  async function setMediaRole(key, field) {
    const slug = $("media-product-select") ? $("media-product-select").value : "";
    const product = products.find((item) => item.slug === slug);
    const item = mediaByKey(key);
    if (!product || !item) {
      toast("Elegí un producto y un archivo.", true);
      return;
    }
    const url = new URL(item.url, window.location.origin).href;
    try {
      await api("/api/products", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ ...product, [field]: url }),
      });
      product[field] = url;
      toast(
        field === "image"
          ? `Portada de ${product.title} actualizada.`
          : `Miniatura de ${product.title} actualizada.`,
      );
    } catch (error) {
      toast(error.message, true);
    }
  }

  function mediaByKey(key) {
    return mediaItems.find((item) => item.key === key);
  }

  function markPendingMedia(key, item) {
    pendingMedia.set(key, { item, expires: Date.now() + 30000 });
  }

  function refreshMediaSoon() {
    renderMediaFolderSelect();
    renderMediaGallery();
    renderDownloadSections();
    window.setTimeout(loadMedia, 3000);
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

  async function copyDownloadUrl(key) {
    const item = mediaByKey(key);
    if (!item) return;
    const url = downloadUrl(item);
    try {
      await navigator.clipboard.writeText(url);
      toast("URL de descarga copiada al portapapeles.");
    } catch {
      window.prompt("Copia esta URL de descarga:", url);
    }
  }

  function tabForTarget(target) {
    if (!target) return "recursos";
    if (target.startsWith("hero-")) return "portada";
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
      markPendingMedia(key, null);
      mediaItems = mediaItems.filter((item) => item.key !== key);
      refreshMediaSoon();
      toast("Archivo eliminado.");
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

    $("new-hero")?.addEventListener("click", resetHeroForm);
    $("clear-hero")?.addEventListener("click", resetHeroForm);
    $("reset-hero")?.addEventListener("click", resetHeroSlides);
    $("hero-form")?.addEventListener("submit", saveHeroSlide);

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

    $("upload-button")?.addEventListener("click", () => $("media-input").click());
    $("add-folder")?.addEventListener("click", createMediaFolder);
    $("new-folder-name")?.addEventListener("keydown", (event) => {
      if (event.key !== "Enter") return;
      event.preventDefault();
      createMediaFolder();
    });

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

    $("refresh-downloads")?.addEventListener("click", loadMedia);
    DOWNLOAD_SECTIONS.forEach((section) => {
      const input = $(`download-input-${section.id}`);
      const zone = $(`download-drop-${section.id}`);
      $(`download-upload-${section.id}`)?.addEventListener("click", () => input?.click());
      input?.addEventListener("change", (event) => {
        uploadFiles(event.target.files, section.folder);
        event.target.value = "";
      });
      if (!zone) return;
      zone.addEventListener("click", () => input?.click());
      ["dragenter", "dragover"].forEach((type) => {
        zone.addEventListener(type, (event) => {
          event.preventDefault();
          zone.classList.add("is-dragging");
        });
      });
      ["dragleave", "drop"].forEach((type) => {
        zone.addEventListener(type, (event) => {
          event.preventDefault();
          zone.classList.remove("is-dragging");
        });
      });
      zone.addEventListener("drop", (event) => uploadFiles(event.dataTransfer.files, section.folder));
    });

    $("password-form").addEventListener("submit", changePassword);
    $("reset-content").addEventListener("click", resetContent);
  }

  async function init() {
    bindEvents();
    try {
      await api("/api/admin/session");
      await ensureDownloadFolders();
      showDashboard();
    } catch {
      $("login-view").hidden = false;
      $("dashboard").hidden = true;
    }
  }

  init();
})();
