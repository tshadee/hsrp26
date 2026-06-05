const DEFAULT_SIZE = 4;
const MAX_SPRITES = 10000;

const DEFAULT_SPRITE_SPEED = 0.01;  //these need to be framerate independent
const DEFAULT_SPRITE_SPEED_VARIANCE = 0.01;

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

const monitorFPS = 60; // Default fallback value

class SpriteChild {
  constructor() {
    this.curr = { x: 0, y: 0, a: 0 };
    this.start = { x: 0, y: 0, a: 0 }; 
    this.target = { x: 0, y: 0, a: 0 };
    this.curlDirection = Math.random()*2 - 1;
    this.curlClockwise = Math.random()*2 - 1;
    
    this.isDying = false;
    this.drag = 0.2 + Math.random() * 1.5; 
    
    this.progress = 1; 
    this.speed = DEFAULT_SPRITE_SPEED + Math.random() * DEFAULT_SPRITE_SPEED_VARIANCE; 
    this.shedThreshold = 2;
  }

  set(state) {
    this.start.x = this.curr.x;
    this.start.y = this.curr.y;
    this.start.a = this.curr.a;

    if (state.x !== undefined) this.target.x = state.x;
    if (state.y !== undefined) this.target.y = state.y;
    if (state.a !== undefined) this.target.a = state.a; 

    this.progress = 0; 
    this.speed = DEFAULT_SPRITE_SPEED + Math.random() * DEFAULT_SPRITE_SPEED_VARIANCE;
  }

  update(timeScale = 1) {
    if (this.isDying) {
      const oldX = this.curr.x;
      const oldY = this.curr.y;
      
      // Scale linear movement
      this.curr.x += 0.01 * timeScale;
      this.curr.y += 0.01 * timeScale;
      
      // Frame-independent exponential decay for alpha
      const deathDecay = 1 - Math.pow(1 - 0.01, timeScale);
      this.curr.a += (0 - this.curr.a) * deathDecay;
      
      const globalDx = this.curr.x - oldX;
      const globalDy = this.curr.y - oldY;
      const swerveStrength = this.curlDirection * 15.45 * this.drag; 
      const curlX = -this.curlClockwise * globalDy * swerveStrength;
      const curlY = this.curlClockwise * globalDx * swerveStrength;

      this.curr.x += curlX;
      this.curr.y += curlY;
      return;
    }

    const oldX = this.curr.x;
    const oldY = this.curr.y;

    if (this.progress < 1) {
      // Scale bezier progress increment
      this.progress += this.speed * this.drag * timeScale;
      if (this.progress > 1) this.progress = 1;

      const t = this.progress;
      const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2;

      const globalDx = this.target.x - this.start.x;
      const globalDy = this.target.y - this.start.y;

      const baseX = this.start.x + globalDx * ease;
      const baseY = this.start.y + globalDy * ease;

      const turbulenceForce = Math.sin(t * Math.PI); 
      
      const swerveStrength = this.curlDirection * 0.05 * turbulenceForce * this.drag; 
      const curlX = -globalDy * swerveStrength;
      const curlY = globalDx * swerveStrength;

      this.curr.x = baseX + curlX;
      this.curr.y = baseY + curlY;
    }

    // Convert pixel speed back to a per-frame equivalent so kinetic alpha feels the same
    const vx = (this.curr.x - oldX) / timeScale;
    const vy = (this.curr.y - oldY) / timeScale;
    const speed = Math.hypot(vx, vy);
    const dist = Math.hypot(this.target.x - this.curr.x, this.target.y - this.curr.y);

    const kineticAlpha = 0.1 + (speed / 10) * 1.8;
    const clampedKineticAlpha = Math.max(0.1, Math.min(1.5, kineticAlpha));

    let deadzoneMix = 0;
    if (dist < 5) {
      deadzoneMix = 1;
    } else if (dist < 15) {
      deadzoneMix = 1 - ((dist - 5) / 10);
    }

    const desiredAlpha = (1 - deadzoneMix) * clampedKineticAlpha + deadzoneMix * this.target.a;
    
    // Frame-independent exponential ease for kinetic alpha
    const alphaEase = 1 - Math.pow(1 - 0.2, timeScale);
    this.curr.a += (desiredAlpha - this.curr.a) * alphaEase;
  }
}

// ─── The Global Slurry Pool ──────────────────────────────────────────────────

export class SpritePool {
  constructor(mountEl, options = {}) {
    this.mountEl = mountEl;
    this.spriteSize = options.spriteSize ?? 3;
    this.maxSprites = options.maxSprites ?? 1500; 
    
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.mountEl.appendChild(this.canvas);
    
    this.layoutCenterX = undefined;
    this.layoutCenterY = undefined;

    this._onResize();
    window.addEventListener('resize', () => this._onResize());

    this.sprites = [];
    for (let i = 0; i < this.maxSprites; i++) {
      this.sprites.push(new SpriteChild()); 
    }

    // Initialize timestamp tracking
    this.lastTime = performance.now();

    this._renderLoop = this._renderLoop.bind(this);
    requestAnimationFrame(this._renderLoop);
  }

  _onResize() {
    this.width = this.mountEl.offsetWidth;
    this.height = this.mountEl.offsetHeight;
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    
    // Initialize center if it hasn't been set
    if (this.layoutCenterX === undefined) {
      this.layoutCenterX = this.width / 2;
      this.layoutCenterY = this.height / 2;
    }
  }

  /**
   * Shifts the entire formation to a new absolute coordinate on the canvas.
   * This triggers the 'schooling fish' Bezier path for all active sprites.
   */
  moveTo(newX, newY) {
    const dx = (newX - this.layoutCenterX)*(Math.random()*0.35+0.2);
    const dy = (newY - this.layoutCenterY)*(Math.random()*0.35+0.2);

    for (let i = 0; i < this.maxSprites; i++) {
      const sprite = this.sprites[i];
      if (!sprite.isDying && sprite.target.a > 0) {
        // Shift their target destination relative to the new group center
        sprite.set({ 
          x: sprite.target.x + dx, 
          y: sprite.target.y + dy 
        });
      }
    }

    // Update global controller center
    this.layoutCenterX = newX;
    this.layoutCenterY = newY;
  }

  async mutateTo(layoutController) {
    const newLayout = await layoutController.getLayout(this.width, this.height, this.spriteSize);
    
    const offsetX = this.layoutCenterX - (this.width / 2);
    const offsetY = this.layoutCenterY - (this.height / 2);
    const dither = 10; 

    // 1. Sort targets spatially
    const targets = newLayout.map(pt => ({
      x: pt.x + offsetX,
      y: pt.y + offsetY,
      a: pt.a ?? 1,
      sortKey: (pt.x + pt.y) + (Math.random() * dither - dither / 2)
    })).sort((a, b) => a.sortKey - b.sortKey);

    // 2. Separate active (guides) from dead (reserves)
    const activeSprites = [];
    const deadSprites = [];
    
    for (let i = 0; i < this.maxSprites; i++) {
      const sprite = this.sprites[i];
      // Consider it active if it is visible or currently on a valid journey
      if (sprite.curr.a > 0.01 || sprite.target.a > 0) {
        activeSprites.push({
          sprite,
          sortKey: (sprite.curr.x + sprite.curr.y) + (Math.random() * dither - dither / 2)
        });
      } else {
        deadSprites.push(sprite);
      }
    }
    
    // Sort our active guides spatially to map neatly to targets
    activeSprites.sort((a, b) => a.sortKey - b.sortKey);

    const neededCount = targets.length;
    const activeCount = activeSprites.length;

    // 3. Map Active Guides & Handle Excess Shedding
    for (let i = 0; i < activeCount; i++) {
      const sprite = activeSprites[i].sprite;
      sprite.isDying = false;
      sprite.shedThreshold = 2; // Reset shedding threshold

      if (i < neededCount) {
        // Valid guide sprite maps cleanly to its target
        const pt = targets[i];
        sprite.set({ x: pt.x, y: pt.y, a: pt.a });
      } else {
        // Excess sprite: Assign to a random valid target so it travels with the pack
        const randomTarget = targets[Math.floor(Math.random() * neededCount)];
        
        // It seeks the pack, but fades out naturally if it somehow survives the trip
        sprite.set({ x: randomTarget.x, y: randomTarget.y, a: 0 }); 
        
        // Program the sprite to trigger its death curl between 20% and 80% of the journey
        sprite.shedThreshold = 0.1 + Math.random() * 0.2; 
      }
    }

    // 4. Handle Growth (drawing upon space around guides)
    let spawnedCount = 0;
    while (activeCount + spawnedCount < neededCount && deadSprites.length > 0) {
      const sprite = deadSprites.pop();
      const pt = targets[activeCount + spawnedCount];
      
      if (activeCount > 0) {
        // Pick a random guide from the valid active pool
        const guideIndex = Math.floor(Math.random() * Math.min(activeCount, neededCount));
        const guide = activeSprites[guideIndex].sprite;
        
        // Spawn near the guide with a dither radius
        sprite.curr.x = guide.curr.x + (Math.random() * 30 - 20);
        sprite.curr.y = guide.curr.y + (Math.random() * 30 - 20);
      } else {
        // Absolute fallback if mutating from an empty screen
        sprite.curr.x = this.layoutCenterX;
        sprite.curr.y = this.layoutCenterY;
      }

      sprite.curr.a = 0; // Ensure it fades in
      sprite.isDying = false;
      sprite.shedThreshold = 2;
      sprite.drag = 0.2 + Math.random() * 1.5;
      sprite.set({ x: pt.x, y: pt.y, a: pt.a });
      
      spawnedCount++;
    }
  }

  _renderLoop(timestamp) {
    // Calculate delta time
    const dt = timestamp - this.lastTime;
    this.lastTime = timestamp;
    
    // Cap dt to prevent explosions if the user switches browser tabs
    const cappedDt = Math.min(dt, 100); 
    // 16.666ms is 1 frame at 60fps. This yields a multiplier near 1.0 on standard monitors.
    const timeScale = cappedDt / 16.666; 

    this.ctx.clearRect(0, 0, this.width, this.height);
    this.ctx.fillStyle = 'rgba(255, 255, 255, 1)';

    for (let i = 0; i < this.maxSprites; i++) {
      const sprite = this.sprites[i];
      
      // Pass the scale into the update loop
      sprite.update(timeScale); 

      const a = sprite.curr.a;
      if (a < 0.01) continue; 

      const px = sprite.curr.x - (this.spriteSize / 2);
      const py = sprite.curr.y - (this.spriteSize / 2);

      this.ctx.globalAlpha = Math.min(1, a);
      this.ctx.fillRect(px, py, this.spriteSize, this.spriteSize);

      if (a > 1.0) {
        this.ctx.globalCompositeOperation = 'lighter'; 
        this.ctx.globalAlpha = Math.min(1, a - 1.0);
        this.ctx.fillRect(px - 1, py - 1, this.spriteSize + 2, this.spriteSize + 2);
        this.ctx.globalCompositeOperation = 'source-over'; 
      }
    }
    requestAnimationFrame(this._renderLoop);
  }
}

// ─── Layout Controllers ──────────────────────────────────────

export class LayoutController {
  constructor() {
    this.pool = null; // The renderer this controller is currently driving
  }

  // Binds the controller to a specific pool
  attach(pool) {
    this.pool = pool;
    return this; // Enable chaining
  }

  // To be overridden by child classes
  async getLayout(canvasWidth, canvasHeight, spriteSize) {
    console.warn("getLayout must be implemented by the subclass");
    return [];
  }
}



export class LetterParent {
  constructor(letterFilename, shapesBase = './shapes/letters/') {
    // The filename is now pre-sanitized by SpriteWrite
    this.letterFilename = letterFilename; 
    this.shapesBase = shapesBase;
  }

  async getLayout() {
    try {
      const res = await fetch(`${this.shapesBase}${this.letterFilename}.sprites.json`);
      if (!res.ok) throw new Error('File not found');
      const data = await res.json();
      return data.sprites;
    } catch (e) {
      console.warn(`Failed to load shape: ${this.letterFilename}. Ignoring.`);
      return []; // Return empty array so it fails gracefully
    }
  }
}

export class SpriteWrite extends LayoutController {
  constructor(text, shapesBase = './shapes/letters/', fontSize = 16, densityFactor = 0.4, justify = 'center') {
    super(); // Initialize the LayoutController base
    this.text = text; 
    this.shapesBase = shapesBase;
    this.fontSize = fontSize; 
    this.densityFactor = densityFactor;
    this.justify = justify;
    this.pixelMultiplier = 4; 
    this.hs = -15; 
    this.vs = 0; 
  }

  setFontSize(size) {
    this.fontSize = size;
    return this; 
  }

  setFontHS(spacing) {
    this.hs = spacing;
    return this;
  }

  setFontVS(spacing) {
    this.vs = spacing;
    return this;
  }

  setJustify(justification) {
    this.justify = justification;
    return this;
  }

  async morphTo(newText) {
    this.text = newText; 
    
    // If this controller is actively attached to a pool, trigger the animation
    if (this.pool) {
      // Under the hood, it still uses the pool's coordinate mapper, 
      // but your front-end syntax remains incredibly clean.
      await this.pool.mutateTo(this); 
    } else {
      console.warn("SpriteWrite morphed, but it isn't attached to a SpritePool.");
    }
    
    return this; 
  }

  // Maps illegal/difficult characters to safe JSON filenames
  _sanitizeChar(char) {
    const specialCharOutputs = {
        '?': 'question',
        '/': 'slash',
        '.': 'period',
        '!': 'exclamation',
        '@': 'at',
        '#': 'hash',
        '$': 'dollar',
        '%': 'percent',
        '^': 'caret',
        '&': 'ampersand',
        '*': 'asterisk',
        '(': 'left_paren',
        ')': 'right_paren',
        ' ': 'space',
        ',': 'comma', 
        "'": 'apostrophe', 
        '"': 'quotation',
        ';': 'semicolon', 
        ':': 'colon',
        '<': 'less_than',
        '>': 'greater_than',
        '+': 'plus',
        '=': 'equals',
        '-': 'dash',
        '{': 'left_brace',
        '}': 'right_brace',
        '[': 'left_bracket',
        ']': 'right_bracket',
        '|': 'pipe',
        '~': 'tilde',
        '`': 'backtick'
    };

    if (specialCharOutputs[char]) return specialCharOutputs[char];
    if (/[A-Z]/.test(char)) return `${char}_upper`;
    if (/[a-z]/.test(char)) return `${char}_lower`;

    // Fallback (Numbers 0-9)
    return char;
  }

  async getLayout(canvasWidth, canvasHeight, spriteSize) {
    const finalLayout = [];
    
    // Split the input into an array of lines based on the newline character
    const lines = this.text.split('\n');
    
    const letterScale = this.fontSize * this.pixelMultiplier;
    const letterArea = letterScale * letterScale;
    const spriteArea = spriteSize * spriteSize;
    const targetSpriteCount = Math.floor((letterArea / spriteArea) * this.densityFactor);

    // 1. Pre-calculate line dimensions to support block justification
    const lineGeometries = lines.map(line => {
      // Line width = (Number of chars * Scale) + (Number of spaces between chars * hs)
      const width = line.length > 0 
        ? (line.length * letterScale) + ((line.length - 1) * this.hs) 
        : 0;
      return { text: line, width: width };
    });

    // Find the widest line to act as the bounding box for left/right justification
    const maxLineWidth = Math.max(...lineGeometries.map(lg => lg.width));
    
    // Total block height = (Number of lines * Scale) + (Number of spaces between lines * vs)
    const totalHeight = (lines.length * letterScale) + ((lines.length - 1) * this.vs);

    // Center the entire text block vertically in the canvas
    let currentY = (canvasHeight / 2) - (totalHeight / 2);

    // 2. Build the layout line by line
    for (const lineGeo of lineGeometries) {
      let currentX = 0;
      
      // Determine the starting X coordinate based on justification
      if (this.justify === 'left') {
        currentX = (canvasWidth / 2) - (maxLineWidth / 2);
      } else if (this.justify === 'right') {
        currentX = (canvasWidth / 2) + (maxLineWidth / 2) - lineGeo.width;
      } else { 
        // 'center' (default)
        currentX = (canvasWidth / 2) - (lineGeo.width / 2);
      }

      // 3. Process each character in the current line
      for (let i = 0; i < lineGeo.text.length; i++) {
        const char = lineGeo.text[i];

        if (char !== ' ') {
          const safeFilename = this._sanitizeChar(char);
          const letterBlueprint = new LetterParent(safeFilename, this.shapesBase);
          let spriteData = await letterBlueprint.getLayout();

          if (spriteData.length > targetSpriteCount) {
            // Shuffle array is assumed to be available globally from your engine.js
            shuffleArray(spriteData); 
            spriteData = spriteData.slice(0, targetSpriteCount);
          }

          // Map normalized JSON coordinates to global canvas coordinates
          for (const pt of spriteData) {
            finalLayout.push({
              x: currentX + (pt.x * letterScale),
              y: currentY + (pt.y * letterScale),
              a: pt.a
            });
          }
        }
        
        // Advance the X cursor for the next character (plus horizontal spacing)
        currentX += letterScale + this.hs;
      }
      
      // Advance the Y cursor for the next line (plus vertical spacing)
      currentY += letterScale + this.vs;
    }
    
    return finalLayout;
  }
}