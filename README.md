# Escáner de Firmas · HCA

App web para escanear y digitalizar firmas manuscritas. Optimizada para celulares, usa la cámara trasera para capturar fotos de firmas y las procesa con un pipeline de visión computacional.

## Características

- **Captura con cámara** del celular (cámara trasera) o pegado desde portapapeles
- **Recorte interactivo** con Cropper.js (aspect ratio configurable)
- **Pipeline de procesamiento** con OpenCV.js:
  - Escala de grises
  - CLAHE (mejora de contraste local)
  - Gaussian Blur (reducción de ruido)
  - Binarización (3 métodos: Adaptive Gaussian, Otsu, Manual)
  - Morfología Opening (limpieza de ruido)
  - Auto-crop via contour detection
  - Corrección de perspectiva (4-point transform)
  - Fondo transparente (PNG con alpha)
  - Resize a tamaño configurable (default 600×200px)
- **Comparador visual** antes/después con slider divisor
- **Input de cédula uruguaya** con auto-formato (X.XXX.XXX-X)
- **Historial de firmas** con IndexedDB (listar, re-descargar, eliminar)
- **Modo batch** para escanear múltiples firmas sin volver al inicio
- **Compartir** via Web Share API (WhatsApp, email, etc.)
- **PWA** instalable con soporte offline
- **Web Worker** para procesamiento sin bloquear la UI
- **Fallback** a Canvas API si OpenCV.js no carga

## Screenshots

> Para generar screenshots: abrí la app en Chrome DevTools con emulación móvil (iPhone 14 Pro, 393×852) y usá Ctrl+Shift+P → "Capture screenshot".

## Deploy en GitHub Pages

1. Hacé push del código a un repositorio en GitHub
2. Andá a **Settings → Pages**
3. En "Source" seleccioná **Deploy from a branch**
4. Elegí la rama `main` y carpeta `/ (root)`
5. Hacé click en **Save**

La app estará disponible en `https://<usuario>.github.io/<repo>/`

No requiere build step, bundler ni instalación de dependencias. Todo es estático.

## Estructura del proyecto

```
├── index.html          # HTML — estructura de la app
├── css/
│   └── app.css         # Estilos (dark theme, mobile-first)
├── js/
│   ├── config.js       # Configuración (APP_CONFIG)
│   ├── pipeline.js     # Pipeline de procesamiento (OpenCV + fallback)
│   ├── worker.js       # Web Worker para procesamiento off-thread
│   ├── history.js      # Historial con IndexedDB
│   ├── cedula.js       # Formateo de cédula uruguaya
│   ├── utils.js        # Helpers (overlay, download, haptics, share)
│   └── app.js          # Orquestación principal de la UI
├── manifest.json       # PWA manifest
├── sw.js               # Service Worker (cache offline)
└── README.md
```

## Pipeline de procesamiento

El pipeline aplica 7 pasos secuenciales a la imagen capturada:

| Paso | Operación | Descripción |
|------|-----------|-------------|
| 1 | Grayscale | Conversión a escala de grises |
| 2 | CLAHE | Mejora de contraste local adaptativo |
| 3 | Gaussian Blur | Reducción de ruido de cámara |
| 4 | Binarización | Conversión a blanco/negro (3 métodos) |
| 5 | Morfología Opening | Limpieza de ruido residual |
| 6 | Auto-crop | Detección de contornos y recorte |
| 7 | Resize | Redimensionado al tamaño de salida |

Pasos opcionales:
- **Corrección de perspectiva**: detecta bordes del documento y aplica warpPerspective
- **Fondo transparente**: convierte el fondo blanco en canal alpha

## Configuración

Editá `js/config.js` para cambiar valores por defecto:

```javascript
export const APP_CONFIG = {
  OUTPUT_WIDTH: 600,       // ancho de salida en px
  OUTPUT_HEIGHT: 200,      // alto de salida en px
  OUTPUT_FORMAT: 'image/png',
  FILE_PREFIX: 'firma',    // prefijo del nombre de archivo
  PROCESSING: {
    method: 'adaptive',    // 'adaptive' | 'otsu' | 'manual'
    gaussianBlur: 3,       // tamaño del kernel (0 = desactivado)
    adaptiveBlockSize: 25, // tamaño de bloque para adaptive threshold
    adaptiveC: 10,         // constante C para adaptive threshold
    manualThreshold: 128,  // umbral para modo manual
    morphCleanup: true,    // limpieza morfológica
    morphKernelSize: 2,    // tamaño del kernel morfológico
    autoCrop: true,        // auto-recorte por contornos
    autoCropPadding: 10,   // padding del auto-recorte en px
    contrastEnhance: true, // CLAHE activado
    clipLimit: 2.0,        // clip limit de CLAHE
    tileSize: 8,           // tile size de CLAHE
    perspectiveCorrection: false, // corrección de perspectiva
    transparentBackground: false, // fondo transparente
  }
};
```

## Dependencias externas (CDN)

- [OpenCV.js 4.x](https://docs.opencv.org/4.x/opencv.js) — procesamiento de imágenes
- [Cropper.js 1.6](https://cdnjs.cloudflare.com/ajax/libs/cropperjs/1.6.2/) — recorte interactivo
- [DM Sans + JetBrains Mono](https://fonts.google.com/) — tipografías

## Stack técnico

- HTML/CSS/JS vanilla (sin frameworks, sin bundler)
- ES Modules (`type="module"`)
- Web Workers para procesamiento off-thread
- IndexedDB para persistencia local
- Service Worker para cache offline
- Web Share API, Web Audio API, Vibration API

## Licencia

MIT
