/**
 * app.js — Sketchify
 * All event listeners are wired ONCE at boot. State drives behavior.
 * No cloneNode, no module imports.
 */

var currentImage = null;
var paperMode    = null;
var wallMode     = null;

/* ─── Screen router ─────────────────────────────── */
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(function(s) { s.classList.remove('active'); });
  var el = document.getElementById('screen-' + id);
  if (el) el.classList.add('active');
}

/* ─── Toast ─────────────────────────────────────── */
function showToast(msg, type) {
  var c = document.getElementById('toast-container');
  var t = document.createElement('div');
  t.className = 'toast' + (type ? ' ' + type : '');
  t.textContent = msg;
  c.appendChild(t);
  requestAnimationFrame(function() { t.classList.add('visible'); });
  setTimeout(function() {
    t.classList.remove('visible');
    setTimeout(function() { if (t.parentNode) t.remove(); }, 400);
  }, 3200);
}

/* ─── Image loader ──────────────────────────────── */
function loadImageFile(file) {
  return new Promise(function(resolve, reject) {
    var reader = new FileReader();
    reader.onload = function(e) {
      var img = new Image();
      img.onload  = function() { resolve(img); };
      img.onerror = reject;
      img.src = e.target.result;
    };
    reader.onerror = reject;
    reader.readAsDataURL(file);
  });
}

/* ─── HOME ──────────────────────────────────────── */
function initHome() {
  document.getElementById('start-btn').addEventListener('click', function() {
    showScreen('picker');
  });
  document.getElementById('settings-btn').addEventListener('click', function() {
    showScreen('settings');
  });
}

/* ─── PICKER ────────────────────────────────────── */
function initPicker() {
  var fileInput = document.getElementById('file-input');
  var dropZone  = document.getElementById('drop-zone');
  var previewEl = document.getElementById('preview-img');
  var paperBtn  = document.getElementById('mode-paper-btn');
  var wallBtn   = document.getElementById('mode-wall-btn');

  document.getElementById('picker-back').addEventListener('click', function() {
    currentImage = null;
    dropZone.classList.remove('has-image');
    previewEl.src = '';
    paperBtn.classList.add('locked');
    wallBtn.classList.add('locked');
    showScreen('home');
  });

  document.getElementById('change-img-btn').addEventListener('click', function(e) {
    e.stopPropagation();
    fileInput.click();
  });

  fileInput.addEventListener('change', function(e) {
    var f = e.target.files[0];
    if (!f) return;
    fileInput.value = '';
    if (!f.type.startsWith('image/')) { showToast('Please select a valid image.', 'error'); return; }
    loadImageFile(f).then(function(img) {
      currentImage = img;
      previewEl.src = img.src;
      dropZone.classList.add('has-image');
      paperBtn.classList.remove('locked');
      wallBtn.classList.remove('locked');
    }).catch(function() { showToast('Could not load image.', 'error'); });
  });

  paperBtn.addEventListener('click', function() {
    if (!currentImage) { showToast('Select an image first.', ''); return; }
    startPaperMode();
  });

  wallBtn.addEventListener('click', function() {
    if (!currentImage) { showToast('Select an image first.', ''); return; }
    startWallMode();
  });
}

/* ─── PAPER MODE ────────────────────────────────── */
var paperLockBtn, paperStatus, paperSlider, paperSliderVal;

function initPaperScreen() {
  paperLockBtn   = document.getElementById('lock-btn');
  paperStatus    = document.getElementById('lock-status');
  paperSlider    = document.getElementById('paper-opacity');
  paperSliderVal = document.getElementById('paper-op-val');

  paperSlider.addEventListener('input', function() {
    setSliderFill(paperSlider);
    if (paperSliderVal) paperSliderVal.textContent = paperSlider.value + '%';
    if (paperMode) paperMode.setOpacity(paperSlider.value / 100);
  });

  paperLockBtn.addEventListener('click', function() {
    if (!paperMode) return;
    if (!paperMode.isLocked) {
      var locked = paperMode.lock();
      if (locked) {
        paperLockBtn.classList.remove('scanning');
        paperLockBtn.classList.add('locked');
        paperLockBtn.textContent = '🔒';
        paperStatus.textContent  = 'Locked — move camera to track!';
        paperStatus.className    = 'lock-status locked';
      } else {
        showToast('Camera not ready yet — wait a moment and try again.', 'error');
      }
    } else {
      paperMode.unlock();
      paperLockBtn.classList.remove('locked');
      paperLockBtn.classList.add('scanning');
      paperLockBtn.textContent = '🎯';
      paperStatus.textContent  = 'Point at paper, then tap Lock';
      paperStatus.className    = 'lock-status';
    }
  });

  function exitPaper() {
    if (paperMode) { paperMode.stop(); paperMode = null; }
    resetPaperUI();
    showScreen('picker');
  }

  document.getElementById('paper-done-btn').addEventListener('click', exitPaper);
  document.getElementById('paper-back').addEventListener('click', exitPaper);
}

function resetPaperUI() {
  if (!paperLockBtn) return;
  paperLockBtn.classList.remove('scanning', 'locked');
  paperLockBtn.textContent = '🎯';
  paperStatus.textContent  = 'Hold steady over paper, then tap Lock';
  paperStatus.className    = 'lock-status';
  paperSlider.value        = 30;
  setSliderFill(paperSlider);
  if (paperSliderVal) paperSliderVal.textContent = '30%';
}

function startPaperMode() {
  resetPaperUI();
  paperLockBtn.classList.add('scanning');
  showScreen('paper');

  paperMode = new PaperMode(document.getElementById('ar-canvas-paper'));
  paperMode.start(currentImage).then(function(ok) {
    if (!ok) {
      showToast('Camera access denied. Allow camera and try again.', 'error');
      if (paperMode) { paperMode.stop(); paperMode = null; }
      showScreen('picker');
    }
  });
}

/* ─── WALL MODE ─────────────────────────────────── */
var wallCellDisp, wallProgFill, wallSlider, wallCurrentGrid;

function initWallScreen() {
  wallCellDisp    = document.getElementById('cell-display');
  wallProgFill    = document.getElementById('progress-fill');
  wallSlider      = document.getElementById('wall-opacity');
  wallCurrentGrid = 3;

  wallSlider.addEventListener('input', function() {
    setSliderFill(wallSlider);
    if (wallMode) wallMode.setOpacity(wallSlider.value / 100);
  });

  document.querySelectorAll('.gs-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      if (!wallMode) return;
      document.querySelectorAll('.gs-btn').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      wallCurrentGrid = parseInt(btn.dataset.size);
      wallMode.setGridSize(wallCurrentGrid);
      updateWallCellUI(0, wallCurrentGrid * wallCurrentGrid, 0);
    });
  });

  document.getElementById('wall-prev-btn').addEventListener('click', function() { if (wallMode) wallMode.prevCell(); });
  document.getElementById('wall-next-btn').addEventListener('click', function() { if (wallMode) wallMode.nextCell(); });
  document.getElementById('wall-done-btn').addEventListener('click', function() { if (wallMode) wallMode.markDone(); });

  function exitWall() {
    if (wallMode) { wallMode.stop(); wallMode = null; }
    resetWallUI();
    showScreen('picker');
  }

  document.getElementById('wall-finish-btn').addEventListener('click', exitWall);
  document.getElementById('wall-back').addEventListener('click', exitWall);
}

function updateWallCellUI(sel, total, done) {
  if (wallCellDisp) wallCellDisp.textContent = 'Cell ' + (sel + 1) + ' / ' + total;
  if (wallProgFill) wallProgFill.style.width  = (total > 0 ? (done / total * 100) : 0).toFixed(1) + '%';
  if (done > 0 && done === total) showToast('All sections traced! 🎉', 'success');
}

function resetWallUI() {
  document.querySelectorAll('.gs-btn').forEach(function(b, i) { b.classList.toggle('active', i === 0); });
  wallCurrentGrid = 3;
  if (wallSlider) { wallSlider.value = 28; setSliderFill(wallSlider); }
  updateWallCellUI(0, 9, 0);
}

function startWallMode() {
  resetWallUI();
  showScreen('wall');

  wallMode = new WallMode(document.getElementById('ar-canvas-wall'));
  wallMode.onCellChange(updateWallCellUI);

  wallMode.start(currentImage, 3).then(function(ok) {
    if (!ok) {
      showToast('Camera access denied.', 'error');
      if (wallMode) { wallMode.stop(); wallMode = null; }
      showScreen('picker');
      return;
    }
    updateWallCellUI(0, 9, 0);
  });
}

/* ─── SETTINGS ──────────────────────────────────── */
function initSettings() {
  document.getElementById('settings-back').addEventListener('click', function() { showScreen('home'); });
  document.getElementById('clear-cache-btn').addEventListener('click', function() {
    if (!('caches' in window)) { showToast('Cache API not available.', ''); return; }
    caches.keys().then(function(keys) {
      return Promise.all(keys.map(function(k) { return caches.delete(k); }));
    }).then(function() { showToast('Cache cleared! Reload to update.', 'success'); });
  });
}

/* ─── Slider fill helper ────────────────────────── */
function setSliderFill(slider) {
  var pct = ((slider.value - slider.min) / (slider.max - slider.min) * 100).toFixed(1);
  slider.style.setProperty('--val', pct + '%');
}

/* ─── BOOT ──────────────────────────────────────── */
document.addEventListener('DOMContentLoaded', function() {
  registerSW();
  initHome();
  initPicker();
  initPaperScreen();   // wires all paper listeners once
  initWallScreen();    // wires all wall listeners once
  initSettings();
  showScreen('home');
});
