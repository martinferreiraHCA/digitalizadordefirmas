/**
 * Signature processing pipeline.
 * OpenCV.js pipeline + Canvas API fallback.
 * Includes perspective correction and transparent background.
 */
import { APP_CONFIG } from './config.js';

// ── OpenCV Pipeline (main thread, used as fallback if worker unavailable) ──
export function cvPipeline(croppedCanvas, config) {
  const P = config || APP_CONFIG.PROCESSING;
  const W = APP_CONFIG.OUTPUT_WIDTH;
  const H = APP_CONFIG.OUTPUT_HEIGHT;
  const log = [];

  let src = cv.imread(croppedCanvas);
  log.push('Imagen cargada en Mat');

  // 0. Perspective correction
  if (P.perspectiveCorrection) {
    const corrected = perspectiveCorrect(src);
    if (corrected) {
      src.delete();
      src = corrected;
      log.push('Corrección de perspectiva aplicada');
    } else {
      log.push('Perspectiva: no se detectó documento');
    }
  }

  // 1. Grayscale
  const gray = new cv.Mat();
  cv.cvtColor(src, gray, cv.COLOR_RGBA2GRAY);
  log.push('Escala de grises');

  // 2. CLAHE
  if (P.contrastEnhance) {
    const clahe = new cv.CLAHE(P.clipLimit, new cv.Size(P.tileSize, P.tileSize));
    clahe.apply(gray, gray);
    clahe.delete();
    log.push(`CLAHE (clip=${P.clipLimit}, tile=${P.tileSize})`);
  }

  // 3. Gaussian Blur
  if (P.gaussianBlur > 0) {
    let k = P.gaussianBlur;
    if (k % 2 === 0) k++;
    cv.GaussianBlur(gray, gray, new cv.Size(k, k), 0);
    log.push(`Gaussian Blur (${k}×${k})`);
  }

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

  // 5. Morphological Opening
  if (P.morphCleanup && P.morphKernelSize > 0) {
    const ks = P.morphKernelSize;
    const kernel = cv.getStructuringElement(cv.MORPH_ELLIPSE, new cv.Size(ks, ks));
    cv.morphologyEx(bin, bin, cv.MORPH_OPEN, kernel);
    kernel.delete();
    log.push(`Morfología Opening (elipse ${ks}×${ks})`);
  }

  // 6. Auto-crop via contours
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

  // 7. Resize
  const out = new cv.Mat();
  cv.resize(finalMat, out, new cv.Size(W, H), 0, 0, cv.INTER_AREA);
  log.push(`Resize ${W}×${H}`);

  // 8. Transparent background (optional)
  let result;
  if (P.transparentBackground) {
    result = makeTransparent(out);
    log.push('Fondo transparente (alpha)');
  } else {
    result = out;
  }

  // Cleanup
  src.delete();
  gray.delete();
  if (bin !== finalMat) bin.delete();
  if (finalMat !== out) finalMat.delete();
  if (result !== out) out.delete();

  return { mat: result, log };
}

// ── Fallback Canvas API ──
export function fallbackPipeline(croppedCanvas, config) {
  const P = config || APP_CONFIG.PROCESSING;
  const W = APP_CONFIG.OUTPUT_WIDTH;
  const H = APP_CONFIG.OUTPUT_HEIGHT;
  const log = [];
  log.push('⚠ Fallback Canvas API (OpenCV no cargó)');

  const c = document.createElement('canvas');
  c.width = W;
  c.height = H;
  const ctx = c.getContext('2d');
  ctx.drawImage(croppedCanvas, 0, 0, W, H);

  const d = ctx.getImageData(0, 0, W, H);
  const px = d.data;
  const t = P.manualThreshold;

  for (let i = 0; i < px.length; i += 4) {
    const g = px[i] * 0.299 + px[i + 1] * 0.587 + px[i + 2] * 0.114;
    const v = g < t ? 0 : 255;
    px[i] = px[i + 1] = px[i + 2] = v;
    if (P.transparentBackground) {
      px[i + 3] = v === 255 ? 0 : 255;
    } else {
      px[i + 3] = 255;
    }
  }
  ctx.putImageData(d, 0, 0);
  log.push(`Binarización simple (${t})`);
  if (P.transparentBackground) log.push('Fondo transparente (alpha)');

  return { canvas: c, log };
}

// ── Perspective correction (4-point transform) ──
function perspectiveCorrect(src) {
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

    let bestApprox = null;
    let bestArea = 0;
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

    gray.delete();
    edges.delete();
    contours.delete();
    hier.delete();

    if (!bestApprox) return null;

    // Order points: top-left, top-right, bottom-right, bottom-left
    const pts = [];
    for (let i = 0; i < 4; i++) {
      pts.push({ x: bestApprox.data32S[i * 2], y: bestApprox.data32S[i * 2 + 1] });
    }
    bestApprox.delete();

    const ordered = orderPoints(pts);

    const wA = Math.hypot(ordered[2].x - ordered[3].x, ordered[2].y - ordered[3].y);
    const wB = Math.hypot(ordered[1].x - ordered[0].x, ordered[1].y - ordered[0].y);
    const maxW = Math.round(Math.max(wA, wB));

    const hA = Math.hypot(ordered[1].x - ordered[2].x, ordered[1].y - ordered[2].y);
    const hB = Math.hypot(ordered[0].x - ordered[3].x, ordered[0].y - ordered[3].y);
    const maxH = Math.round(Math.max(hA, hB));

    if (maxW < 50 || maxH < 50) return null;

    const srcPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
      ordered[0].x, ordered[0].y,
      ordered[1].x, ordered[1].y,
      ordered[2].x, ordered[2].y,
      ordered[3].x, ordered[3].y,
    ]);
    const dstPts = cv.matFromArray(4, 1, cv.CV_32FC2, [
      0, 0, maxW, 0, maxW, maxH, 0, maxH,
    ]);

    const M = cv.getPerspectiveTransform(srcPts, dstPts);
    const warped = new cv.Mat();
    cv.warpPerspective(src, warped, M, new cv.Size(maxW, maxH));

    srcPts.delete();
    dstPts.delete();
    M.delete();

    return warped;
  } catch (_) {
    return null;
  }
}

function orderPoints(pts) {
  // Sort by sum (x+y): smallest = top-left, largest = bottom-right
  const sorted = [...pts].sort((a, b) => (a.x + a.y) - (b.x + b.y));
  const tl = sorted[0];
  const br = sorted[3];
  // Sort by diff (y-x): smallest = top-right, largest = bottom-left
  const byDiff = [...pts].sort((a, b) => (a.y - a.x) - (b.y - b.x));
  const tr = byDiff[0];
  const bl = byDiff[3];
  return [tl, tr, br, bl];
}

// ── Transparent background ──
function makeTransparent(binMat) {
  const rgba = new cv.Mat();
  cv.cvtColor(binMat, rgba, cv.COLOR_GRAY2RGBA);
  const data = rgba.data;
  for (let i = 0; i < data.length; i += 4) {
    if (data[i] === 255) {
      // White pixel → transparent
      data[i + 3] = 0;
    } else {
      // Dark pixel → opaque black
      data[i] = data[i + 1] = data[i + 2] = 0;
      data[i + 3] = 255;
    }
  }
  return rgba;
}

// ── Render result to canvas ──
export function renderToCanvas(canvas, result) {
  const W = APP_CONFIG.OUTPUT_WIDTH;
  const H = APP_CONFIG.OUTPUT_HEIGHT;
  canvas.width = W;
  canvas.height = H;

  if (result.mat) {
    cv.imshow(canvas, result.mat);
    result.mat.delete();
  } else if (result.canvas) {
    const ctx = canvas.getContext('2d');
    ctx.clearRect(0, 0, W, H);
    ctx.drawImage(result.canvas, 0, 0, W, H);
  }
}
