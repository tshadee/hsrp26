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
    
    this.overlayContainer = document.createElement('div');
    this.overlayContainer.style.position = 'absolute';
    this.overlayContainer.style.top = '0';
    this.overlayContainer.style.left = '0';
    this.overlayContainer.style.width = '100%';
    this.overlayContainer.style.height = '100%';
    this.overlayContainer.style.pointerEvents = 'none'; // Let clicks pass through empty space
    this.overlayContainer.style.zIndex = '20';
    this.mountEl.appendChild(this.overlayContainer);

    this.worker = new Worker(new URL('./worker.js', import.meta.url), { type: 'module' });
    
    // Listen for messages from the worker
    this.worker.onmessage = (e) => {
      if (e.data.type === 'INTERACTIVE_ZONES') {
        this._buildInteractiveZones(e.data.zones);
      }
    };
    
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

  _buildInteractiveZones(zones) {
    this.overlayContainer.innerHTML = '';
    if (!zones || zones.length === 0) return;

    const rect = this.mountEl.getBoundingClientRect();
    const centerX = rect.width / 2;
    const centerY = rect.height / 2;

    zones.forEach(zone => {
      const el = document.createElement('div');
      el.style.position = 'absolute';
      el.style.pointerEvents = 'auto'; 
      el.style.cursor = 'pointer';
      // el.style.border = '1px solid red'; 
      
      // FIX: If the zone came from a SpriteGroup, it already has the offset added!
      // Don't add centerX/Y again, or it will double-offset and break alignment.
      el.style.left = zone.isAbsolute ? `${zone.x}px` : `${centerX + zone.x}px`;
      el.style.top = zone.isAbsolute ? `${zone.y}px` : `${centerY + zone.y}px`;
      el.style.width = `${zone.width}px`;
      el.style.height = `${zone.height}px`;

      el.addEventListener('click', (e) => {
         this.explodeAt(e.clientX, e.clientY);
         if (zone.actionType === 'hyperlink') {
            window.open(zone.target, '_blank');
         } else if (zone.actionType === 'intralink') {
            window.dispatchEvent(new CustomEvent('hsrp-navigate', { detail: { route: parseInt(zone.target) } }));
         }
      });

      this.overlayContainer.appendChild(el);
    });
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
  constructor(text, fontSize = 16, densityFactor = 1.0) {
    this.type = 'SpriteWrite'; 
    this.pool = null;
    
    this.config = {
      text: text,
      fontSize: fontSize,
      densityFactor: densityFactor,
      anchor: { x: 50, y: 50 }, // Default to exact center of container
      justify: 'center',
      align: 'center',
      wrap: false,
      pixelMultiplier: 3.5,
      hs: (-20) * fontSize / 14,
      vs: (-3) * fontSize / 14
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

  setAnchor(xPercent, yPercent) {
    this.config.anchor = { x: xPercent, y: yPercent };
    return this;
  }

  setJustify(justification) {
    this.config.justify = justification;
    return this;
  }

  setAlign(alignment) {
    this.config.align = alignment;
    return this;
  }

  setWrap(shouldWrap) {
    this.config.wrap = shouldWrap;
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
  constructor(filename, scale = 300, densityFactor = 1.0, isMouseAffected=false) {
    this.type = 'SpriteImage'; 
    this.pool = null;
    
    this.config = {
      filename: filename,
      scale: scale, 
      densityFactor: densityFactor,
      isUI : isMouseAffected
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

  add(layoutController, mountEl, active = true) {
    layoutController.attach(this);
    this.children.push({ controller: layoutController, mountEl , active});
    return this;
  }

  setChildActive(layoutController, isActive) {
    const target = this.children.find(c => c.controller === layoutController);
    if (target) {
      target.active = isActive;
    }
    return this;
  }

  getConfig() {
    // Determine the pool's bounding box and screen status
    const poolRect = this.pool ? this.pool.mountEl.getBoundingClientRect() : { left: 0, top: 0 };
    const isFullScreen = this.pool ? this.pool.fullScreen : true;

    return {
      children: this.children.map(c => {
        const rect = c.mountEl.getBoundingClientRect();
        return {
          type: c.controller.type,
          config: c.controller.getConfig(),
          // If non-fullscreen, subtract the pool's position so offsets are strictly local!
          offsetX: isFullScreen ? rect.left + rect.width / 2 : (rect.left - poolRect.left) + rect.width / 2,
          offsetY: isFullScreen ? rect.top + rect.height / 2 : (rect.top - poolRect.top) + rect.height / 2,
          active: c.active
        };
      })
    };
  }

  async refresh() {
    if (this.pool) await this.pool.mutateTo(this);
  }
}
