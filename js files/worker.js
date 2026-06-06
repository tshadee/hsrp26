const DEFAULT_SIZE = 4;
const MAX_SPRITES = 10000;

const DEFAULT_SPRITE_SPEED = 0.02;  
const DEFAULT_SPRITE_SPEED_VARIANCE = 0.01;

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

const monitorFPS = 60; 

// Add this near the top of worker.js
const ramCache = new Map();

class ShapeCache {
  static get allFilenames() {
    return [
      // Lowercase
      'a_lower', 'b_lower', 'c_lower', 'd_lower', 'e_lower', 'f_lower', 'g_lower', 'h_lower', 'i_lower', 'j_lower', 'k_lower', 'l_lower', 'm_lower', 'n_lower', 'o_lower', 'p_lower', 'q_lower', 'r_lower', 's_lower', 't_lower', 'u_lower', 'v_lower', 'w_lower', 'x_lower', 'y_lower', 'z_lower',
      // Uppercase
      'A_upper', 'B_upper', 'C_upper', 'D_upper', 'E_upper', 'F_upper', 'G_upper', 'H_upper', 'I_upper', 'J_upper', 'K_upper', 'L_upper', 'M_upper', 'N_upper', 'O_upper', 'P_upper', 'Q_upper', 'R_upper', 'S_upper', 'T_upper', 'U_upper', 'V_upper', 'W_upper', 'X_upper', 'Y_upper', 'Z_upper',
      // Numbers
      '0', '1', '2', '3', '4', '5', '6', '7', '8', '9',
      // Symbols
      'question', 'slash', 'period', 'exclamation', 'at', 'hash', 'dollar', 'percent', 'caret', 'ampersand', 'asterisk', 'left_paren', 'right_paren', 'space', 'comma', 'apostrophe', 'quotation', 'semicolon', 'colon', 'less_than', 'greater_than', 'plus', 'equals', 'dash', 'left_brace', 'right_brace', 'left_bracket', 'right_bracket', 'pipe', 'tilde', 'backtick'
    ];
  }

  static async preload(shapesBase) {
    // Fix the path: since worker is in '/js files/', we need to step back one directory
    const workerPath = shapesBase.replace(/^\.\//, '../');
    const cacheStorage = await caches.open('hsrp-shapes-v1');

    const fetchPromises = this.allFilenames.map(async (filename) => {
      const url = `${workerPath}${filename}.sprites.json`;
      
      // 1. Check RAM cache first
      if (ramCache.has(url)) return;

      // 2. Check persistent Disk Cache
      let response = await cacheStorage.match(url);

      // 3. If not on disk, fetch from Network and save to Disk
      if (!response) {
        try {
          response = await fetch(url);
          if (response.ok) {
             // Clone the response because reading .json() consumes it
            await cacheStorage.put(url, response.clone());
          } else {
             return; // File doesn't exist, skip
          }
        } catch (e) {
          console.warn(`Network fail for ${filename}`);
          return;
        }
      }

      // 4. Parse and store in RAM for 0ms lookup times during morphs
      const data = await response.json();
      ramCache.set(url, data.sprites);
    });

    // Fire all fetches concurrently
    await Promise.all(fetchPromises);
    console.log("All letter sprites cached and ready.");
  }
}

class SpriteChild {
  constructor() {
    this.curr = { x: 0, y: 0, a: 0 };
    this.start = { x: 0, y: 0, a: 0 }; 
    this.target = { x: 0, y: 0, a: 0 };
    this.curlDirection = Math.random()*2 - 1;
    this.curlClockwise = Math.random()*2 - 1;
    
    this.isDying = false;
    this.drag = 0.2 + Math.random() * 1.1; 
    
    this.progress = 1; 
    this.speed = DEFAULT_SPRITE_SPEED + Math.random() * DEFAULT_SPRITE_SPEED_VARIANCE; 
    this.shedThreshold = 2; // Default above 1 so it never sheds normally

    // New variables for expulsion momentum
    this.expelVx = 0;
    this.expelVy = 0;
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
    const oldX = this.curr.x;
    const oldY = this.curr.y;

    // Trigger decimation expulsion when crossing the threshold
    if (!this.isDying && this.progress >= this.shedThreshold) {
      this.isDying = true;
      
      // Calculate current travel vector to use as a base for the burst
      const vx = this.curr.x - this.start.x;
      const vy = this.curr.y - this.start.y;
      
      // Add a random scatter angle to make it an "explosion" rather than a straight line
      const angle = Math.atan2(vy, vx) + (Math.random() - 0.5) * 2;
      const burstForce = 4 + Math.random() * 6; // How violently they are expelled
      
      this.expelVx = Math.cos(angle) * burstForce;
      this.expelVy = Math.sin(angle) * burstForce;
    }

    if (this.isDying) {
      // Apply expulsion momentum with friction so they decelerate nicely
      this.expelVx *= 0.9; 
      this.expelVy *= 0.9;
      
      this.curr.x += this.expelVx * timeScale;
      this.curr.y += this.expelVy * timeScale;
      
      // Frame-independent exponential decay for alpha (fade out quickly)
      const deathDecay = 1 - Math.pow(1 - 0.05, timeScale);
      this.curr.a += (0 - this.curr.a) * deathDecay;
      
      // Keep the curling effect alive
      const globalDx = this.curr.x - oldX;
      const globalDy = this.curr.y - oldY;
      const swerveStrength = this.curlDirection * 0.45 * this.drag; 
      const curlX = -this.curlClockwise * globalDy * swerveStrength;
      const curlY = this.curlClockwise * globalDx * swerveStrength;

      this.curr.x += curlX;
      this.curr.y += curlY;
      return;
    }

    if (this.progress < 1) {
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

    const vx = (this.curr.x - oldX) / timeScale;
    const vy = (this.curr.y - oldY) / timeScale;
    const speed = Math.hypot(vx, vy);
    const dist = Math.hypot(this.target.x - this.curr.x, this.target.y - this.curr.y);

    const kineticAlpha = (speed/4) * 0.6;
    const clampedKineticAlpha = Math.max(0.1, Math.min(1.5, kineticAlpha));

    let deadzoneMix = 0;
    if (dist < 5) {
      deadzoneMix = 1;
    } else if (dist < 15) {
      deadzoneMix = 1 - ((dist - 5) / 10);
    }

    const desiredAlpha = (1 - deadzoneMix) * clampedKineticAlpha + deadzoneMix * this.target.a;
    
    const alphaEase = 1 - Math.pow(1 - 0.2, timeScale);
    this.curr.a += (desiredAlpha - this.curr.a) * alphaEase;
  }
}

// ─── Global Sprite Pool ──────────────────────────────────────

export class SpritePool {
  constructor(canvas, options = {}) {
    this.canvas = canvas; // This is now the OffscreenCanvas from main.js
    this.spriteSize = options.spriteSize ?? 3;
    this.maxSprites = options.maxSprites ?? 1500; 
    
    this.ctx = this.canvas.getContext('2d');
    
    this.layoutCenterX = undefined;
    this.layoutCenterY = undefined;
    this.originX = undefined;
    this.originY = undefined;
    
    // Global pointer tracking for interactivity (updated via messages)
    this.pointerX = -1000;
    this.pointerY = -1000;

    this.sprites = [];
    for (let i = 0; i < this.maxSprites; i++) {
      this.sprites.push(new SpriteChild()); 
    }

    this.lastTime = performance.now();
    this.mutateId = 0;

    this._renderLoop = this._renderLoop.bind(this);
    requestAnimationFrame(this._renderLoop);
  }

  updateBounds(bounds) {
    this.width = bounds.windowWidth;
    this.height = bounds.windowHeight;
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    
    this.originX = bounds.originX;
    this.originY = bounds.originY;

    if (this.layoutCenterX === undefined) {
      this.layoutCenterX = this.originX;
      this.layoutCenterY = this.originY;
    }
    
    // Store localized container dimensions for layout generation
    this.containerWidth = bounds.width;
    this.containerHeight = bounds.height;
  }

  moveTo(newX, newY) {
    // Removed random multiplier to allow for exact translations across the screen.
    // The visual stagger is already handled natively by SpriteChild.set() assigning random speeds.
    const dx = newX - this.layoutCenterX;
    const dy = newY - this.layoutCenterY;

    for (let i = 0; i < this.maxSprites; i++) {
      const sprite = this.sprites[i];
      if (!sprite.isDying && sprite.target.a > 0) {
        sprite.set({ 
          x: sprite.target.x + dx, 
          y: sprite.target.y + dy 
        });
      }
    }

    this.layoutCenterX = newX;
    this.layoutCenterY = newY;
  }

  // Returns the pool back to the element's actual position in the DOM
  resetMove() {
    if (this.originX !== undefined && this.originY !== undefined) {
        this.moveTo(this.originX, this.originY);
    }
  }

  async mutateTo(layoutGenerator) {
    this.mutateId++;
    const currentMutateId = this.mutateId;

    // Reset dying states safely
    for (let i = 0; i < this.maxSprites; i++) {
      const sprite = this.sprites[i];
      if (sprite.isDying && sprite.curr.a < 0.01) {
        sprite.target.a = 0;
      }
      sprite.shedThreshold = 2; 
    }

    const newLayout = await layoutGenerator.getLayout(this.containerWidth, this.containerHeight, this.spriteSize);
    
    if (currentMutateId !== this.mutateId) return;
    
    const offsetX = this.layoutCenterX;
    const offsetY = this.layoutCenterY;

    // 1. Generate absolute targets
    const targets = newLayout.map(pt => ({
      x: pt.x + offsetX,
      y: pt.y + offsetY,
      a: pt.a ?? 1
    }));

    // 2. Build the Spatial Hash Map for O(1) coordinate matching
    const targetMap = new Map();
    for (const pt of targets) {
      // Round to nearest integer to handle floating-point fuzziness 
      const key = `${Math.round(pt.x)},${Math.round(pt.y)}`;
      if (!targetMap.has(key)) targetMap.set(key, []);
      targetMap.get(key).push(pt);
    }

    const freeActiveSprites = [];
    const deadSprites = [];
    const dither = 10; 

    // 3. Match existing active sprites to stationary targets
    for (let i = 0; i < this.maxSprites; i++) {
      const sprite = this.sprites[i];
      
      // If the sprite is active or mid-flight
      if (sprite.curr.a > 0.01 || sprite.target.a > 0) {
        const key = `${Math.round(sprite.target.x)},${Math.round(sprite.target.y)}`;
        const bin = targetMap.get(key);

        if (bin && bin.length > 0) {
          // EXACT MATCH FOUND: Lock the sprite
          const matchedTarget = bin.pop(); // Remove from available targets
          sprite.isDying = false;
          sprite.shedThreshold = 2;
          // Setting a sprite to its current destination causes 0 movement 
          sprite.set({ x: matchedTarget.x, y: matchedTarget.y, a: matchedTarget.a }); 
        } else {
          // NO MATCH: It's a free agent, put it in the migration pool
          freeActiveSprites.push({
            sprite,
            sortKey: (sprite.curr.x + sprite.curr.y) + (Math.random() * dither - dither / 2)
          });
        }
      } else {
        deadSprites.push(sprite);
      }
    }

    // 4. Gather the remaining targets that didn't get locked by stationary sprites
    const remainingTargets = [];
    for (const bin of targetMap.values()) {
      for (const pt of bin) {
        remainingTargets.push({
          ...pt,
          sortKey: (pt.x + pt.y) + (Math.random() * dither - dither / 2)
        });
      }
    }
    
    // Sort the leftovers spatially so they fly cleanly to the remaining targets
    remainingTargets.sort((a, b) => a.sortKey - b.sortKey);
    freeActiveSprites.sort((a, b) => a.sortKey - b.sortKey);

    const neededCount = remainingTargets.length;
    const freeCount = freeActiveSprites.length;

    // Sprite Mapping and prep for decimation on mutate
    for (let i = 0; i < freeCount; i++) {
      const sprite = freeActiveSprites[i].sprite;
      sprite.isDying = false;
      sprite.shedThreshold = 2; 

      if (i < neededCount) {
        const pt = remainingTargets[i];
        sprite.set({ x: pt.x, y: pt.y, a: pt.a });
      } else {
        // Fallbacks so excess sprites safely shed even if morphing to an empty screen
        let randomTarget;
        if (remainingTargets.length > 0) {
          randomTarget = remainingTargets[Math.floor(Math.random() * remainingTargets.length)];
        } else if (targets.length > 0) {
          randomTarget = targets[Math.floor(Math.random() * targets.length)];
        } else {
          randomTarget = { x: this.layoutCenterX, y: this.layoutCenterY, a: 0 };
        }
        
        sprite.set({ x: randomTarget.x, y: randomTarget.y, a: 0 }); 
        sprite.shedThreshold = 0.1 + Math.random() * 0.2; 
      }
    }

    // Sprite Generation 
    let spawnedCount = 0;
    while (freeCount + spawnedCount < neededCount && deadSprites.length > 0) {
      const sprite = deadSprites.pop();
      const pt = remainingTargets[freeCount + spawnedCount];
      
      let guide;
      if (freeCount > 0) {
        const guideIndex = Math.floor(Math.random() * Math.min(freeCount, neededCount));
        guide = freeActiveSprites[guideIndex].sprite;
      } else {
        const activeGuides = this.sprites.filter(s => s.target.a > 0);
        if (activeGuides.length > 0) {
           guide = activeGuides[Math.floor(Math.random() * activeGuides.length)];
        }
      }

      if (guide) {
        // Probability spawn circle around guide sprites
        const angle = Math.random() * Math.PI * 2; // Random direction
        const minRadius = 20;
        const maxRadius = 50; 
        const radius = minRadius + Math.random() * (maxRadius - minRadius); // Random distance

        sprite.curr.x = guide.curr.x + Math.cos(angle) * radius;
        sprite.curr.y = guide.curr.y + Math.sin(angle) * radius;
      } else {
        sprite.curr.x = this.layoutCenterX;
        sprite.curr.y = this.layoutCenterY;
      }

      sprite.curr.a = 0; 
      sprite.isDying = false;
      sprite.shedThreshold = 2; // so they don't get decimated
      sprite.drag = 0.2 + Math.random() * 1.5;
      sprite.set({ x: pt.x, y: pt.y, a: pt.a });
      
      spawnedCount++;
    }
  }

  _renderLoop(timestamp) {
    const dt = timestamp - this.lastTime;
    this.lastTime = timestamp;
    
    const cappedDt = Math.min(dt, 100); 
    const timeScale = cappedDt / 16.666; 

    this.ctx.clearRect(0, 0, this.width, this.height);
    this.ctx.fillStyle = 'rgba(255, 255, 255, 1)';

    for (let i = 0; i < this.maxSprites; i++) {
      const sprite = this.sprites[i];
      
      sprite.update(timeScale); 

      const a = sprite.curr.a;
      if (a < 0.01) continue; 

      const px = sprite.curr.x - (this.spriteSize / 2);
      const py = sprite.curr.y - (this.spriteSize / 2);

      this.ctx.globalAlpha = Math.min(1, a);
      this.ctx.fillRect(px, py, this.spriteSize, this.spriteSize);
    }
    requestAnimationFrame(this._renderLoop);
  }
}

// ─── Layout Controllers ──────────────────────────────────────

export class LayoutController {
  constructor() {
    this.pool = null; 
  }

  attach(pool) {
    this.pool = pool;
    return this; 
  }

  async getLayout(containerWidth, containerHeight, spriteSize) {
    console.warn("getLayout must be implemented by the subclass");
    return [];
  }
}

export class ShapeParent {
  constructor(filename, type) {
    this.filename = filename; 
    
    // Internal routing based on the blueprint type
    const rootPath = '../shapes/';
    const directories = {
        'letter': 'letters/NVMono/',
        'image': 'images/',
        'shape': 'geometric/', // Future proofing
        '3Dshape': 'models/'   // Future proofing
    };

    const targetDir = directories[type] || '';
    this.workerPath = `${rootPath}${targetDir}`;
  }

  async getLayout() {
    const url = `${this.workerPath}${this.filename}.sprites.json`;
    
    // 1. Instant RAM lookup
    if (ramCache.has(url)) return ramCache.get(url);

    // 2. Fetch from network/disk cache
    try {
      const res = await fetch(url);
      if (!res.ok) throw new Error('File not found');
      const data = await res.json();
      ramCache.set(url, data.sprites); 
      return data.sprites;
    } catch (e) {
      console.warn(`Failed to load shape: ${this.filename} at ${url}. Ignoring.`);
      return []; 
    }
  }
}

export class SpriteWrite extends LayoutController {
  constructor(config) {
    super(); 
    this.text = config.text; 
    this.category = config.category;
    this.shapesRoot = config.shapesRoot;
    this.fontSize = config.fontSize; 
    this.densityFactor = config.densityFactor;
    this.justify = config.justify;
    this.pixelMultiplier = config.pixelMultiplier; 
    this.hs = config.hs; 
    this.vs = config.vs; 
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

  async morphTo(newText, forceFlicker = false) {
    if (this.text === newText && !forceFlicker) {
      return this; 
    }

    this.text = newText; 
    
    if (this.pool) {
      await this.pool.mutateTo(this); 
    } else {
      console.warn("SpriteWrite morphed, but it isn't attached to a SpritePool.");
    }
    
    return this; 
  }

  _sanitizeChar(char) {
    const specialCharOutputs = {
        '?': 'question', '/': 'slash', '.': 'period', '!': 'exclamation',
        '@': 'at', '#': 'hash', '$': 'dollar', '%': 'percent', '^': 'caret',
        '&': 'ampersand', '*': 'asterisk', '(': 'left_paren', ')': 'right_paren',
        ' ': 'space', ',': 'comma', "'": 'apostrophe', '"': 'quotation',
        ';': 'semicolon', ':': 'colon', '<': 'less_than', '>': 'greater_than',
        '+': 'plus', '=': 'equals', '-': 'dash', '{': 'left_brace', '}': 'right_brace',
        '[': 'left_bracket', ']': 'right_bracket', '|': 'pipe', '~': 'tilde', '`': 'backtick'
    };

    if (specialCharOutputs[char]) return specialCharOutputs[char];
    if (/[A-Z]/.test(char)) return `${char}_upper`;
    if (/[a-z]/.test(char)) return `${char}_lower`;

    return char;
  }

async getLayout(containerWidth, containerHeight, spriteSize) {
    const finalLayout = [];
    const lines = this.text.split('\n');
    
    const letterScale = this.fontSize * this.pixelMultiplier;
    const letterArea = letterScale * letterScale;
    const spriteArea = spriteSize * spriteSize;
    const targetSpriteCount = Math.floor((letterArea / spriteArea) * this.densityFactor);

    const lineGeometries = lines.map(line => {
      const width = line.length > 0 
        ? (line.length * letterScale) + ((line.length - 1) * this.hs) 
        : 0;
      return { text: line, width: width };
    });

    const maxLineWidth = Math.max(...lineGeometries.map(lg => lg.width));
    const totalHeight = (lines.length * letterScale) + ((lines.length - 1) * this.vs);

    // Center point logic for the block on the Y axis
    let currentY = -(totalHeight / 2);

    for (const lineGeo of lineGeometries) {
      let currentX = 0;
      
      // Plot X relative to bounding box limits
      if (this.justify === 'left') {
        currentX = -(containerWidth / 2);
      } else if (this.justify === 'right') {
        currentX = (containerWidth / 2) - lineGeo.width;
      } else { 
        currentX = -(lineGeo.width / 2);
      }

      for (let i = 0; i < lineGeo.text.length; i++) {
        const char = lineGeo.text[i];

        if (char !== ' ') {
          const safeFilename = this._sanitizeChar(char);
          const letterBlueprint = new ShapeParent(safeFilename, 'letter');
          let spriteData = await letterBlueprint.getLayout();

          if (spriteData.length > targetSpriteCount) {
            shuffleArray(spriteData); 
            spriteData = spriteData.slice(0, targetSpriteCount);
          }

          for (const pt of spriteData) {
            finalLayout.push({
              x: currentX + (pt.x * letterScale),
              y: currentY + (pt.y * letterScale),
              a: pt.a
            });
          }
        }
        
        currentX += letterScale + this.hs;
      }
      currentY += letterScale + this.vs;
    }
    
    return finalLayout;
  }
}

export class SpriteImage extends LayoutController {
  constructor(config) {
    super(); 
    this.filename = config.filename; 
    this.category = config.category;
    this.shapesRoot = config.shapesRoot;
    this.scale = config.scale; 
    this.densityFactor = config.densityFactor;
  }

  async getLayout(containerWidth, containerHeight, spriteSize) {
    const finalLayout = [];
    
    // Fetch the raw normalized data from the image map
    const imageBlueprint = new ShapeParent(this.filename, 'image');
    let spriteData = await imageBlueprint.getLayout();

    if (!spriteData || spriteData.length === 0) return [];

    // Optional Density Filtering (similar to text)
    const imageArea = this.scale * this.scale;
    const spriteArea = spriteSize * spriteSize;
    const targetSpriteCount = Math.floor((imageArea / spriteArea) * this.densityFactor);

    if (spriteData.length > targetSpriteCount) {
      shuffleArray(spriteData); 
      spriteData = spriteData.slice(0, targetSpriteCount);
    }

    // Process coordinates
    for (const pt of spriteData) {
      finalLayout.push({
        // Since image coordinates are normalized 0.0 to 1.0, 
        // subtracting 0.5 centers the image perfectly around (0,0)
        x: (pt.x - 0.5) * this.scale,
        y: (pt.y - 0.5) * this.scale,
        a: pt.a
      });
    }
    
    return finalLayout;
  }
}


let pool = null;

self.onmessage = async (e) => {
  const data = e.data;

  switch (data.type) {
    case 'INIT':
      pool = new SpritePool(data.canvas, data.options);
      // Preload default font (you can adjust this path to match your actual default font folder)
      ShapeCache.preload('./shapes/letters/NVMono/');
      break;
    case 'UPDATE_BOUNDS':
      if (pool) pool.updateBounds(data.bounds);
      break;
    case 'POINTER_MOVE':
      if (pool) {
        pool.pointerX = data.x;
        pool.pointerY = data.y;
      }
      break;
    case 'MOVE_TO':
      if (pool) pool.moveTo(data.x, data.y);
      break;
    case 'RESET_MOVE':
      if (pool) pool.resetMove();
      break;
    case 'MORPH':
      if (pool) {
        // Route the config to the correct local layout generator based on type
        if (data.layoutType === 'SpriteWrite') {
          const generator = new SpriteWrite(data.config);
          await pool.mutateTo(generator);
        } else if (data.layoutType === 'SpriteImage') {
          const generator = new SpriteImage(data.config);
          await pool.mutateTo(generator);
        }
      }
      break;
  }
};