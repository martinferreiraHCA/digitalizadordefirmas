/**
 * Escáner de Firmas — Main App
 * Orchestrates UI, navigation, pipeline, history, PWA, batch mode.
 */
import { APP_CONFIG } from './config.js';
import { $, $$, showOv, showOvProgress, hideOv, downloadBlob, canvasToBlob, haptic, cameraSound, canShare, shareFile, getImageFromClipboard, formatDate } from './utils.js';
import { formatCI, getDigits, isValidCI } from './cedula.js';
import { cvPipeline, fallbackPipeline, renderToCanvas } from './pipeline.js';
import { saveSignature, getAllSignatures, deleteSignature, clearAllSignatures, getCount } from './history.js';

// ── State ──
let cvReady = false;
let cropper = null;
let croppedCanvas = null;
let pipelineLog = [];
let originalCroppedCanvas = null; // for comparator
let worker = null;
let workerReady = false;
let batchMode = false;
let batchCount = 0;
let deferredInstallPrompt = null;

// ── OpenCV.js load detection ──
function onOpenCvReady() {
  cvReady = true;
  const b = $('#cvBanner');
  b.textContent = 'OpenCV.js listo';
  b.classList.add('ready');
  setTimeout(() => b.classList.remove('on'), 1500);
}

const _cvCheck = setInterval(() => {
  if (typeof cv !== 'undefined') {
    if (cv.Mat) {
      clearInterval(_cvCheck);
      onOpenCvReady();
    } else if (!cv._cvReadyHooked) {
      cv._cvReadyHooked = true;
      cv['onRuntimeInitialized'] = () => { clearInterval(_cvCheck); onOpenCvReady(); };
    }
  }
}, 100);

// ── Web Worker setup ──
function initWorker() {
  try {
    worker = new Worker('js/worker.js');
    worker.onmessage = handleWorkerMessage;
    worker.onerror = () => { worker = null; };
  } catch (_) {
    worker = null;
  }
}

function handleWorkerMessage(e) {
  const msg = e.data;
  if (msg.type === 'cv-status') {
    workerReady = msg.ready;
  } else if (msg.type === 'progress') {
    showOvProgress(msg.step, msg.total, msg.text);
  } else if (msg.type === 'result') {
    const imgData = new ImageData(
      new Uint8ClampedArray(msg.imageData),
      msg.width, msg.height
    );
    pipelineLog = msg.log;
    const canvas = $('#prevCanvas');
    canvas.width = msg.width;
    canvas.height = msg.height;
    canvas.getContext('2d').putImageData(imgData, 0, 0);
    updatePreviewLabel();
    updateTransparentBg();
    hideOv();
  } else if (msg.type === 'error') {
    pipelineLog = msg.log || [];
    pipelineLog.push(`⚠ Error: ${msg.error}`);
    // Fallback to main thread
    runPipelineMainThread();
    hideOv();
  }
}

// ── Navigation ──
function go(id) {
  $$('.scr').forEach(s => s.classList.remove('on'));
  $(id).classList.add('on');
}

// ══════════════════════════════════════════════════
// SCREEN 1: CAPTURE
// ══════════════════════════════════════════════════
$('#capZone').addEventListener('click', () => $('#camIn').click());

$('#camIn').addEventListener('change', e => {
  const f = e.target.files[0];
  if (!f) return;
  haptic();
  cameraSound();
  const r = new FileReader();
  r.onload = ev => {
    $('#capImg').src = ev.target.result;
    $('#capZone').classList.add('has');
    $('#btnCrop').disabled = false;
  };
  r.readAsDataURL(f);
});

// Clipboard paste button
$('#btnPaste').addEventListener('click', async () => {
  const url = await getImageFromClipboard();
  if (url) {
    haptic();
    $('#capImg').src = url;
    $('#capZone').classList.add('has');
    $('#btnCrop').disabled = false;
  }
});

// Also support Ctrl+V / Cmd+V paste
document.addEventListener('paste', e => {
  const items = e.clipboardData?.items;
  if (!items) return;
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      e.preventDefault();
      const blob = item.getAsFile();
      const url = URL.createObjectURL(blob);
      haptic();
      $('#capImg').src = url;
      $('#capZone').classList.add('has');
      $('#btnCrop').disabled = false;
      break;
    }
  }
});

// ══════════════════════════════════════════════════
// SCREEN 2: CROP
// ══════════════════════════════════════════════════
$('#btnCrop').addEventListener('click', () => {
  go('#s-crop');
  $('#cropImg').src = $('#capImg').src;
  if (cropper) cropper.destroy();
  setTimeout(() => {
    cropper = new Cropper($('#cropImg'), {
      aspectRatio: APP_CONFIG.OUTPUT_WIDTH / APP_CONFIG.OUTPUT_HEIGHT,
      viewMode: 1, dragMode: 'move', autoCropArea: 0.8,
      responsive: true, background: false, guides: true,
    });
  }, 120);
});

$('#btnBack1').addEventListener('click', () => {
  if (cropper) cropper.destroy();
  go('#s-capture');
});

// ══════════════════════════════════════════════════
// SCREEN 3: PROCESS + DATA
// ══════════════════════════════════════════════════
$('#btnProc').addEventListener('click', () => {
  if (!cropper) return;
  showOv('Recortando imagen...');
  setTimeout(() => {
    croppedCanvas = cropper.getCroppedCanvas({
      width: APP_CONFIG.OUTPUT_WIDTH * 2,
      height: APP_CONFIG.OUTPUT_HEIGHT * 2,
      imageSmoothingEnabled: true,
      imageSmoothingQuality: 'high',
    });
    // Save original for comparator
    originalCroppedCanvas = document.createElement('canvas');
    originalCroppedCanvas.width = croppedCanvas.width;
    originalCroppedCanvas.height = croppedCanvas.height;
    originalCroppedCanvas.getContext('2d').drawImage(croppedCanvas, 0, 0);

    hideOv();
    go('#s-data');
    runPipeline();
  }, 200);
});

$('#btnBack2').addEventListener('click', () => go('#s-crop'));

// ── Method tabs ──
$$('#methodTabs .mtab').forEach(tab => {
  tab.addEventListener('click', () => {
    $$('#methodTabs .mtab').forEach(t => t.classList.remove('on'));
    tab.classList.add('on');
    const m = tab.dataset.m;
    APP_CONFIG.PROCESSING.method = m;
    $('#ctrlAdaptive').style.display = m === 'adaptive' ? '' : 'none';
    $('#ctrlOtsu').style.display = m === 'otsu' ? '' : 'none';
    $('#ctrlManual').style.display = m === 'manual' ? '' : 'none';
    runPipeline();
  });
});

// ── Sliders ──
function bindSlider(rId, vId, key) {
  $(`#${rId}`).addEventListener('input', function () {
    $(`#${vId}`).textContent = this.value;
    APP_CONFIG.PROCESSING[key] = parseInt(this.value);
    runPipeline();
  });
}
bindSlider('rBlock', 'vBlock', 'adaptiveBlockSize');
bindSlider('rC', 'vC', 'adaptiveC');
bindSlider('rThresh', 'vThresh', 'manualThreshold');
bindSlider('rBlur', 'vBlur', 'gaussianBlur');
bindSlider('rMorph', 'vMorph', 'morphKernelSize');

// ── Toggles ──
function bindToggle(id, key) {
  $(`#${id}`).addEventListener('click', function () {
    this.classList.toggle('on');
    APP_CONFIG.PROCESSING[key] = this.classList.contains('on');
    if (id === 'tMorph') $('#morphCtrl').style.display = this.classList.contains('on') ? '' : 'none';
    if (id === 'tTransparent') updateTransparentBg();
    runPipeline();
  });
}
bindToggle('tClahe', 'contrastEnhance');
bindToggle('tMorph', 'morphCleanup');
bindToggle('tAutoCrop', 'autoCrop');
bindToggle('tPerspective', 'perspectiveCorrection');
bindToggle('tTransparent', 'transparentBackground');

function updateTransparentBg() {
  const isT = APP_CONFIG.PROCESSING.transparentBackground;
  const preview = $('.sig-preview');
  preview.classList.toggle('transparent-bg', isT);
}

function updatePreviewLabel() {
  const W = APP_CONFIG.OUTPUT_WIDTH, H = APP_CONFIG.OUTPUT_HEIGHT;
  const fmt = APP_CONFIG.PROCESSING.transparentBackground ? 'PNG (alpha)' : 'PNG';
  $('#prevLbl').textContent = `${W} × ${H} px · ${fmt}`;
}

// ══════════════════════════════════════════════════
// PIPELINE
// ══════════════════════════════════════════════════
let _pt = null;
function runPipeline() {
  clearTimeout(_pt);
  _pt = setTimeout(_exec, 80);
}

function _exec() {
  if (!croppedCanvas) return;

  // Try worker first for heavy processing
  if (worker && workerReady) {
    const ctx = croppedCanvas.getContext('2d');
    const imgData = ctx.getImageData(0, 0, croppedCanvas.width, croppedCanvas.height);
    showOv('Procesando firma...');
    worker.postMessage({
      type: 'process',
      imageData: imgData.data.buffer,
      width: croppedCanvas.width,
      height: croppedCanvas.height,
      config: {
        OUTPUT_WIDTH: APP_CONFIG.OUTPUT_WIDTH,
        OUTPUT_HEIGHT: APP_CONFIG.OUTPUT_HEIGHT,
        PROCESSING: { ...APP_CONFIG.PROCESSING },
      },
    }, [imgData.data.buffer]);
    return;
  }

  // Main thread processing
  runPipelineMainThread();
}

function runPipelineMainThread() {
  if (!croppedCanvas) return;
  const P = APP_CONFIG.PROCESSING;
  const W = APP_CONFIG.OUTPUT_WIDTH;
  const H = APP_CONFIG.OUTPUT_HEIGHT;

  if (cvReady) {
    const result = cvPipeline(croppedCanvas, P);
    pipelineLog = result.log;
    renderToCanvas($('#prevCanvas'), result);
  } else {
    const result = fallbackPipeline(croppedCanvas, P);
    pipelineLog = result.log;
    const canvas = $('#prevCanvas');
    canvas.width = W;
    canvas.height = H;
    canvas.getContext('2d').drawImage(result.canvas, 0, 0);
  }
  updatePreviewLabel();
  updateTransparentBg();
}

// ── Comparator ──
$('#btnCompare').addEventListener('click', () => {
  const comp = $('#comparator');
  if (comp.style.display === 'block') {
    comp.style.display = 'none';
    return;
  }
  comp.style.display = 'block';
  initComparator();
});

function initComparator() {
  if (!originalCroppedCanvas || !$('#prevCanvas')) return;
  const W = APP_CONFIG.OUTPUT_WIDTH, H = APP_CONFIG.OUTPUT_HEIGHT;

  // Original (before) canvas
  const beforeCanvas = $('#compBefore');
  beforeCanvas.width = W;
  beforeCanvas.height = H;
  beforeCanvas.getContext('2d').drawImage(originalCroppedCanvas, 0, 0, W, H);

  // Processed (after) canvas
  const afterCanvas = $('#compAfter');
  afterCanvas.width = W;
  afterCanvas.height = H;
  afterCanvas.getContext('2d').drawImage($('#prevCanvas'), 0, 0, W, H);

  // Set initial position
  const container = $('#comparator');
  const handle = $('#compHandle');
  const overlay = $('#compOverlay');
  let pos = 0.5;

  function updatePos(x) {
    const rect = container.getBoundingClientRect();
    pos = Math.max(0.02, Math.min(0.98, (x - rect.left) / rect.width));
    overlay.style.width = `${pos * 100}%`;
    handle.style.left = `${pos * 100}%`;
  }

  updatePos(container.getBoundingClientRect().left + container.getBoundingClientRect().width / 2);

  const onMove = e => {
    const x = e.touches ? e.touches[0].clientX : e.clientX;
    updatePos(x);
  };
  const onUp = () => {
    document.removeEventListener('mousemove', onMove);
    document.removeEventListener('mouseup', onUp);
    document.removeEventListener('touchmove', onMove);
    document.removeEventListener('touchend', onUp);
  };

  handle.onmousedown = handle.ontouchstart = e => {
    e.preventDefault();
    document.addEventListener('mousemove', onMove);
    document.addEventListener('mouseup', onUp);
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onUp);
  };
}

// ══════════════════════════════════════════════════
// CÉDULA INPUT
// ══════════════════════════════════════════════════
$('#ciInput').addEventListener('input', e => {
  e.target.value = formatCI(e.target.value);
  $('#btnSave').disabled = !isValidCI(e.target.value);
});

// ══════════════════════════════════════════════════
// SCREEN 4: RESULT
// ══════════════════════════════════════════════════
$('#btnSave').addEventListener('click', async () => {
  haptic(25);
  const W = APP_CONFIG.OUTPUT_WIDTH, H = APP_CONFIG.OUTPUT_HEIGHT;
  const ci = $('#ciInput').value.trim();
  const ciClean = getDigits(ci);

  // Copy to result canvas
  const rc = $('#resCanvas');
  rc.width = W;
  rc.height = H;
  rc.getContext('2d').drawImage($('#prevCanvas'), 0, 0, W, H);

  // Update transparent bg class
  const resImg = $('.res-img');
  resImg.classList.toggle('transparent-bg', APP_CONFIG.PROCESSING.transparentBackground);

  // Update meta
  $('#resCi').textContent = ci;
  $('#resDim').textContent = `${W} × ${H} px`;
  const fn = `${APP_CONFIG.FILE_PREFIX}_${ciClean}.png`;
  $('#resFn').textContent = fn;

  // Pipeline log
  $('#pipeLog').innerHTML =
    '<div class="proc-title" style="margin-bottom:6px"><svg viewBox="0 0 24 24" style="width:12px;height:12px;stroke:var(--accent);fill:none;stroke-width:2"><polyline points="20 6 9 17 4 12"/></svg>Pipeline aplicado</div>' +
    pipelineLog.map((s, i) => `<div class="pipe-step"><b>${i + 1}.</b> ${s}</div>`).join('');

  // Save to IndexedDB
  try {
    const blob = await canvasToBlob(rc);
    const reader = new FileReader();
    reader.onload = async () => {
      await saveSignature({
        imageData: reader.result,
        cedula: ci,
        method: APP_CONFIG.PROCESSING.method,
        pipelineLog: [...pipelineLog],
        width: W,
        height: H,
      });
      updateHistoryBadge();
    };
    reader.readAsDataURL(blob);
  } catch (_) { /* IndexedDB may not be available */ }

  // Batch count
  if (batchMode) {
    batchCount++;
    updateBatchBar();
  }

  go('#s-result');

  // Show/hide share button
  $('#btnShare').style.display = canShare() ? '' : 'none';
});

// ── Download ──
$('#btnDl').addEventListener('click', async () => {
  haptic();
  const ci = getDigits($('#ciInput').value);
  const fn = `${APP_CONFIG.FILE_PREFIX}_${ci}.png`;
  const blob = await canvasToBlob($('#resCanvas'));
  downloadBlob(blob, fn);
});

// ── Share ──
$('#btnShare').addEventListener('click', async () => {
  haptic();
  try {
    const ci = getDigits($('#ciInput').value);
    const fn = `${APP_CONFIG.FILE_PREFIX}_${ci}.png`;
    const blob = await canvasToBlob($('#resCanvas'));
    await shareFile(blob, fn);
  } catch (_) { /* user cancelled or not supported */ }
});

// ── New signature ──
$('#btnNew').addEventListener('click', () => {
  resetCapture();
  go('#s-capture');
});

// ── Batch: next signature ──
$('#btnBatchNext').addEventListener('click', () => {
  resetCapture();
  go('#s-capture');
});

function resetCapture() {
  $('#capImg').src = '';
  $('#capZone').classList.remove('has');
  $('#camIn').value = '';
  $('#ciInput').value = '';
  $('#btnCrop').disabled = true;
  $('#btnSave').disabled = true;
  croppedCanvas = null;
  originalCroppedCanvas = null;
  pipelineLog = [];
  if (cropper) { cropper.destroy(); cropper = null; }
  $('#comparator').style.display = 'none';
}

// ══════════════════════════════════════════════════
// BATCH MODE
// ══════════════════════════════════════════════════
$('#btnBatch').addEventListener('click', () => {
  batchMode = true;
  batchCount = 0;
  updateBatchBar();
  resetCapture();
  go('#s-capture');
});

$('#batchClose').addEventListener('click', () => {
  batchMode = false;
  updateBatchBar();
});

function updateBatchBar() {
  const bar = $('#batchBar');
  bar.classList.toggle('on', batchMode);
  if (batchMode) {
    $('#batchNum').textContent = batchCount;
  }
  // Show/hide batch-specific buttons
  $('#btnBatchNext').style.display = batchMode ? '' : 'none';
}

// ══════════════════════════════════════════════════
// HISTORY
// ══════════════════════════════════════════════════
$('#btnHistory').addEventListener('click', () => {
  go('#s-history');
  loadHistory();
});

$('#btnHistBack').addEventListener('click', () => go('#s-capture'));

$('#btnHistClear').addEventListener('click', () => {
  showConfirm('¿Eliminar todo el historial?', async () => {
    await clearAllSignatures();
    loadHistory();
    updateHistoryBadge();
  });
});

async function loadHistory() {
  const list = $('#histList');
  try {
    const sigs = await getAllSignatures();
    if (sigs.length === 0) {
      list.innerHTML = `<div class="hist-empty">
        <svg viewBox="0 0 24 24"><path d="M12 8v4l3 3"/><circle cx="12" cy="12" r="10"/></svg>
        <p>No hay firmas guardadas</p>
      </div>`;
      return;
    }
    list.innerHTML = sigs.map(s => `
      <div class="hist-item" data-id="${s.id}">
        <img class="hist-thumb${s.pipelineLog?.some(l => l.includes('transparente')) ? ' transparent-bg' : ''}" src="${s.imageData}" alt="">
        <div class="hist-info">
          <div class="hist-ci">${s.cedula || '—'}</div>
          <div class="hist-date">${formatDate(s.date)}</div>
          <div class="hist-method">${s.method || ''}</div>
        </div>
        <div class="hist-actions">
          <button class="hist-act dl" title="Descargar"><svg viewBox="0 0 24 24"><path d="M21 15v4a2 2 0 01-2 2H5a2 2 0 01-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg></button>
          <button class="hist-act del" title="Eliminar"><svg viewBox="0 0 24 24"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 01-2 2H8a2 2 0 01-2-2L5 6m3 0V4a2 2 0 012-2h4a2 2 0 012 2v2"/></svg></button>
        </div>
      </div>
    `).join('');

    // Event delegation for history actions
    list.querySelectorAll('.hist-act.dl').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const item = btn.closest('.hist-item');
        const sig = sigs.find(s => s.id === parseInt(item.dataset.id));
        if (sig) downloadFromDataURL(sig.imageData, `${APP_CONFIG.FILE_PREFIX}_${getDigits(sig.cedula)}.png`);
      });
    });

    list.querySelectorAll('.hist-act.del').forEach(btn => {
      btn.addEventListener('click', e => {
        e.stopPropagation();
        const item = btn.closest('.hist-item');
        const id = parseInt(item.dataset.id);
        showConfirm('¿Eliminar esta firma?', async () => {
          await deleteSignature(id);
          item.remove();
          updateHistoryBadge();
          const remaining = list.querySelectorAll('.hist-item');
          if (remaining.length === 0) loadHistory();
        });
      });
    });
  } catch (_) {
    list.innerHTML = '<div class="hist-empty"><p>Error al cargar historial</p></div>';
  }
}

function downloadFromDataURL(dataURL, filename) {
  const a = document.createElement('a');
  a.href = dataURL;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

async function updateHistoryBadge() {
  try {
    const count = await getCount();
    const badge = $('#histBadge');
    if (count > 0) {
      badge.textContent = count;
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  } catch (_) {}
}

// ══════════════════════════════════════════════════
// CONFIRM DIALOG
// ══════════════════════════════════════════════════
let confirmCallback = null;

function showConfirm(message, onConfirm) {
  confirmCallback = onConfirm;
  $('#confirmMsg').textContent = message;
  $('#confirmDialog').classList.add('on');
}

$('#confirmYes').addEventListener('click', () => {
  $('#confirmDialog').classList.remove('on');
  if (confirmCallback) confirmCallback();
  confirmCallback = null;
});

$('#confirmNo').addEventListener('click', () => {
  $('#confirmDialog').classList.remove('on');
  confirmCallback = null;
});

// ══════════════════════════════════════════════════
// PWA INSTALL
// ══════════════════════════════════════════════════
window.addEventListener('beforeinstallprompt', e => {
  e.preventDefault();
  deferredInstallPrompt = e;
  $('#installBanner').classList.add('on');
});

$('#btnInstall').addEventListener('click', async () => {
  if (!deferredInstallPrompt) return;
  deferredInstallPrompt.prompt();
  const result = await deferredInstallPrompt.userChoice;
  if (result.outcome === 'accepted') {
    $('#installBanner').classList.remove('on');
  }
  deferredInstallPrompt = null;
});

$('#installDismiss').addEventListener('click', () => {
  $('#installBanner').classList.remove('on');
  deferredInstallPrompt = null;
});

window.addEventListener('appinstalled', () => {
  $('#installBanner').classList.remove('on');
  deferredInstallPrompt = null;
});

// ══════════════════════════════════════════════════
// SERVICE WORKER REGISTRATION
// ══════════════════════════════════════════════════
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('sw.js').catch(() => {});
}

// ══════════════════════════════════════════════════
// INIT
// ══════════════════════════════════════════════════
$('#szLbl').textContent = `${APP_CONFIG.OUTPUT_WIDTH}×${APP_CONFIG.OUTPUT_HEIGHT}`;
$('#btnBatchNext').style.display = 'none';
$('#btnShare').style.display = 'none';
updateBatchBar();
updateHistoryBadge();
initWorker();
