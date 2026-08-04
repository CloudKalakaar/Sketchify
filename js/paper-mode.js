/**
 * paper-mode.js — AR Paper Tracing Engine
 *
 * Features:
 * - High-performance camera feed rendering
 * - Smooth semi-transparent sketch overlay
 * - Touch gestures: Drag to pan, Pinch to zoom/scale
 * - Gyro-Assisted AR Paper Lock:
 *   When Lock is tapped, captures the baseline orientation of the phone.
 *   As the user tilts/moves the phone over the paper, the overlay counter-shifts
 *   so the sketch stays anchored to the paper surface!
 * - Quick Zoom (+ / -) & Freeze View (still frame mode)
 * - 100% universal canvas API
 */

class PaperMode {
  constructor(canvasEl) {
    this.canvas = canvasEl;
    this.ctx    = canvasEl.getContext('2d');

    // Video stream element
    this.video = document.createElement('video');
    this.video.setAttribute('playsinline', '');
    this.video.setAttribute('autoplay', '');
    this.video.muted = true;
    this.cam = new CameraManager(this.video);

    this.overlayImage = null;
    this.opacity      = 0.35;
    this.isLocked     = false;
    this.isFrozen     = false;

    // Transform state
    this.scale = 1.0;
    this.panX  = 0;
    this.panY  = 0;

    // Gyro orientation state
    this._curBeta   = 0;
    this._curGamma  = 0;
    this._curAlpha  = 0;
    this._baseBeta  = 0;
    this._baseGamma = 0;
    this._baseAlpha = 0;
    this._basePanX  = 0;
    this._basePanY  = 0;

    this._orientHandler = (e) => {
      this._curBeta  = e.beta  || 0;
      this._curGamma = e.gamma || 0;
      this._curAlpha = e.alpha || 0;
    };

    // Off-screen canvas for freeze-frame camera snapshot
    this._freezeCanvas = document.createElement('canvas');
    this._freezeCtx    = this._freezeCanvas.getContext('2d');

    // Touch gesture tracking
    this._touchStartDist  = 0;
    this._touchStartScale = 1.0;
    this._lastTouchX      = 0;
    this._lastTouchY      = 0;
    this._isDragging      = false;

    this._rafId     = null;
    this._scanPhase = 0;

    this._bindTouchEvents();
  }

  /* ═══════════════════════════════════════════════════
     PUBLIC API
  ═══════════════════════════════════════════════════ */

  async start(imageObj) {
    this.overlayImage = imageObj;
    this.isLocked     = false;
    this.isFrozen     = false;
    this.scale        = 1.0;
    this.panX         = 0;
    this.panY         = 0;

    this._resizeCanvas();
    this._resizeBound = () => this._resizeCanvas();
    window.addEventListener('resize', this._resizeBound);
    window.addEventListener('deviceorientation', this._orientHandler);

    await this.cam.start();
    this._loop();
    return true;
  }

  stop() {
    if (this._rafId) cancelAnimationFrame(this._rafId);
    this._rafId = null;
    this.cam.stop();
    window.removeEventListener('deviceorientation', this._orientHandler);
    if (this._resizeBound) window.removeEventListener('resize', this._resizeBound);
  }

  setOpacity(v) {
    this.opacity = Math.max(0.05, Math.min(1.0, v));
  }

  lock() {
    this.isLocked   = true;
    this._baseBeta  = this._curBeta;
    this._baseGamma = this._curGamma;
    this._baseAlpha = this._curAlpha;
    this._basePanX  = this.panX;
    this._basePanY  = this.panY;

    if (typeof DeviceOrientationEvent !== 'undefined' && typeof DeviceOrientationEvent.requestPermission === 'function') {
      try { DeviceOrientationEvent.requestPermission(); } catch (e) {}
    }

    if (navigator.vibrate) {
      try { navigator.vibrate([30, 20, 60]); } catch (e) {}
    }
    return true;
  }

  unlock() {
    this.isLocked = false;
  }

  toggleFreeze() {
    if (!this.isFrozen) {
      if (this.video && this.video.videoWidth && this.video.videoHeight) {
        this._freezeCanvas.width  = this.canvas.width;
        this._freezeCanvas.height = this.canvas.height;
        this.cam.drawFrame(this._freezeCtx, this.canvas.width, this.canvas.height);
      }
      this.isFrozen = true;
    } else {
      this.isFrozen = false;
    }
    return this.isFrozen;
  }

  zoomIn() {
    this.scale = Math.min(5.0, this.scale * 1.25);
  }

  zoomOut() {
    this.scale = Math.max(0.2, this.scale / 1.25);
  }

  resetTransform() {
    this.scale = 1.0;
    this.panX  = 0;
    this.panY  = 0;
    this._basePanX = 0;
    this._basePanY = 0;
    this._baseBeta  = this._curBeta;
    this._baseGamma = this._curGamma;
  }

  /* ═══════════════════════════════════════════════════
     TOUCH GESTURES (PAN & PINCH-TO-ZOOM)
  ═══════════════════════════════════════════════════ */

  _bindTouchEvents() {
    const el = this.canvas;

    el.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) {
        this._isDragging = true;
        this._lastTouchX = e.touches[0].clientX;
        this._lastTouchY = e.touches[0].clientY;
      } else if (e.touches.length === 2) {
        this._isDragging = false;
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        this._touchStartDist  = Math.hypot(dx, dy);
        this._touchStartScale = this.scale;
      }
    }, { passive: true });

    el.addEventListener('touchmove', (e) => {
      if (e.touches.length === 1 && this._isDragging) {
        const cx = e.touches[0].clientX;
        const cy = e.touches[0].clientY;
        const dx = cx - this._lastTouchX;
        const dy = cy - this._lastTouchY;
        this.panX += dx;
        this.panY += dy;
        if (this.isLocked) {
          this._basePanX += dx;
          this._basePanY += dy;
        }
        this._lastTouchX = cx;
        this._lastTouchY = cy;
      } else if (e.touches.length === 2 && this._touchStartDist > 0) {
        const dx = e.touches[0].clientX - e.touches[1].clientX;
        const dy = e.touches[0].clientY - e.touches[1].clientY;
        const dist = Math.hypot(dx, dy);
        const factor = dist / this._touchStartDist;
        this.scale = Math.max(0.2, Math.min(5.0, this._touchStartScale * factor));
      }
    }, { passive: true });

    el.addEventListener('touchend', () => {
      this._isDragging = false;
      this._touchStartDist = 0;
    }, { passive: true });
  }

  /* ═══════════════════════════════════════════════════
     RENDER LOOP
  ═══════════════════════════════════════════════════ */

  _resizeCanvas() {
    this.canvas.width  = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  _loop() {
    this._rafId = requestAnimationFrame(() => this._loop());
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);

    // 1. Draw Background (Live Camera stream or Frozen Frame)
    if (this.isFrozen && this._freezeCanvas.width) {
      ctx.drawImage(this._freezeCanvas, 0, 0);
    } else {
      this.cam.drawFrame(ctx, canvas.width, canvas.height);
    }

    // 2. Draw Transformed Sketch Overlay
    if (this.overlayImage) {
      this._drawOverlay();
    }

    // 3. Draw AR HUD Brackets & Status
    this._drawHUD();
  }

  _drawOverlay() {
    const { ctx, canvas, overlayImage: img } = this;
    const W = canvas.width, H = canvas.height;

    // Base fit scale
    const baseFit = Math.min(W / img.width, H / img.height) * 0.90;
    const iw = img.width  * baseFit * this.scale;
    const ih = img.height * baseFit * this.scale;

    let activePanX = this.panX;
    let activePanY = this.panY;

    // Gyro spatial lock adjustment
    if (this.isLocked && !this.isFrozen) {
      let dBeta  = this._curBeta  - this._baseBeta;
      let dGamma = this._curGamma - this._baseGamma;

      // Handle angle wrap-around (-180 to 180)
      if (dGamma >  180) dGamma -= 360;
      if (dGamma < -180) dGamma += 360;
      if (dBeta  >  180) dBeta  -= 360;
      if (dBeta  < -180) dBeta  += 360;

      // Sensitivity (pixels shift per degree of tilt)
      const SENSITIVITY = Math.min(W, H) * 0.035;

      // Counter-shift pan offsets so sketch remains pinned over paper surface
      activePanX = this._basePanX - (dGamma * SENSITIVITY);
      activePanY = this._basePanY - (dBeta  * SENSITIVITY);
      this.panX = activePanX;
      this.panY = activePanY;
    }

    ctx.save();
    ctx.globalAlpha = this.opacity;

    // Position at canvas center + active pan offsets
    const cx = W / 2 + activePanX;
    const cy = H / 2 + activePanY;

    ctx.translate(cx, cy);
    ctx.drawImage(img, -iw / 2, -ih / 2, iw, ih);

    ctx.restore();
  }

  _drawHUD() {
    const { ctx, canvas } = this;
    const W = canvas.width, H = canvas.height;
    const bSize = 36, bThick = 3, margin = 28;
    const col = this.isLocked ? '#22c55e' : '#A78BFA';

    this._scanPhase = (this._scanPhase + 1) % 120;
    const alpha = this.isLocked ? 1 : 0.5 + 0.5 * Math.sin(this._scanPhase * (Math.PI / 60));

    // Corner brackets
    ctx.save();
    ctx.strokeStyle = col;
    ctx.lineWidth   = bThick;
    ctx.globalAlpha = alpha;
    ctx.lineCap     = 'round';

    const corners = [
      [margin,     margin,      1,  1],
      [W - margin, margin,     -1,  1],
      [margin,     H - margin,  1, -1],
      [W - margin, H - margin, -1, -1]
    ];
    for (const [x, y, sx, sy] of corners) {
      ctx.beginPath();
      ctx.moveTo(x + sx * bSize, y);
      ctx.lineTo(x, y);
      ctx.lineTo(x, y + sy * bSize);
      ctx.stroke();
    }
    ctx.restore();

    // Lock & Zoom Status Badge
    if (this.isLocked) {
      ctx.save();
      ctx.fillStyle = 'rgba(0,0,0,0.65)';
      ctx.beginPath();
      var rx = W / 2 - 70, ry = margin - 6, rw = 140, rh = 30, rad = 15;
      ctx.moveTo(rx + rad, ry);
      ctx.lineTo(rx + rw - rad, ry);
      ctx.arcTo(rx + rw, ry, rx + rw, ry + rad, rad);
      ctx.lineTo(rx + rw, ry + rh - rad);
      ctx.arcTo(rx + rw, ry + rh, rx + rw - rad, ry + rh, rad);
      ctx.lineTo(rx + rad, ry + rh);
      ctx.arcTo(rx, ry + rh, rx, ry + rh - rad, rad);
      ctx.lineTo(rx, ry + rad);
      ctx.arcTo(rx, ry, rx + rad, ry, rad);
      ctx.closePath();
      ctx.fill();

      ctx.fillStyle    = '#22c55e';
      ctx.font         = 'bold 13px Inter, sans-serif';
      ctx.textAlign    = 'center';
      ctx.textBaseline = 'middle';
      const zoomTxt = this.scale !== 1.0 ? ' · ' + Math.round(this.scale * 100) + '%' : '';
      ctx.fillText('🔒 PAPER LOCKED' + zoomTxt, W / 2, margin + 9);
      ctx.restore();
    }
  }
}
