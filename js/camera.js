/**
 * camera.js — Camera stream lifecycle manager with robust fallback
 */
class CameraManager {
  constructor(videoEl) {
    this.video = videoEl;
    this.stream = null;
    this.isActive = false;
  }

  async start() {
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' }, width: { ideal: 1920 }, height: { ideal: 1080 } },
        audio: false
      });
    } catch (err) {
      try {
        // Fallback to standard video stream (laptop webcam / basic mobile camera)
        this.stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      } catch (err2) {
        console.warn('Camera stream unavailable, running in canvas overlay mode:', err2);
        this.isActive = false;
        return true; // Return true so PaperMode stays active!
      }
    }

    if (this.stream) {
      this.video.srcObject = this.stream;
      try { await this.video.play(); } catch (e) {}
      this.isActive = true;
    }
    return true;
  }

  stop() {
    if (this.stream) {
      this.stream.getTracks().forEach(t => t.stop());
      this.stream = null;
    }
    if (this.video) this.video.srcObject = null;
    this.isActive = false;
  }

  drawFrame(ctx, canvasW, canvasH) {
    if (this.video && this.video.videoWidth) {
      const vw = this.video.videoWidth, vh = this.video.videoHeight;
      const scale = Math.max(canvasW / vw, canvasH / vh);
      const dw = vw * scale, dh = vh * scale;
      const dx = (canvasW - dw) / 2, dy = (canvasH - dh) / 2;
      ctx.drawImage(this.video, dx, dy, dw, dh);
    } else {
      // Dark AR canvas background fallback when camera is off/loading
      ctx.fillStyle = '#0d0d12';
      ctx.fillRect(0, 0, canvasW, canvasH);
    }
  }
}

async function requestOrientationPermission() {
  if (typeof DeviceOrientationEvent !== 'undefined' &&
      typeof DeviceOrientationEvent.requestPermission === 'function') {
    try {
      const res = await DeviceOrientationEvent.requestPermission();
      return res === 'granted';
    } catch { return false; }
  }
  return true;
}
