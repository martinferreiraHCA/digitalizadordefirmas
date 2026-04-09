/**
 * App configuration and constants.
 */
export const APP_CONFIG = {
  OUTPUT_WIDTH: 600,
  OUTPUT_HEIGHT: 200,
  OUTPUT_FORMAT: 'image/png',
  FILE_PREFIX: 'firma',
  PROCESSING: {
    method: 'adaptive',
    gaussianBlur: 3,
    adaptiveBlockSize: 25,
    adaptiveC: 10,
    manualThreshold: 128,
    morphCleanup: true,
    morphKernelSize: 2,
    autoCrop: true,
    autoCropPadding: 10,
    contrastEnhance: true,
    clipLimit: 2.0,
    tileSize: 8,
    perspectiveCorrection: false,
    transparentBackground: false,
    // Remove BG (tipo remove.bg) — pipeline especializado
    removeBgSensitivity: 30,     // 5–80: umbral de detección de tinta (menor = más sensible)
    removeBgMinArea: 15,         // área mínima de componente en px² para mantener
    removeBgEdgeSmooth: 1,       // 0–3: suavizado de bordes (anti-alias)
    removeBgBgKernel: 51,        // tamaño del kernel para estimación de fondo
    removeBgAlphaBoost: 0.45,    // 0.2–0.8: exponente de curva alpha (menor = más opaco)
    removeBgPreserveColor: false, // preservar color original de la tinta
  }
};
