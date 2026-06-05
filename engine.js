const DEFAULT_SIZE = 4;
const MAX_SPRITES = 10000;

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

class SpriteChild {
  constructor() {
    this.curr = { x: 0, y: 0, a: 0 };
    this.start = { x: 0, y: 0, a: 0 }; // Track origin for Bezier path
    this.target = { x: 0, y: 0, a: 0 };
    
    this.isDying = false;
    this.drag = 0.2 + Math.random() * 1.1; 
    
    // Time-based variables for Bezier interpolation
    this.progress = 1; // 0 to 1
    this.speed = 0.01 + Math.random() * 0.01; // Individual speed
  }

  set(state) {
    // Save current state as the starting point of the new journey
    this.start.x = this.curr.x;
    this.start.y = this.curr.y;
    this.start.a = this.curr.a;

    if (state.x !== undefined) this.target.x = state.x;
    if (state.y !== undefined) this.target.y = state.y;
    if (state.a !== undefined) this.target.a = state.a;

    // Reset progress and randomize speed slightly to break up rigid formations
    this.progress = 0; 
    this.speed = 0.01 + Math.random() * 0.01;
  }

  update() {
    if (this.isDying) {
      this.curr.y += 2 * this.drag; 
      this.curr.a += (0 - this.curr.a) * 0.1;
      return;
    }

    // Capture old position before applying math (needed for kinetic alpha)
    const oldX = this.curr.x;
    const oldY = this.curr.y;

    if (this.progress < 1) {
      // Advance progress based on individual speed and drag
      this.progress += this.speed * this.drag;
      if (this.progress > 1) this.progress = 1;

      // 1. Cubic Bezier Ease-In-Out Calculation
      const t = this.progress;
      const ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2;

      const globalDx = this.target.x - this.start.x;
      const globalDy = this.target.y - this.start.y;

      // The theoretical Bezier position
      const baseX = this.start.x + globalDx * ease;
      const baseY = this.start.y + globalDy * ease;

      // 2. School of Fish Turbulence (Chaos)
      // Peaks at t=0.5, collapses to 0 at t=0 and t=1
      const turbulenceForce = Math.sin(t * Math.PI); 
      
      // Create a perpendicular swerve relative to their travel vector
      const swerveStrength = 0.025 * turbulenceForce * this.drag; 
      const curlX = -globalDy * swerveStrength;
      const curlY = globalDx * swerveStrength;

      this.curr.x = baseX + curlX;
      this.curr.y = baseY + curlY;
    }

    // Calculate actual pixel speed for the kinetic alpha
    const vx = this.curr.x - oldX;
    const vy = this.curr.y - oldY;
    const speed = Math.hypot(vx, vy);
    const dist = Math.hypot(this.target.x - this.curr.x, this.target.y - this.curr.y);

    // Kinetic Alpha & Deadzone logic remains mostly untouched
    const kineticAlpha = 0.1 + (speed / 10) * 1.8;
    const clampedKineticAlpha = Math.max(0.1, Math.min(1.5, kineticAlpha));

    let deadzoneMix = 0;
    if (dist < 5) {
      deadzoneMix = 1;
    } else if (dist < 15) {
      deadzoneMix = 1 - ((dist - 5) / 10);
    }

    const desiredAlpha = (1 - deadzoneMix) * clampedKineticAlpha + deadzoneMix * this.target.a;
    this.curr.a += (desiredAlpha - this.curr.a) * 0.2;
  }
}

// ─── The Global Slurry Pool ──────────────────────────────────────────────────

export class SpritePool {
  constructor(mountEl, options = {}) {
    this.mountEl = mountEl;
    this.spriteSize = options.spriteSize ?? 3;
    
    // Configurable per pool! Essential for multi-pool performance.
    this.maxSprites = options.maxSprites ?? 1500; 
    
    this.canvas = document.createElement('canvas');
    this.ctx = this.canvas.getContext('2d');
    this.mountEl.appendChild(this.canvas);
    
    this.layoutCenterX = undefined;
    this.layoutCenterY = undefined;

    this._onResize();
    window.addEventListener('resize', () => this._onResize());

    this.sprites = [];
    // Only generate what this specific pool needs
    for (let i = 0; i < this.maxSprites; i++) {
      this.sprites.push(new SpriteChild()); 
    }

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
    const dx = newX - this.layoutCenterX;
    const dy = newY - this.layoutCenterY;

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

    shuffleArray(newLayout);
    shuffleArray(this.sprites);

    const neededSprites = newLayout.length;

    // Use this.maxSprites instead of a global constant
    for (let i = 0; i < this.maxSprites; i++) {
      const sprite = this.sprites[i];

      if (i < neededSprites) {
        const pt = newLayout[i];

        if (sprite.target.a === 0) {
          sprite.curr.x = this.layoutCenterX + (Math.random() * 30 - 15);
          sprite.curr.y = this.layoutCenterY + (Math.random() * 30 - 15);
          sprite.curr.a = 0;
          sprite.drag = 0.2 + Math.random() * 1.1;
        }

        sprite.isDying = false;
        sprite.set({ x: pt.x + offsetX, y: pt.y + offsetY, a: pt.a ?? 1 });

      } else {
        if (sprite.target.a > 0) {
          sprite.isDying = true;
          sprite.drag = 0.2 + Math.random() * 1.1;
          sprite.set({ a: 0 }); 
        }
      }
    }
  }

  _renderLoop() {
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.ctx.fillStyle = 'rgba(255, 255, 255, 1)';

    // Loop capped at this pool's maximum
    for (let i = 0; i < this.maxSprites; i++) {
      const sprite = this.sprites[i];
      sprite.update(); 

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

// ─── Layout Controllers ──────────────────────────────────────

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

export class SpriteWrite {
  constructor(text, shapesBase = './shapes/letters/', fontSize = 16, densityFactor = 0.4, justify = 'center') {
    this.text = text; 
    this.shapesBase = shapesBase;
    this.fontSize = fontSize; 
    this.densityFactor = densityFactor;
    this.justify = justify; // 'left', 'center', or 'right'
    this.pixelMultiplier = 4; 
    
    // Spacing offsets in pixel space
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

  // Chaining method to update the text without creating a new instance
  morphTo(newText) {
    this.text = newText; 
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