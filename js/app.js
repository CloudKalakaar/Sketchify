/**
 * app.js — Sketchify main orchestrator (no ES modules, all globals)
 */

// ── State ─────────────────────────────────────────────────────────
var currentImage = null;
var paperMode    = null;
var wallMode     = null;

// ── Screen Router ──────────────────────────────────────────────────
function showScreen(id) {
  document.querySelectorAll('.screen').forEach(function(s) { s.classList.remove('active'); });
  var el = document.getElementById('screen-' + id);
  if (el) el.classList.add('active');
}

// ── Toast ──────────────────────────────────────────────────────────
function showToast(msg, type) {
  var c = document.getElementById('toast-container');
  var t = document.createElement('div');
  t.className = 'toast' + (type ? ' ' + type : '');
  t.textContent = msg;
  c.appendChild(t);
  requestAnimationFrame(function() { t.classList.add('visible'); });
  setTimeout(function() {
    t.classList.remove('visible');
    setTimeout(function() { t.remove(); }, 400);
  }, 3000);
}

// ── Image Loader ───────────────────────────────────────────────────
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

// ── HOME ───────────────────────────────────────────────────────────
function initHome() {
  document.getElementById('start-btn').addEventListener('click', function() {
    showScreen('picker');
  });
  document.getElementById('settings-btn').addEventListener('click', function() {
    showScreen('settings');
  });
}

// ── PICKER ─────────────────────────────────────────────────────────
function initPicker() {
  var fileInput = document.getElementById('file-input');
  var dropZone  = document.getElementById('drop-zone');
  var previewEl = document.getElementById('preview-img');
  var changeBtn = document.getElementById('change-img-btn');
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

  function handleFile(file) {
    if (!file || !file.type.startsWith('image/')) {
      showToast('Please select a valid image file.', 'error');
      return;
    }
    loadImageFile(file).then(function(img) {
      currentImage = img;
      previewEl.src = img.src;
      dropZone.classList.add('has-image');
      paperBtn.classList.remove('locked');
      wallBtn.classList.remove('locked');
    }).catch(function() {
      showToast('Could not load image.', 'error');
    });
  }

  fileInput.addEventListener('change', function(e) {
    if (e.target.files[0]) handleFile(e.target.files[0]);
    fileInput.value = '';
  });

  changeBtn.addEventListener('click', function(e) {
    e.stopPropagation();
    fileInput.click();
  });

  paperBtn.addEventListener('click', function() {
    if (!currentImage) return;
    startPaperMode();
  });

  wallBtn.addEventListener('click', function() {
    if (!currentImage) return;
    startWallMode();
  });
}

// ── PAPER MODE ─────────────────────────────────────────────────────
function startPaperMode() {
  showScreen('paper');

  var canvas    = document.getElementById('ar-canvas-paper');
  var lockBtn   = document.getElementById('lock-btn');
  var statusEl  = document.getElementById('lock-status');
  var opSlider  = document.getElementById('paper-opacity');
  var opValEl   = document.getElementById('paper-op-val');

  // Detach old listeners by cloning
  var newLock = lockBtn.cloneNode(true);
  lockBtn.parentNode.replaceChild(newLock, lockBtn);
  lockBtn = newLock;

  var newDone = document.getElementById('paper-done-btn').cloneNode(true);
  document.getElementById('paper-done-btn').parentNode.replaceChild(newDone, document.getElementById('paper-done-btn'));

  var newBack = document.getElementById('paper-back').cloneNode(true);
  document.getElementById('paper-back').parentNode.replaceChild(newBack, document.getElementById('paper-back'));

  paperMode = new PaperMode(canvas);

  function updateOpSlider() {
    var pct = ((opSlider.value - opSlider.min) / (opSlider.max - opSlider.min) * 100).toFixed(0);
    opSlider.style.setProperty('--val', pct + '%');
    if (opValEl) opValEl.textContent = opSlider.value + '%';
  }
  opSlider.value = 30;
  updateOpSlider();
  opSlider.addEventListener('input', function() {
    if (paperMode) paperMode.setOpacity(opSlider.value / 100);
    updateOpSlider();
  });

  paperMode.start(currentImage).then(function(ok) {
    if (!ok) {
      showToast('Camera access denied.', 'error');
      showScreen('picker');
      return;
    }

    document.getElementById('lock-btn').classList.add('scanning');
    statusEl.textContent = 'Point at your paper, then tap Lock';
    statusEl.className = 'lock-status';

    document.getElementById('lock-btn').addEventListener('click', function() {
      var lb = document.getElementById('lock-btn');
      if (!paperMode) return;
      if (!paperMode.isLocked) {
        paperMode.lock().then(function(locked) {
          if (locked) {
            lb.classList.remove('scanning');
            lb.classList.add('locked');
            lb.innerHTML = '🔒';
            statusEl.textContent = 'Locked — trace away!';
            statusEl.className = 'lock-status locked';
          } else {
            showToast('Orientation permission denied.', 'error');
          }
        });
      } else {
        paperMode.unlock();
        lb.classList.remove('locked');
        lb.classList.add('scanning');
        lb.innerHTML = '🎯';
        statusEl.textContent = 'Point at your paper, then tap Lock';
        statusEl.className = 'lock-status';
      }
    });
  });

  function exitPaper() {
    if (paperMode) { paperMode.stop(); paperMode = null; }
    resetPaperUI();
    showScreen('picker');
  }

  document.getElementById('paper-done-btn').addEventListener('click', exitPaper, { once: true });
  document.getElementById('paper-back').addEventListener('click', exitPaper, { once: true });
}

function resetPaperUI() {
  var lb = document.getElementById('lock-btn');
  if (lb) { lb.classList.remove('scanning', 'locked'); lb.innerHTML = '🎯'; }
  var st = document.getElementById('lock-status');
  if (st) { st.textContent = 'Point at your paper, then tap Lock'; st.className = 'lock-status'; }
}

// ── WALL MODE ──────────────────────────────────────────────────────
function startWallMode() {
  showScreen('wall');

  var canvas   = document.getElementById('ar-canvas-wall');
  var cellDisp = document.getElementById('cell-display');
  var progFill = document.getElementById('progress-fill');
  var opSlider = document.getElementById('wall-opacity');

  // Detach old listeners
  ['wall-finish-btn','wall-back','wall-prev-btn','wall-next-btn','wall-done-btn'].forEach(function(id) {
    var el = document.getElementById(id);
    if (!el) return;
    var newEl = el.cloneNode(true);
    el.parentNode.replaceChild(newEl, el);
  });

  // Reset grid size buttons
  document.querySelectorAll('.gs-btn').forEach(function(b, i) {
    var newB = b.cloneNode(true);
    b.parentNode.replaceChild(newB, b);
    newB.classList.toggle('active', i === 0);
  });

  var wallGridSize = 3;
  wallMode = new WallMode(canvas);

  function updateOpSlider() {
    var pct = ((opSlider.value - opSlider.min) / (opSlider.max - opSlider.min) * 100).toFixed(0);
    opSlider.style.setProperty('--val', pct + '%');
  }
  opSlider.value = 28;
  updateOpSlider();
  opSlider.addEventListener('input', function() {
    if (wallMode) wallMode.setOpacity(opSlider.value / 100);
    updateOpSlider();
  });

  function onCellChange(sel, total, done) {
    cellDisp.textContent = 'Cell ' + (sel + 1) + ' / ' + total;
    progFill.style.width = (total > 0 ? (done / total * 100) : 0).toFixed(1) + '%';
    if (done > 0 && done === total) showToast('All sections traced! Great work! 🎉', 'success');
  }

  wallMode.onCellChange(onCellChange);

  document.querySelectorAll('.gs-btn').forEach(function(btn) {
    btn.addEventListener('click', function() {
      document.querySelectorAll('.gs-btn').forEach(function(b) { b.classList.remove('active'); });
      btn.classList.add('active');
      wallGridSize = parseInt(btn.dataset.size);
      if (wallMode) { wallMode.setGridSize(wallGridSize); onCellChange(0, wallGridSize * wallGridSize, 0); }
    });
  });

  wallMode.start(currentImage, wallGridSize).then(function(ok) {
    if (!ok) {
      showToast('Camera access denied.', 'error');
      showScreen('picker');
      return;
    }
    onCellChange(0, wallGridSize * wallGridSize, 0);

    document.getElementById('wall-prev-btn').addEventListener('click', function() { if (wallMode) wallMode.prevCell(); });
    document.getElementById('wall-next-btn').addEventListener('click', function() { if (wallMode) wallMode.nextCell(); });
    document.getElementById('wall-done-btn').addEventListener('click', function() { if (wallMode) wallMode.markDone(); });

    function exitWall() {
      if (wallMode) { wallMode.stop(); wallMode = null; }
      showScreen('picker');
    }
    document.getElementById('wall-finish-btn').addEventListener('click', exitWall, { once: true });
    document.getElementById('wall-back').addEventListener('click', exitWall, { once: true });
  });
}

// ── SETTINGS ───────────────────────────────────────────────────────
function initSettings() {
  document.getElementById('settings-back').addEventListener('click', function() { showScreen('home'); });
  document.getElementById('clear-cache-btn').addEventListener('click', function() {
    if ('caches' in window) {
      caches.keys().then(function(keys) {
        return Promise.all(keys.map(function(k) { return caches.delete(k); }));
      }).then(function() { showToast('Cache cleared!', 'success'); });
    } else {
      showToast('Cache API not available here.', '');
    }
  });
}

// ── BOOT ───────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', function() {
  registerSW();
  initHome();
  initPicker();
  initSettings();
  showScreen('home');
});
