/**
 * DOM helpers, overlay, download, haptics, sound, share.
 */
export const $ = s => document.querySelector(s);
export const $$ = s => document.querySelectorAll(s);

// ── Overlay ──
export function showOv(text, sub) {
  $('#ovTxt').textContent = text || 'Procesando...';
  $('#ovSub').textContent = sub || '';
  $('#ovProgress').style.display = 'none';
  $('#ov').classList.add('on');
}

export function showOvProgress(step, total, text) {
  $('#ovTxt').textContent = text || 'Procesando...';
  $('#ovSub').textContent = `Paso ${step} de ${total}`;
  const bar = $('#ovProgress');
  bar.style.display = 'block';
  bar.querySelector('.ov-bar-fill').style.width = `${(step / total) * 100}%`;
  $('#ov').classList.add('on');
}

export function hideOv() {
  $('#ov').classList.remove('on');
}

// ── Download ──
export function downloadBlob(blob, filename) {
  const u = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = u;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(u);
}

export function canvasToBlob(canvas, format = 'image/png') {
  return new Promise(resolve => canvas.toBlob(resolve, format));
}

// ── Haptics ──
export function haptic(ms = 15) {
  if (navigator.vibrate) navigator.vibrate(ms);
}

// ── Camera shutter sound (Web Audio API) ──
let audioCtx = null;
export function cameraSound() {
  try {
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    const buf = audioCtx.createBuffer(1, audioCtx.sampleRate * 0.08, audioCtx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) {
      data[i] = (Math.random() * 2 - 1) * Math.exp(-i / (audioCtx.sampleRate * 0.015));
    }
    const src = audioCtx.createBufferSource();
    src.buffer = buf;
    const gain = audioCtx.createGain();
    gain.gain.value = 0.3;
    src.connect(gain);
    gain.connect(audioCtx.destination);
    src.start();
  } catch (_) { /* silent fail */ }
}

// ── Web Share API ──
export function canShare() {
  return !!navigator.share;
}

export async function shareFile(blob, filename) {
  const file = new File([blob], filename, { type: blob.type });
  if (navigator.canShare && navigator.canShare({ files: [file] })) {
    return navigator.share({ files: [file], title: 'Firma digitalizada' });
  }
  throw new Error('Share not supported');
}

// ── Clipboard paste ──
export async function getImageFromClipboard() {
  try {
    const items = await navigator.clipboard.read();
    for (const item of items) {
      const imageType = item.types.find(t => t.startsWith('image/'));
      if (imageType) {
        const blob = await item.getType(imageType);
        return URL.createObjectURL(blob);
      }
    }
  } catch (_) { /* no clipboard access */ }
  return null;
}

// ── Date formatting ──
export function formatDate(date) {
  const d = new Date(date);
  const pad = n => String(n).padStart(2, '0');
  return `${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
}
