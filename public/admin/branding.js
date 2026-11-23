(function () {
  "use strict";

  function isHexColor(value) {
    return /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(String(value || ""));
  }

  function applyLogo(url) {
    if (!url) return;
    document.querySelectorAll("[data-brand-mark]").forEach((mark) => {
      const svg = mark.querySelector("svg");
      if (svg) svg.style.display = "none";
      let img = mark.querySelector("img[data-brand-logo]");
      if (!img) {
        img = document.createElement("img");
        img.setAttribute("data-brand-logo", "");
        img.alt = "Logo";
        img.style.width = "100%";
        img.style.height = "100%";
        img.style.objectFit = "contain";
        mark.appendChild(img);
      }
      img.src = url;
    });
  }

  async function applyBranding() {
    try {
      const response = await fetch("/api/branding", { credentials: "same-origin" });
      if (!response.ok) return;
      const data = await response.json();
      const brand = data.branding || {};

      const root = document.documentElement;
      if (isHexColor(brand.primary)) root.style.setProperty("--cx-primary", brand.primary);
      if (isHexColor(brand.primary2)) root.style.setProperty("--cx-primary-2", brand.primary2);
      if (isHexColor(brand.accent)) root.style.setProperty("--cx-accent", brand.accent);

      const meta = document.querySelector('meta[name="theme-color"]');
      if (meta && isHexColor(brand.primary)) meta.setAttribute("content", brand.primary);

      if (brand.siteName) {
        document.querySelectorAll("[data-brand-name]").forEach((node) => {
          node.textContent = brand.siteName;
        });
      }
      if (brand.tagline) {
        document.querySelectorAll("[data-brand-tagline]").forEach((node) => {
          node.textContent = brand.tagline;
        });
      }
      if (brand.logoUrl) applyLogo(brand.logoUrl);
      if (brand.email) {
        document.querySelectorAll("[data-brand-email]").forEach((node) => {
          node.textContent = brand.email;
          node.setAttribute("href", `mailto:${brand.email}`);
        });
      }
    } catch {
      // Si falla, se mantiene la marca por defecto.
    }
  }

  applyBranding();
})();
