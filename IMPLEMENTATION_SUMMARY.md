# CREATIVOX — Plataforma digital

Sitio público de **CREATIVOX** (tienda de productos digitales, apps y software). **PROLYRICS** es uno de los productos del catálogo, no la marca del sitio.

El formato visual de la portada se conserva; se añadió un carrusel tipo Netflix con los productos a la venta, sus detalles de venta y funcionalidades.

## Funcionalidades

- **Portada:** hero original + reel rotativo de productos (`/api/products`), con navegación anterior/siguiente, autoplay y puntos de progreso.
- **Catálogo público:** `/productos` — todos los productos publicados.
- **Detalle de producto:** `/producto/?slug=...` — imagen, logo, tráiler, galería, precio, detalles de venta, funcionalidades y acceso condicionado a cuenta.
- **Cuentas de clientes:** `/cuenta` — registro con email/contraseña, login y panel con los productos asignados.
- **Acceso por producto:** el administrador crea usuarios y les asigna productos; las descargas se validan server-side.
- **Panel de administración:** `/admin` con 7 pestañas:
  1. Editor visual (clic en texto/imagen/sección del sitio dentro de un iframe)
  2. Productos (CRUD completo: logo, imagen, video, precios, detalles, funcionalidades)
  3. Usuarios (crear/editar/eliminar, asignar productos, rol y estado)
  4. Marca (nombre, tagline, logo y paleta de colores)
  5. Recursos (biblioteca interna de PROLYRICS)
  6. Medios (subida por fragmentos, reanudable, hasta 4.5 GB por archivo)
  7. Ajustes (cambio de clave y restablecimiento de ediciones visuales)

## Arquitectura

### Frontend
- `src/pages/index.astro` — portada (hero original + `ProductReel`)
- `src/pages/productos/index.astro`, `src/pages/producto.astro`, `src/pages/cuenta.astro`
- `src/pages/admin.astro` — panel de administración
- `src/components/Sections/ProductReel.astro` — carrusel tipo Netflix
- `src/components/Global/` — Header, Footer y Navigation con identidad CREATIVOX
- `src/layouts/BaseLayout.astro` — carga `branding.js` y `editor.js`
- `public/admin/` — `admin.js`, `admin.css`, `editor.js`, `branding.js`

### Backend (Netlify Functions)
- `netlify/functions/api.mjs` — todas las rutas `/api/*`
- `netlify/functions/_lib/`:
  - `blobs.mjs` — Netlify Blobs (contenido, medios, fragmentos)
  - `auth.mjs` — hash scrypt, sesiones HMAC y cookies HttpOnly del administrador
  - `users.mjs` — cuentas de clientes, hash scrypt y sesiones HMAC
  - `http.mjs` — helpers JSON, errores y validaciones
  - `seed-products.mjs` — catálogo inicial y valores de marca

## Rutas API principales

| Método | Ruta | Descripción |
|--------|------|-------------|
| GET | `/api/health` | Estado del servicio |
| GET | `/api/branding` | Nombre, logo y colores de CREATIVOX |
| POST | `/api/branding` | Guardar marca (admin) |
| GET | `/api/products` | Productos publicados |
| POST / DELETE | `/api/products` | Crear/actualizar/eliminar producto (admin) |
| GET | `/api/product/file` | Descarga validada por cuenta y producto |
| GET | `/api/account/session` | Sesión del cliente y sus productos |
| POST | `/api/account/register` | Registro de cliente |
| POST / DELETE | `/api/account/login` / `/api/account/logout` | Acceso del cliente |
| GET / POST / DELETE | `/api/admin/users` | Gestión de usuarios (admin) |
| POST | `/api/admin/login` / `/api/admin/logout` | Sesión del administrador |
| GET / POST / DELETE | `/api/content` | Textos, imágenes y secciones editables |
| GET / POST / DELETE | `/api/resources` | Recursos de PROLYRICS |
| POST | `/api/admin/media/chunk` / `/api/admin/media/finalize` | Subida por fragmentos |
| GET / DELETE | `/api/admin/media` | Biblioteca de medios |
| GET | `/api/media?key=` | Servir archivo subido |

## Seguridad

- La clave de administrador se verifica **en el servidor** con hash scrypt; nunca aparece en JavaScript cliente ni en documentación.
- Las contraseñas de clientes se guardan con hash scrypt (salt aleatorio por usuario).
- Sesiones firmadas con HMAC y cookies `HttpOnly`, `SameSite=Lax`, `Secure` en HTTPS.
- Las credenciales y secretos se configuran **solo** como variables de entorno en Netlify (ver `.env.example`). No se incluyen valores reales en este repositorio.

## Almacenamiento y límites

- Netlify Blobs: stores `prolyrics-content`, `prolyrics-media`, `prolyrics-chunks`.
- Subida por fragmentos de 4 MB, hasta **4.5 GB por archivo** (límite de objeto en Blobs: 5 GB).
- Reanudación de subidas interrumpidas mediante ID guardado en `localStorage`.
- Ancho de banda free tier de Netlify: ~15 GB/mes.

## Despliegue

```powershell
npm run build
npx netlify-cli deploy --prod --dir=dist --site <SITE_ID> --message "mensaje"
```

Sitio en producción: `https://prolyrics-pro.netlify.app`
Panel: `https://prolyrics-pro.netlify.app/admin`
