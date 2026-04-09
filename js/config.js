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
  }
};
