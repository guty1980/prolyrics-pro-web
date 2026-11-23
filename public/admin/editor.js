(function () {
  "use strict";

  const path = window.location.pathname;
  const params = new URLSearchParams(window.location.search);
  const inFrame = window.parent && window.parent !== window;

  async function api(url, options) {
    const response = await fetch(url, options);
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return response.json();
  }

  function getSelector(element) {
    if (!element || element === document.body) return "body";
    if (element.id && !/^[0-9]/.test(element.id)) {
      return `#${window.CSS && CSS.escape ? CSS.escape(element.id) : element.id}`;
    }

    const parts = [];
    let node = element;

    while (node && node.nodeType === 1 && node !== document.documentElement) {
      let part = node.tagName.toLowerCase();
      const parent = node.parentElement;

      if (parent) {
        const siblings = Array.from(parent.children).filter(
          (child) => child.tagName === node.tagName,
        );
        if (siblings.length > 1) {
          part += `:nth-of-type(${siblings.indexOf(node) + 1})`;
        }
      }

      parts.unshift(part);
      if (node === document.body) break;
      node = parent;
    }

    return parts.join(" > ");
  }

  function findElement(selector) {
    if (!selector || selector === "body") return document.body;
    try {
      return document.querySelector(selector);
    } catch {
      return null;
    }
  }

  function applyPatch(element, patch) {
    if (!element || !patch) return;
    if (Object.prototype.hasOwnProperty.call(patch, "html")) element.innerHTML = patch.html;
    else if (Object.prototype.hasOwnProperty.call(patch, "text")) element.textContent = patch.text;

    ["src", "href", "alt", "title", "style", "class"].forEach((attr) => {
      if (Object.prototype.hasOwnProperty.call(patch, attr)) {
        element.setAttribute(attr, patch[attr]);
      }
    });
  }

  function applySections(sections) {
    sections.forEach((section) => {
      if (section.enabled === false || !section.html) return;
      const main = document.querySelector("main") || document.body;

      if (section.position === "before" || section.position === "after") {
        const target = findElement(section.selector);
        if (target) {
          target.insertAdjacentHTML(section.position === "before" ? "beforebegin" : "afterend", section.html);
          return;
        }
      }
      main.insertAdjacentHTML("beforeend", section.html);
    });
  }

  async function loadContent() {
    try {
      const data = await api(`/api/content?path=${encodeURIComponent(path)}`);
      Object.entries(data.overrides || {}).forEach(([selector, patch]) => {
        applyPatch(findElement(selector), patch);
      });
      applySections(data.sections || []);
    } catch (error) {
      console.warn("[PROLYRICS CMS] No se pudo cargar el contenido editable", error);
    }
  }

  function cleanClasses(element) {
    return (element.getAttribute("class") || "")
      .split(/\s+/)
      .filter((name) => name && name !== "pl-editable" && name !== "pl-selected")
      .join(" ");
  }

  function readElement(element) {
    return {
      path,
      selector: getSelector(element),
      tag: element.tagName.toLowerCase(),
      text: (element.innerText || "").trim().slice(0, 20000),
      html: (element.innerHTML || "").trim().slice(0, 20000),
      src: element.getAttribute("src") || "",
      href: element.getAttribute("href") || "",
      alt: element.getAttribute("alt") || "",
      title: element.getAttribute("title") || "",
      class: cleanClasses(element),
      style: element.getAttribute("style") || "",
    };
  }

  function postSelection(info) {
    if (inFrame) {
      window.parent.postMessage({ source: "creativox-editor", type: "select", element: info }, window.location.origin);
    } else {
      showInlinePanel(info);
    }
  }

  let selected = null;

  function selectElement(element) {
    document.querySelectorAll(".pl-selected").forEach((node) => node.classList.remove("pl-selected"));
    selected = element;
    element.classList.add("pl-selected");
    postSelection(readElement(element));
  }

  function buildPatchFromForm(values) {
    const patch = {};
    if (values.mode === "html") patch.html = values.html;
    else patch.text = values.text;
    if (values.src) patch.src = values.src;
    if (values.href) patch.href = values.href;
    if (values.alt) patch.alt = values.alt;
    if (values.class) patch.class = values.class;
    if (values.style) patch.style = values.style;
    return patch;
  }

  async function savePatch(info, patch) {
    await api("/api/content", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: info.path, selector: info.selector, patch }),
    });
    window.location.reload();
  }

  async function deletePatch(info) {
    await api("/api/content", {
      method: "DELETE",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ path: info.path, selector: info.selector }),
    });
    window.location.reload();
  }

  function showInlinePanel(info) {
    const old = document.getElementById("pl-inline-panel");
    if (old) old.remove();

    const panel = document.createElement("div");
    panel.id = "pl-inline-panel";
    panel.className = "pl-inline-panel";
    panel.innerHTML = `
      <h4>Editar elemento</h4>
      <div style="font-size:11px;color:#c4b5fd;word-break:break-all">${info.selector}</div>
      <label>Texto<textarea data-field="text"></textarea></label>
      <label>HTML<textarea data-field="html"></textarea></label>
      <label>URL (src)<input data-field="src" /></label>
      <label>Enlace (href)<input data-field="href" /></label>
      <label>Alt<input data-field="alt" /></label>
      <label>Clases<input data-field="class" /></label>
      <label>Estilo<input data-field="style" /></label>
      <button data-action="save">Guardar</button>
      <button data-action="delete" style="background:#e11d48">Restaurar</button>
      <button data-action="close" style="background:#334155">Cerrar</button>
    `;
    document.body.appendChild(panel);

    panel.querySelector('[data-field="text"]').value = info.text;
    panel.querySelector('[data-field="html"]').value = info.html;
    panel.querySelector('[data-field="src"]').value = info.src;
    panel.querySelector('[data-field="href"]').value = info.href;
    panel.querySelector('[data-field="alt"]').value = info.alt;
    panel.querySelector('[data-field="class"]').value = info.class;
    panel.querySelector('[data-field="style"]').value = info.style;

    const values = () => ({
      mode: panel.querySelector('[data-field="html"]').value ? "html" : "text",
      text: panel.querySelector('[data-field="text"]').value,
      html: panel.querySelector('[data-field="html"]').value,
      src: panel.querySelector('[data-field="src"]').value,
      href: panel.querySelector('[data-field="href"]').value,
      alt: panel.querySelector('[data-field="alt"]').value,
      class: panel.querySelector('[data-field="class"]').value,
      style: panel.querySelector('[data-field="style"]').value,
    });

    panel.querySelector('[data-action="save"]').addEventListener("click", () => savePatch(info, buildPatchFromForm(values())));
    panel.querySelector('[data-action="delete"]').addEventListener("click", () => deletePatch(info));
    panel.querySelector('[data-action="close"]').addEventListener("click", () => panel.remove());
  }

  function enableEditMode() {
    const badge = document.createElement("div");
    badge.className = "pl-edit-badge";
    badge.textContent = "MODO EDICIÓN — clic en un elemento para editarlo · ESC para salir";
    document.body.appendChild(badge);

    document
      .querySelectorAll("h1,h2,h3,h4,h5,h6,p,a,button,span,img,li,blockquote,label,dt,dd,section,div")
      .forEach((node) => node.classList.add("pl-editable"));

    document.addEventListener(
      "click",
      (event) => {
        let element = event.target;
        const skip = new Set(["HTML", "BODY", "SCRIPT", "STYLE", "SVG", "PATH", "CIRCLE", "RECT", "LINE", "POLYGON"]);
        while (element && skip.has(element.tagName)) element = element.parentElement;
        if (!element || element === document.body) return;
        // Las pestañas y filtros de la portada deben seguir funcionando
        // dentro del panel de administración en modo edición.
        if (element.closest && element.closest("[data-no-edit]")) return;
        event.preventDefault();
        event.stopPropagation();
        selectElement(element);
      },
      true,
    );

    document.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        const url = new URL(window.location.href);
        url.searchParams.delete("edit");
        window.location.href = url.toString();
      }
    });

    window.addEventListener("message", (event) => {
      if (event.origin !== window.location.origin) return;
      if (event.data && event.data.type === "pl:reload") window.location.reload();
    });
  }

  async function init() {
    await loadContent();

    if (params.get("edit") !== "1") return;

    try {
      const session = await api("/api/admin/session");
      if (session.ok) enableEditMode();
    } catch {
      // Sin sesión el sitio se muestra normalmente.
    }
  }

  init();
})();
