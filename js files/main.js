// main.js - Main Thread Sensor & Proxy

export class SpritePool {
  constructor(mountEl, options = {}) {
    this.mountEl = mountEl;
    
    // 1. Create the full-screen overlay canvas
    this.canvas = document.createElement('canvas');
    this.canvas.style.position = 'fixed';
    this.canvas.style.top = '0';
    this.canvas.style.left = '0';
    this.canvas.style.width = '100vw';
    this.canvas.style.height = '100vh';
    this.canvas.style.pointerEvents = 'none'; // Pass clicks to HTML beneath
    this.canvas.style.zIndex = '10';
    
    // Append to body rather than the mountEl so it guarantees overlay behavior
    document.body.appendChild(this.canvas);
    
    // 2. Detach canvas and hand it to the Worker
    const offscreen = this.canvas.transferControlToOffscreen();
    
    // Create the worker (Make sure the path matches your structure)
    this.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    
    // 3. Initialize the Worker Engine
    this.worker.postMessage({
      type: 'INIT',
      canvas: offscreen,
      options: {
        spriteSize: options.spriteSize ?? 3,
        maxSprites: options.maxSprites ?? 1500
      }
    }, [offscreen]); // The canvas must be passed in the transfer array

    // 4. Setup sensors
    this._setupDOMTracking();
    this._setupInputSensors();
  }

  _setupDOMTracking() {
    // ResizeObserver watches for ANY CSS changes that shift the element (flexbox changes, window resize, etc.)
    const observer = new ResizeObserver(() => {
      const rect = this.mountEl.getBoundingClientRect();
      this.worker.postMessage({
        type: 'UPDATE_BOUNDS',
        bounds: {
          width: rect.width,
          height: rect.height,
          originX: rect.left + rect.width / 2,
          originY: rect.top + rect.height / 2,
          windowWidth: window.innerWidth,
          windowHeight: window.innerHeight
        }
      });
    });
    observer.observe(this.mountEl);
    
    // Also trigger immediately to get initial coordinates
    window.dispatchEvent(new Event('resize')); 
  }

  _setupInputSensors() {
    // Listen to global mouse movements and send them instantly to this specific pool's worker
    window.addEventListener('mousemove', (e) => {
      this.worker.postMessage({
        type: 'POINTER_MOVE',
        x: e.clientX,
        y: e.clientY
      });
    });

    window.addEventListener('mousedown', (e) => {
      this.worker.postMessage({
        type: 'POINTER_DOWN',
        x: e.clientX,
        y: e.clientY
      });
    });
  }

  moveTo(newX, newY) {
    this.worker.postMessage({
      type: 'MOVE_TO',
      x: newX,
      y: newY
    });
  }

  resetMove() {
    this.worker.postMessage({ type: 'RESET_MOVE' });
  }

  async mutateTo(layoutController) {
    // Instead of doing the math here, we serialize the layout controller's config 
    // and instruct the worker to do the heavy fetching and layout generation.
    this.worker.postMessage({
      type: 'MORPH',
      layoutType: layoutController.type,
      config: layoutController.getConfig()
    });
  }
}

// ─── Configuration Builders ──────────────────────────────────────

// This class now just builds configuration states to send across the thread boundary.
export class SpriteWrite {
  constructor(text, shapesBase = './shapes/letters/NVMono/', fontSize = 16, densityFactor = 0.4, justify = 'center') {
    this.type = 'SpriteWrite'; // Tells the worker which layout logic to run
    this.pool = null;
    
    this.config = {
      text: text,
      shapesBase: shapesBase,
      fontSize: fontSize,
      densityFactor: densityFactor,
      justify: justify,
      pixelMultiplier: 3.5,
      hs: (-20) * fontSize / 14,
      vs: (-5) * fontSize / 14
    };
  }

  attach(pool) {
    this.pool = pool;
    return this;
  }

  setFontSize(size) {
    this.config.fontSize = size;
    return this;
  }

  setFontHS(spacing) {
    this.config.hs = spacing;
    return this;
  }

  setFontVS(spacing) {
    this.config.vs = spacing;
    return this;
  }

  setJustify(justification) {
    this.config.justify = justification;
    return this;
  }

  getConfig() {
    return this.config;
  }

  async morphTo(newText, forceFlicker = false) {
    if (this.config.text === newText && !forceFlicker) return this;
    
    this.config.text = newText;
    
    if (this.pool) {
      await this.pool.mutateTo(this);
    } else {
      console.warn("SpriteWrite morphed, but it isn't attached to a SpritePool.");
    }
    
    return this;
  }
}