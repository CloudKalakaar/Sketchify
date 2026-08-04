/**
 * paper-mode.js — AR Paper Tracing (no ES modules)
 */
class PaperMode {
  constructor(canvasEl) {
    this.canvas = canvasEl;
    this.ctx = canvasEl.getContext('2d');
    this.video = document.createElement('video');
    this.video.setAttribute('playsinline', '');
    this.video.muted = true;
    this.cam = new CameraManager(this.video);

    this.overlayImage = null;
    this.opacity = 0.30;
    this.isLocked = false;
    this.baseline = null;
    this.current = { alpha: 0, beta: 0, gamma: 0 };
    this.SENSITIVITY = 6;

    this._rafId = null;
    this._orientHandler = this._onOrientation.bind(this);
    this._scanning = true;
    this._scanPhase = 0;
  }

  async start(imageObj) {
    this.overlayImage = imageObj;
    this.isLocked = false;
    this.baseline = null;
    this._scanning = true;

    this._resizeCanvas();
    this._resizeBound = () => this._resizeCanvas();
    window.addEventListener('resize', this._resizeBound);

    const ok = await this.cam.start();
    if (!ok) return false;

    window.addEventListener('deviceorientation', this._orientHandler);
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

  setOpacity(v) { this.opacity = Math.max(0.05, Math.min(1, v)); }

  async lock() {
    const granted = await requestOrientationPermission();
    if (!granted) return false;
    this.baseline = { ...this.current };
    this.isLocked = true;
    this._scanning = false;
    if (navigator.vibrate) navigator.vibrate([30, 20, 60]);
    return true;
  }

  unlock() {
    this.isLocked = false;
    this.baseline = null;
    this._scanning = true;
  }

  _onOrientation(e) {
    this.current = { alpha: e.alpha || 0, beta: e.beta || 0, gamma: e.gamma || 0 };
  }

  _resizeCanvas() {
    this.canvas.width  = window.innerWidth;
    this.canvas.height = window.innerHeight;
  }

  _loop() {
    this._rafId = requestAnimationFrame(() => this._loop());
    const { ctx, canvas } = this;
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    this.cam.drawFrame(ctx, canvas.width, canvas.height);

    if (this.overlayImage) {
      if (this.isLocked && this.baseline) this._drawLockedOverlay();
      else this._drawCentredOverlay();
    }

    this._drawBrackets();
  }

  _computeTransform() {
    let dAlpha = this.current.alpha - this.baseline.alpha;
    if (dAlpha >  180) dAlpha -= 360;
    if (dAlpha < -180) dAlpha += 360;
    return {
      dx:   -(this.current.gamma - this.baseline.gamma) * this.SENSITIVITY,
      dy:   -(this.current.beta  - this.baseline.beta)  * this.SENSITIVITY,
      dRot: -dAlpha * (Math.PI / 180)
    };
  }

  _fitImage() {
    const { canvas, overlayImage: img } = this;
    const scale = Math.min(canvas.width / img.width, canvas.height / img.height) * 0.92;
    return { iw: img.width * scale, ih: img.height * scale };
  }

  _drawLockedOverlay() {
    const { ctx, canvas } = this;
    const t = this._computeTransform();
    const { iw, ih } = this._fitImage();
    ctx.save();
    ctx.globalAlpha = this.opacity;
    ctx.translate(canvas.width / 2 + t.dx, canvas.height / 2 + t.dy);
    ctx.rotate(t.dRot);
    ctx.drawImage(this.overlayImage, -iw / 2, -ih / 2, iw, ih);
    ctx.restore();
  }

  _drawCentredOverlay() {
    const { ctx, canvas } = this;
    const { iw, ih } = this._fitImage();
    ctx.save();
    ctx.globalAlpha = this.opacity * 0.5;
    ctx.drawImage(this.overlayImage, (canvas.width - iw) / 2, (canvas.height - ih) / 2, iw, ih);
    ctx.restore();
  }

  _drawBrackets() {
    const { ctx, canvas } = this;
    const W = canvas.width, H = canvas.height;
    const bSize = 36, bThick = 3, margin = 28;
    const col = this.isLocked ? '#22c55e' : '#A78BFA';

    this._scanPhase = (this._scanPhase + 1) % 120;
    const alpha = this.isLocked ? 1 : 0.5 + 0.5 * Math.sin(this._scanPhase * (Math.PI / 60));

    ctx.save();
    ctx.strokeStyle = col;
    ctx.lineWidth = bThick;
    ctx.globalAlpha = alpha;
    ctx.lineCap = 'round';

    const corners = [
      [margin,     margin,      1,  1],
      [W - margin, margin,     -1,  1],
      [margin,     H - margin,  1, -1],
      [W - margin, H - margin, -1, -1]
    ];
    for (const [x, y, sx, sy] of corners) {
      ctx.beginPath();
      ctx.moveTo(x + sx * bSize, y); ctx.lineTo(x, y); ctx.lineTo(x, y + sy * bSize);
      ctx.stroke();
    }
    ctx.restore();

    if (this.isLocked) {
      ctx.save();
      ctx.fillStyle = 'rgba(34,197,94,0.9)';
      ctx.font = 'bold 13px Inter, sans-serif';
      ctx.textAlign = 'center';
      ctx.fillText('✓  LOCKED', W / 2, margin + 14);
      ctx.restore();
    }
  }
}
