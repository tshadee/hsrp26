
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
        interactionType: options.interactionType ?? 'ui'
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
      if (zone.actionType === 'slider') {
        const input = document.createElement('input');
        input.type = 'range';
        input.min = '0';
        input.max = '100';
        input.value = zone.value;
        input.style.position = 'absolute'; 
        input.style.pointerEvents = 'auto';
        input.style.cursor = 'pointer';
        input.style.opacity = '0'; //TODO: change this for debug - actually need to add this to dev menu somehere 
        
        input.style.left = zone.isAbsolute ? `${zone.x}px` : `${centerX + zone.x}px`;
        input.style.top = zone.isAbsolute ? `${zone.y}px` : `${centerY + zone.y}px`;
        input.style.width = `${zone.width}px`;
        input.style.height = `${zone.height}px`;

        // When dragged, broadcast a global event
        input.addEventListener('input', (e) => {
           window.dispatchEvent(new CustomEvent('hsrp-slider-drag', { 
             detail: { id: zone.id, value: parseFloat(e.target.value) } 
           }));
        });

        input.addEventListener('change', (e) => {
           window.dispatchEvent(new CustomEvent('hsrp-slider-drop', { 
             detail: { id: zone.id, value: parseFloat(e.target.value) } 
           }));
        });
        
        // Prevent click explosions while dragging the slider
        input.addEventListener('mousedown', (e) => e.stopPropagation());

        this.overlayContainer.appendChild(input);
        return; // Skip the standard click-div logic below
      }

      const el = document.createElement('div');
      el.style.position = 'absolute';
      el.style.pointerEvents = 'auto'; 
      el.style.cursor = 'pointer';
      // el.style.border = '1px solid red';  // TODO: add to debug
      
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
          // Canvases use their own center point
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
    this.worker.postMessage({
      type: 'POINTER_DOWN',
      x: x,
      y: y
    });
  }

  updatePhysics(configObject) {
    this.worker.postMessage({
      type: 'UPDATE_PHYSICS_CONFIG',
      config: configObject
    });
  }

  async mutateTo(layoutController) {
    this.worker.postMessage({
      type: 'MORPH',
      layoutType: layoutController.type,
      config: layoutController.getConfig()
    });
  }
}

// ─── El Spirito ──────────────────────────────────────

export class SpriteWrite {
  constructor(text, fontSize = 16, densityFactor = 1.0) {
    this.type = 'SpriteWrite'; 
    this.parentGroup = null;
    
    this.config = {
      text: text,
      fontSize: fontSize,
      densityFactor: densityFactor,
      anchor: { x: 50, y: 50 }, // Default to exact center of container
      justify: 'center',
      align: 'center',
      wrap: false,
      pixelMultiplier: 3.5,
      hsRatio: -20 / 14, 
      vsRatio: -3 / 14
    };
  }

  setUI(isUI) {
    this.config.isUI = isUI ? 1 : 0;
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
    
    if (this.parentGroup) await this.parentGroup.refresh();
    return this;
  }
}

export class SpriteImage {
  constructor(filename, scale = 300, densityFactor = 1.0, isMouseAffected=false, targetScale = 200) {
    this.type = 'SpriteImage'; 
    this.parentGroup = null;
    
    this.config = {
      filename: filename,
      scale: scale, 
      densityFactor: densityFactor,
      isUI : isMouseAffected,
      targetScale: targetScale,
      aspectRatio: 1.0
    };
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
    
    if (this.parentGroup) await this.parentGroup.refresh();
    return this;
  }
}



export class SpriteGroup {
  constructor() {
    this.type = 'SpriteGroup';
    this.pool = null;
    this.parentGroup = null; // Explicitly track parent groups for nesting
    this.children = [];
  }

  setChildActive(layoutController, isActive) {
    const target = this.children.find(c => c.controller === layoutController);
    if (target) {
      target.active = isActive;
    }
    return this;
  }

  attach(pool) {
    this.pool = pool;
    return this;
  }

  add(controller, mountEl, active = true) {
    controller.parentGroup = this;
    this.children.push({ controller, mountEl, active });
    return this;
  }

  // Swap out a controller targeting a specific DOM element (perfect for logos/pages)
  replace(mountEl, newController, active = true) {
    newController.parentGroup = this;
    if (mountEl) {
        const index = this.children.findIndex(c => c.mountEl === mountEl);
        if (index !== -1) {
            this.children[index] = { controller: newController, mountEl, active };
            return this;
        }
    }
    this.children.push({ controller: newController, mountEl, active });
    return this;
  }

  getConfig() {
    // Flatten the hierarchy so the Worker only deals with a 1D array of absolute positions
    const flatChildren = [];

    const processChild = (c) => {
      if (c.active === false) return;
      
      if (c.controller.type === 'SpriteGroup') {
        // Recursively dig into nested groups
        c.controller.children.forEach(processChild);
      } else {
        // Standard controller: Calculate absolute screen center
        let offsetX = 0;
        let offsetY = 0;
        
        if (c.mountEl) {
          const rect = c.mountEl.getBoundingClientRect();
          offsetX = rect.left + rect.width / 2;
          offsetY = rect.top + rect.height / 2;
        }
        
        flatChildren.push({
          type: c.controller.type,
          config: c.controller.getConfig(),
          offsetX: offsetX,
          offsetY: offsetY,
          active: true
        });
      }
    };

    this.children.forEach(processChild);
    return { children: flatChildren };
  }

  async refresh() {
    if (this.pool) await this.pool.mutateTo(this);
    else if (this.parentGroup) await this.parentGroup.refresh();
  }
}

export class SpriteRectangle {
  constructor(widthPercent = 100, heightPercent = 100, densityFactor = 0.6) {
    this.type = 'SpriteRectangle';
    this.parentGroup = null;
    
    this.config = {
      width: widthPercent,
      height: heightPercent,
      densityFactor: densityFactor,
      anchor: { x: 50, y: 50 },
      justify: 'center',
      align: 'center',
      layers: 1,                 
      layerSpacing: 10,           //(in pixels)
      layerDirection: 'outwards', //('inwards' or 'outwards')
      cornerRadius: 5
    };
  }

  setWidth(percent) { this.config.width = percent; return this; }
  setHeight(percent) { this.config.height = percent; return this; }
  setAnchor(xPercent, yPercent) { this.config.anchor = { x: xPercent, y: yPercent }; return this; }
  setJustify(justification) { this.config.justify = justification; return this; }
  setAlign(alignment) { this.config.align = alignment; return this; }
  setDensity(density) { this.config.densityFactor = density; return this; }
  setLayers(numLayers) { this.config.layers = numLayers; return this; }
  setLayerSpacing(pixels) { this.config.layerSpacing = pixels; return this; }
  setLayerDirection(direction) { this.config.layerDirection = direction; return this; }
  setCornerRadius(percent) { this.config.cornerRadius = percent; return this; }

  getConfig() { return this.config; }

  async morphTo(newWidth, newHeight) {
    this.config.width = newWidth;
    this.config.height = newHeight;
    
    if (this.parentGroup) await this.parentGroup.refresh();
    return this;
  }
}

export class SpriteSlider extends SpriteRectangle {
  constructor(widthPercent = 10 , heightPercent = 1.5, densityFactor = 0.6) {
    super(widthPercent, heightPercent, densityFactor);
    this.type = 'SpriteSlider'; 
    
    // Set defaults for the ball
    this.config.ballPosition = 50; // % of container width
    this.config.ballDiameter = 3;  // % of container height
    this.config.cornerRadius = 2;  // %
    this.config.layers = 1;
    this.config.id = 'default_slider';
  }

  setId(stringId) {
    this.config.id = stringId;
    return this;
  }

  setBallPosition(percent) { 
    this.config.ballPosition = Math.max(0, Math.min(100, percent)); 
    return this; 
  }
  
  setBallDiameter(percent) { 
    this.config.ballDiameter = percent; 
    return this; 
  }

  async morphValueTo(newValue) {
    this.setBallPosition(newValue);
    if (this.parentGroup) await this.parentGroup.refresh();
    return this;
  }
}
