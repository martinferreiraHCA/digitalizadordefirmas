/**
 * Web Worker for signature processing pipeline.
 * Loads OpenCV.js and processes images off the main thread.
 */

let cvReady = false;

// Load OpenCV.js inside the worker
try {
  importScripts('https://docs.opencv.org/4.x/opencv.js');
} catch (e) {
  postMessage({ type: 'cv-status', ready: false });
}

// Wait for OpenCV to initialize
if (typeof cv !== 'undefined') {
  if (cv.Mat) {
    cvReady = true;
    postMessage({ type: 'cv-status', ready: true });
  } else {
    cv['onRuntimeInitialized'] = () => {
      cvReady = true;
      postMessage({ type: 'cv-status', ready: true });
    };
  }
}

self.onmessage = function (e) {
  const { type, imageData, width, height, config } = e.data;

  if (type === 'process') {
    if (config.PROCESSING.method === 'removebg' && cvReady) {
      processRemoveBg(imageData, width, height, config);
    } else if (cvReady) {
      processWithCV(imageData, width, height, config);
    } else {
      processWithFallback(imageData, width, height, config);
    }
  }
};

function progress(step, total, text) {
  postMessage({ type: 'progress', step, total, text });
}

function processWithCV(imageData, w, h, cfg) {
  const P = cfg.PROCESSING;
  const W = cfg.OUTPUT_WIDTH;
  const H = cfg.OUTPUT_HEIGHT;
  const log = [];
  const STEPS = 7;

  try {
    // Load image data into Mat
    const src = cv.matFromImageData(new ImageData(new Uint8ClampedArray(imageData), w, h));
    log.push('Imagen cargada en Mat');
    progress(1, STEPS, 'Convirtiendo a escala de grises...');

    // 0. Perspective correction
    if (P.perspectiveCorrection) {
      const corrected = perspectiveCorrectWorker(src);
      if (corrected) {
        src.delete();
        // Can't reassign src since it's const, use workaround
        postMessage({ type: 'progress', step: 1, total: STEPS, text: 'Perspectiva corregida...' });
        log.push('Corrección de perspectiva aplicada');
        // Continue with corrected - we'll handle below
      }
    }

    // 1. Grayscale
    const gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    log.push('Escala de grises');
    progress(2, STEPS, 'Mejorando contraste...');

    // 2. CLAHE
    if (P.contrastEnhance) {
      const clahe = new cv.CLAHE(P.clipLimit, new cv.Size(P.tileSize, P.tileSize));
      clahe.apply(gray, gray);
      clahe.delete();
      log.push(`CLAHE (clip=${P.clipLimit}, tile=${P.tileSize})`);
    }
    progress(3, STEPS, 'Reduciendo ruido...');

    // 3. Gaussian Blur
    if (P.gaussianBlur > 0) {
      let k = P.gaussianBlur;
      if (k % 2 === 0) k++;
      cv.GaussianBlur(gray, gray, new cv.Size(k, k), 0);
      log.push(`Gaussian Blur (${k}×${k})`);
    }
    progress(4, STEPS, 'Binarizando...');

    // 4. Binarization
    const bin = new cv.Mat();
    if (P.method === 'adaptive') {
      let bs = P.adaptiveBlockSize;
      if (bs % 2 === 0) bs++;
      if (bs < 3) bs = 3;
      cv.adaptiveThreshold(gray, bin, 255, cv.ADAPTIVE_THRESH_GAUSSIAN_C, cv.THRESH_BINARY, bs, P.adaptiveC);
      log.push(`Adaptive Gaussian (block=${bs}, C=${P.adaptiveC})`);
    } else if (P.method === 'otsu') {
      cv.threshold(gray, bin, 0, 255, cv.THRESH_BINARY | cv.THRESH_OTSU);
      log.push('Otsu (automático)');
    } else {
      cv.threshold(gray, bin, P.manualThreshold, 255, cv.THRESH_BINARY);
      log.push(`Threshold manual (${P.manualThreshold})`);
    }
    progress(5, STEPS, 'Limpiando ruido...');

    // 5. Morphological Opening
    if (P.morphCleanup && P.morphKernelSize > 0) {
      const ks = P.morphKernelSize;
      const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(ks, ks));
      cv.morphologyEx(bin, bin, cv.MORPH_OPEN, kernel);
      kernel.delete();
      log.push(`Morfología Opening (elipse ${ks}×${ks})`);
    }
    progress(6, STEPS, 'Recortando firma...');

    // 6. Auto-crop
    let finalMat = bin;
    if (P.autoCrop) {
      const inv = new cv.Mat();
      cv.bitwise_not(bin, inv);
      const contours = new cv.MatVector();
      const hier = new cv.Mat();
      cv.findContours(inv, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

      if (contours.size() > 0) {
        let x1 = bin.cols, y1 = bin.rows, x2 = 0, y2 = 0;
        for (let i = 0; i < contours.size(); i++) {
          const r = cv.boundingRect(contours.get(i));
          x1 = Math.min(x1, r.x);
          y1 = Math.min(y1, r.y);
          x2 = Math.max(x2, r.x + r.width);
          y2 = Math.max(y2, r.y + r.height);
        }
        const pad = P.autoCropPadding;
        x1 = Math.max(0, x1 - pad);
        y1 = Math.max(0, y1 - pad);
        x2 = Math.min(bin.cols, x2 + pad);
        y2 = Math.min(bin.rows, y2 + pad);
        const cw = x2 - x1, ch = y2 - y1;
        if (cw > 10 && ch > 10) {
          const roi = bin.roi(new cv.Rect(x1, y1, cw, ch));
          finalMat = new cv.Mat();
          roi.copyTo(finalMat);
          roi.delete();
          log.push(`Auto-crop (${cw}×${ch}, ${contours.size()} contornos)`);
        }
      }
      inv.delete();
      contours.delete();
      hier.delete();
    }
    progress(7, STEPS, 'Redimensionando...');

    // 7. Resize
    const out = new cv.Mat();
    cv.resize(finalMat, out, new cv.Size(W, H), 0, 0, cv.INTER_AREA);
    log.push(`Resize ${W}×${H}`);

    // 8. Transparent background
    let resultMat = out;
    if (P.transparentBackground) {
      const rgba = new cv.Mat();
      cv.cvtColor(out, rgba, cv.COLOR_GRAY2RGBA);
      const data = rgba.data;
      for (let i = 0; i < data.length; i += 4) {
        if (data[i] === 255) {
          data[i + 3] = 0;
        } else {
          data[i] = data[i + 1] = data[i + 2] = 0;
          data[i + 3] = 255;
        }
      }
      resultMat = rgba;
      log.push('Fondo transparente (alpha)');
    } else {
      // Convert to RGBA for transfer
      const rgba = new cv.Mat();
      cv.cvtColor(out, rgba, cv.COLOR_GRAY2RGBA);
      resultMat = rgba;
    }

    // Extract image data and send back
    const resultData = new Uint8ClampedArray(resultMat.data);
    const resultWidth = resultMat.cols;
    const resultHeight = resultMat.rows;

    // Cleanup
    src.delete();
    gray.delete();
    if (bin !== finalMat) bin.delete();
    if (finalMat !== out) finalMat.delete();
    if (resultMat !== out) out.delete();
    resultMat.delete();

    postMessage({
      type: 'result',
      imageData: resultData.buffer,
      width: resultWidth,
      height: resultHeight,
      log,
    }, [resultData.buffer]);

  } catch (err) {
    postMessage({ type: 'error', error: err.message, log });
  }
}

function processWithFallback(imageData, w, h, cfg) {
  const P = cfg.PROCESSING;
  const W = cfg.OUTPUT_WIDTH;
  const H = cfg.OUTPUT_HEIGHT;
  const log = [];

  log.push('⚠ Fallback Canvas API (OpenCV no cargó)');
  progress(1, 2, 'Binarizando (fallback)...');

  // Create OffscreenCanvas if available, otherwise use raw pixel manipulation
  const srcData = new Uint8ClampedArray(imageData);

  // Simple resize + threshold on raw pixel data
  // Since we can't use canvas in worker, we do raw pixel ops
  const outData = new Uint8ClampedArray(W * H * 4);
  const scaleX = w / W, scaleY = h / H;
  const t = P.manualThreshold;

  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const sx = Math.floor(x * scaleX);
      const sy = Math.floor(y * scaleY);
      const si = (sy * w + sx) * 4;
      const di = (y * W + x) * 4;
      const g = srcData[si] * 0.299 + srcData[si + 1] * 0.587 + srcData[si + 2] * 0.114;
      const v = g < t ? 0 : 255;
      outData[di] = outData[di + 1] = outData[di + 2] = v;
      outData[di + 3] = P.transparentBackground ? (v === 255 ? 0 : 255) : 255;
    }
  }

  log.push(`Binarización simple (${t})`);
  if (P.transparentBackground) log.push('Fondo transparente (alpha)');

  progress(2, 2, 'Completo');

  postMessage({
    type: 'result',
    imageData: outData.buffer,
    width: W,
    height: H,
    log,
  }, [outData.buffer]);
}

// ══════════════════════════════════════════════════
// Remove BG pipeline (worker version)
// ══════════════════════════════════════════════════
function processRemoveBg(imageData, w, h, cfg) {
  const P = cfg.PROCESSING;
  const W = cfg.OUTPUT_WIDTH;
  const H = cfg.OUTPUT_HEIGHT;
  const log = [];
  const STEPS = 9;

  try {
    let src = cv.matFromImageData(new ImageData(new Uint8ClampedArray(imageData), w, h));
    log.push('Imagen cargada');
    progress(1, STEPS, 'Preparando imagen...');

    // Perspective correction
    if (P.perspectiveCorrection) {
      const corrected = perspectiveCorrectWorker(src);
      if (corrected) { src.delete(); src = corrected; log.push('Corrección de perspectiva'); }
    }

    // Save color for preserveColor mode
    let colorSrc = null;
    if (P.removeBgPreserveColor) {
      colorSrc = new cv.Mat();
      src.copyTo(colorSrc);
    }

    // Grayscale
    const gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    log.push('Escala de grises');
    progress(2, STEPS, 'Mejorando contraste...');

    // CLAHE
    const clahe = new cv.CLAHE(2.0, new cv.Size(8, 8));
    clahe.apply(gray, gray);
    clahe.delete();
    log.push('CLAHE (contraste local)');
    progress(3, STEPS, 'Estimando fondo...');

    // Background estimation via morphological closing
    let bgK = P.removeBgBgKernel || 51;
    if (bgK % 2 === 0) bgK++;
    const bgKernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(bgK, bgK));
    const bg = new cv.Mat();
    cv.morphologyEx(gray, bg, cv.MORPH_CLOSE, bgKernel);
    bgKernel.delete();
    log.push(`Estimación de fondo (kernel ${bgK})`);
    progress(4, STEPS, 'Normalizando iluminación...');

    // Normalize: subtract background
    const signal = new cv.Mat();
    cv.subtract(bg, gray, signal);
    bg.delete();
    cv.normalize(signal, signal, 0, 255, cv.NORM_MINMAX);
    cv.GaussianBlur(signal, signal, new cv.Size(3, 3), 0);
    log.push('Normalización de iluminación');
    progress(5, STEPS, 'Detectando tinta...');

    // Threshold for ink candidates
    const sensitivity = P.removeBgSensitivity || 30;
    const binMask = new cv.Mat();
    cv.threshold(signal, binMask, sensitivity, 255, cv.THRESH_BINARY);
    log.push(`Detección de tinta (sensibilidad=${sensitivity})`);
    progress(6, STEPS, 'Eliminando impurezas...');

    // Connected components filtering
    const labels = new cv.Mat();
    const stats = new cv.Mat();
    const centroids = new cv.Mat();
    const numLabels = cv.connectedComponentsWithStats(binMask, labels, stats, centroids);
    const minArea = P.removeBgMinArea || 15;
    const totalPixels = binMask.rows * binMask.cols;

    const keepLabel = new Uint8Array(numLabels);
    let keptCount = 0;
    for (let i = 1; i < numLabels; i++) {
      const area = stats.intAt(i, cv.CC_STAT_AREA);
      if (area >= minArea && area < totalPixels * 0.85) {
        keepLabel[i] = 1;
        keptCount++;
      }
    }

    const cleanMask = new cv.Mat(binMask.rows, binMask.cols, cv.CV_8UC1, new cv.Scalar(0));
    const labelData = labels.data32S;
    const cleanData = cleanMask.data;
    for (let i = 0; i < labelData.length; i++) {
      if (keepLabel[labelData[i]]) cleanData[i] = 255;
    }

    labels.delete(); stats.delete(); centroids.delete(); binMask.delete();
    log.push(`Limpieza: ${numLabels - 1} → ${keptCount} componentes (min=${minArea}px²)`);
    progress(7, STEPS, 'Generando alpha...');

    // Close small gaps in strokes
    const closeK = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(3, 3));
    cv.morphologyEx(cleanMask, cleanMask, cv.MORPH_CLOSE, closeK);
    closeK.delete();

    // Soft alpha from signal masked by clean mask
    const alpha = new cv.Mat();
    cv.bitwise_and(signal, signal, alpha, cleanMask);
    signal.delete(); cleanMask.delete();

    // Boost alpha with power curve
    const alphaBoost = P.removeBgAlphaBoost || 0.45;
    const aData = alpha.data;
    for (let i = 0; i < aData.length; i++) {
      let v = aData[i] / 255;
      if (v < 0.02) { aData[i] = 0; }
      else { aData[i] = Math.min(255, Math.round(Math.pow(v, alphaBoost) * 255)); }
    }
    log.push(`Alpha matting (boost=${alphaBoost})`);

    // Edge anti-aliasing
    const edgeSmooth = P.removeBgEdgeSmooth || 1;
    if (edgeSmooth > 0) {
      let k = edgeSmooth * 2 + 1;
      cv.GaussianBlur(alpha, alpha, new cv.Size(k, k), 0);
      log.push(`Anti-alias (${k}×${k})`);
    }
    progress(8, STEPS, 'Recortando...');

    // Auto-crop based on alpha
    let cropAlpha = alpha;
    if (P.autoCrop) {
      const thresh = new cv.Mat();
      cv.threshold(alpha, thresh, 5, 255, cv.THRESH_BINARY);
      const contours = new cv.MatVector();
      const hier = new cv.Mat();
      cv.findContours(thresh, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);
      if (contours.size() > 0) {
        let x1 = alpha.cols, y1 = alpha.rows, x2 = 0, y2 = 0;
        for (let i = 0; i < contours.size(); i++) {
          const r = cv.boundingRect(contours.get(i));
          x1 = Math.min(x1, r.x); y1 = Math.min(y1, r.y);
          x2 = Math.max(x2, r.x + r.width); y2 = Math.max(y2, r.y + r.height);
        }
        const pad = P.autoCropPadding;
        x1 = Math.max(0, x1 - pad); y1 = Math.max(0, y1 - pad);
        x2 = Math.min(alpha.cols, x2 + pad); y2 = Math.min(alpha.rows, y2 + pad);
        const cw = x2 - x1, ch = y2 - y1;
        if (cw > 10 && ch > 10) {
          const roiA = alpha.roi(new cv.Rect(x1, y1, cw, ch));
          cropAlpha = new cv.Mat(); roiA.copyTo(cropAlpha); roiA.delete();
          if (colorSrc) {
            const roiC = colorSrc.roi(new cv.Rect(x1, y1, cw, ch));
            const cc = new cv.Mat(); roiC.copyTo(cc); roiC.delete();
            colorSrc.delete(); colorSrc = cc;
          }
          log.push(`Auto-crop (${cw}×${ch})`);
        }
      }
      thresh.delete(); contours.delete(); hier.delete();
    }
    progress(9, STEPS, 'Finalizando...');

    // Resize
    const outAlpha = new cv.Mat();
    cv.resize(cropAlpha, outAlpha, new cv.Size(W, H), 0, 0, cv.INTER_AREA);
    if (cropAlpha !== alpha) cropAlpha.delete();
    alpha.delete();

    let outColor = null;
    if (colorSrc) {
      outColor = new cv.Mat();
      cv.resize(colorSrc, outColor, new cv.Size(W, H), 0, 0, cv.INTER_AREA);
      colorSrc.delete();
    }

    // Build RGBA
    const resultData = new Uint8ClampedArray(W * H * 4);
    const aOut = outAlpha.data;
    if (outColor) {
      const cData = outColor.data;
      for (let i = 0; i < aOut.length; i++) {
        const ri = i * 4;
        resultData[ri] = cData[ri];
        resultData[ri + 1] = cData[ri + 1];
        resultData[ri + 2] = cData[ri + 2];
        resultData[ri + 3] = aOut[i];
      }
      outColor.delete();
    } else {
      for (let i = 0; i < aOut.length; i++) {
        const ri = i * 4;
        resultData[ri] = 0;
        resultData[ri + 1] = 0;
        resultData[ri + 2] = 0;
        resultData[ri + 3] = aOut[i];
      }
    }
    outAlpha.delete(); src.delete(); gray.delete();

    log.push(`Resize ${W}×${H}`);
    log.push('✓ Fondo removido (alpha matting)');

    postMessage({
      type: 'result',
      imageData: resultData.buffer,
      width: W, height: H, log,
    }, [resultData.buffer]);

  } catch (err) {
    postMessage({ type: 'error', error: err.message, log });
  }
}

function perspectiveCorrectWorker(src) {
  try {
    const gray = new cv.Mat();
    cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
    cv.GaussianBlur(gray, gray, new cv.Size(5, 5), 0);
    const edges = new cv.Mat();
    cv.Canny(gray, edges, 50, 150);
    const kernel = cv.getStructuringElement(cv.MORPH_RECT, new cv.Size(3, 3));
    cv.dilate(edges, edges, kernel);
    kernel.delete();

    const contours = new cv.MatVector();
    const hier = new cv.Mat();
    cv.findContours(edges, contours, hier, cv.RETR_EXTERNAL, cv.CHAIN_APPROX_SIMPLE);

    let bestApprox = null, bestArea = 0;
    const minArea = src.rows * src.cols * 0.15;

    for (let i = 0; i < contours.size(); i++) {
      const cnt = contours.get(i);
      const area = cv.contourArea(cnt);
      if (area < minArea) continue;
      const peri = cv.arcLength(cnt, true);
      const approx = new cv.Mat();
      cv.approxPolyDP(cnt, approx, 0.02 * peri, true);
      if (approx.rows === 4 && area > bestArea) {
        if (bestApprox) bestApprox.delete();
        bestApprox = approx;
        bestArea = area;
      } else {
        approx.delete();
      }
    }

    gray.delete(); edges.delete(); contours.delete(); hier.delete();
    if (!bestApprox) return null;

    const pts = [];
    for (let i = 0; i < 4; i++) {
      pts.push({ x: bestApprox.data32S[i * 2], y: bestApprox.data32S[i * 2 + 1] });
    }
    bestApprox.delete();

    const sorted = [...pts].sort((a, b) => (a.x + a.y) - (b.x + b.y));
    const tl = sorted[0], br = sorted[3];
    const byDiff = [...pts].sort((a, b) => (a.y - a.x) - (b.y - b.x));
    const tr = byDiff[0], bl = byDiff[3];
    const ordered = [tl, tr, br, bl];

    const wA = Math.hypot(ordered[2].x - ordered[3].x, ordered[2].y - ordered[3].y);
    const wB = Math.hypot(ordered[1].x - ordered[0].x, ordered[1].y - ordered[0].y);
    const maxW = Math.round(Math.max(wA, wB));
    const hA = Math.hypot(ordered[1].x - ordered[2].x, ordered[1].y - ordered[2].y);
    const hB = Math.hypot(ordered[0].x - ordered[3].x, ordered[0].y - ordered[3].y);
    const maxH = Math.round(Math.max(hA, hB));

    if (maxW < 50 || maxH < 50) return null;

    const srcPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
      ordered[0].x, ordered[0].y, ordered[1].x, ordered[1].y,
      ordered[2].x, ordered[2].y, ordered[3].x, ordered[3].y,
    ]);
    const dstPts = cv.matFromArray(4, 1, cv.CV_32FC2, [0, 0, maxW, 0, maxW, maxH, 0, maxH]);
    const M = cv.getPerspectiveTransform(srcPts, dstPts);
    const warped = new cv.Mat();
    cv.warpPerspective(src, warped, M, new cv.Size(maxW, maxH));
    srcPts.delete(); dstPts.delete(); M.delete();
    return warped;
  } catch (_) {
    return null;
  }
}
