// main.js - Main Thread Sensor & Proxy
import { Router } from './router.js';
import { HomePage } from './pages/HomePage.js';
// import { SettingsPage } from './pages/SettingsPage.js';


export class SpritePool {
  constructor(mountEl, options = {}) {
    this.mountEl = mountEl;
    this.fullScreen = options.fullScreen !== false; // Defaults to true
    
    this.canvas = document.createElement('canvas');
    this.canvas.style.pointerEvents = 'none';
    this.canvas.style.zIndex = '10';

    if (this.fullScreen) {
      this.canvas.style.position = 'fixed';
      this.canvas.style.top = '0';
      this.canvas.style.left = '0';
      this.canvas.style.width = '100vw';
      this.canvas.style.height = '100vh';
      document.body.appendChild(this.canvas);
    } else {
      this.canvas.style.position = 'absolute';
      this.canvas.style.top = '0';
      this.canvas.style.left = '0';
      this.canvas.style.width = '100%';
      this.canvas.style.height = '100%';
      // Ensure the mount element can contain absolute children
      if (getComputedStyle(this.mountEl).position === 'static') {
        this.mountEl.style.position = 'relative';
      }
      this.mountEl.appendChild(this.canvas);
    }
    
    const offscreen = this.canvas.transferControlToOffscreen();
    this.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    
    this.worker.postMessage({
      type: 'INIT',
      canvas: offscreen,
      options: {
        spriteSize: options.spriteSize ?? 3,
        maxSprites: options.maxSprites ?? 1500,
        interactionType: options.interactionType ?? 'ui' // Add this
      }
    }, [offscreen]);

    this._setupDOMTracking();
    this._setupInputSensors();
  }

  _setupDOMTracking() {
    const observer = new ResizeObserver(() => {
      const rect = this.mountEl.getBoundingClientRect();
      this.worker.postMessage({
        type: 'UPDATE_BOUNDS',
        bounds: {
          width: this.fullScreen ? window.innerWidth : rect.width,
          height: this.fullScreen ? window.innerHeight : rect.height,
          // Localized canvases use their own center point
          originX: this.fullScreen ? rect.left + rect.width / 2 : rect.width / 2,
          originY: this.fullScreen ? rect.top + rect.height / 2 : rect.height / 2,
          windowWidth: this.fullScreen ? window.innerWidth : rect.width,
          windowHeight: this.fullScreen ? window.innerHeight : rect.height
        }
      });
    });
    observer.observe(this.mountEl);
    window.dispatchEvent(new Event('resize')); 
  }

  _setupInputSensors() {
    window.addEventListener('mousemove', (e) => {
      let x = e.clientX;
      let y = e.clientY;
      
      // Calculate local mouse coordinates if not fullscreen
      if (!this.fullScreen) {
        const rect = this.mountEl.getBoundingClientRect();
        x = e.clientX - rect.left;
        y = e.clientY - rect.top;
      }

      this.worker.postMessage({ type: 'POINTER_MOVE', x, y });
    });

    window.addEventListener('mousedown', (e) => {
      let x = e.clientX, y = e.clientY;
      if (!this.fullScreen) {
        const rect = this.mountEl.getBoundingClientRect();
        x = e.clientX - rect.left;
        y = e.clientY - rect.top;
      }
      this.worker.postMessage({ type: 'POINTER_DOWN', x, y });
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

  explodeAt(x, y) {
    // Repurpose the existing POINTER_DOWN message which the worker is already listening for
    this.worker.postMessage({
      type: 'POINTER_DOWN',
      x: x,
      y: y
    });
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

export class SpriteWrite {
  constructor(text, fontSize = 16, densityFactor = 0.4, justify = 'center') {
    this.type = 'SpriteWrite'; 
    this.pool = null;
    
    this.config = {
      text: text,
      fontSize: fontSize,
      densityFactor: densityFactor,
      justify: justify,
      pixelMultiplier: 3.5,
      hs: (-20) * fontSize / 14,
      vs: (-5) * fontSize / 14
    };
  }

  attach(parent) {
    if (parent.type === 'SpriteGroup') {
      this.group = parent;
    } else {
      this.pool = parent;
    }
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
    
    if (this.group) {
      await this.group.refresh();
    } else if (this.pool) {
      await this.pool.mutateTo(this);
    } else {
      console.warn("SpriteWrite morphed, but it isn't attached.");
    }
    return this;
  }
}

export class SpriteImage {
  constructor(filename, scale = 300, densityFactor = 1.0) {
    this.type = 'SpriteImage'; 
    this.pool = null;
    
    this.config = {
      filename: filename,
      scale: scale, 
      densityFactor: densityFactor
    };
  }

  attach(parent) {
    if (parent.type === 'SpriteGroup') {
      this.group = parent;
    } else {
      this.pool = parent;
    }
    return this;
  }
  setScale(scale) {
    this.config.scale = scale;
    return this;
  }

  setDensity(density) {
    this.config.densityFactor = density;
    return this;
  }

  getConfig() {
    return this.config;
  }

  async morphTo(newText, forceFlicker = false) {
    if (this.config.text === newText && !forceFlicker) return this;
    this.config.text = newText;
    
    if (this.group) {
      await this.group.refresh();
    } else if (this.pool) {
      await this.pool.mutateTo(this);
    } else {
      console.warn("SpriteWrite morphed, but it isn't attached.");
    }
    return this;
  }
}

export class SpriteGroup {
  constructor() {
    this.type = 'SpriteGroup';
    this.pool = null;
    this.children = [];
  }

  attach(pool) {
    this.pool = pool;
    return this;
  }

  add(layoutController, mountEl) {
    layoutController.attach(this);
    this.children.push({ controller: layoutController, mountEl });
    return this;
  }

  getConfig() {
    return {
      children: this.children.map(c => {
        const rect = c.mountEl.getBoundingClientRect();
        return {
          type: c.controller.type,
          config: c.controller.getConfig(),
          offsetX: rect.left + rect.width / 2,
          offsetY: rect.top + rect.height / 2
        };
      })
    };
  }

  async refresh() {
    if (this.pool) await this.pool.mutateTo(this);
  }
}
