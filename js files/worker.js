const DEFAULT_SIZE = 4;
const MAX_SPRITES = 10000;

const DEFAULT_SPRITE_SPEED = 0.02;  
const DEFAULT_SPRITE_SPEED_VARIANCE = 0.01;


const STRIDE = 18; // 18 floats per sprite

// Offsets mapping to your old SpriteChild properties
const X = 0, Y = 1, A = 2;
const TX = 3, TY = 4, TA = 5;      // Target
const SX = 6, SY = 7, SA = 8;      // Start
const PROG = 9, SPEED = 10, DRAG = 11;
const DYING = 12, SHED = 13;       // 0 for false, 1 for true
const EVX = 14, EVY = 15;          // Expel Velocity
const CURL_DIR = 16, CURL_CW = 17;

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

// ─── Global Sprite Pool ──────────────────────────────────────

export class SpritePool {
  constructor(canvas, options = {}) {
    this.maxSprites = options.maxSprites ?? 50000;
    
    // Allocate memory
    this.data = new Float32Array(this.maxSprites * STRIDE);
    this.activeIndices = new Int32Array(this.maxSprites);
    this.activeHashes = new Float64Array(this.maxSprites * STRIDE); // Float64 handles massive integer hashes
    this.freeIndices = new Int32Array(this.maxSprites);
    this.deadIndices = new Int32Array(this.maxSprites);
    this.remainingTargets = []; // Reusable array for leftover targets
    
    // Initialize standard randoms once
    for (let i = 0; i < this.maxSprites; i++) {
      let idx = i * STRIDE;
      this.data[idx + X] = 0;
      this.data[idx + Y] = 0;
      this.data[idx + A] = 0;
      this.data[idx + TX] = 0;
      this.data[idx + TY] = 0;
      this.data[idx + TA] = 0;
      this.data[idx + CURL_DIR] = Math.random() * 2 - 1;
      this.data[idx + CURL_CW] = Math.random() * 2 - 1;
      this.data[idx + DRAG] = 0.2 + Math.random() * 1.1;
      this.data[idx + SPEED] = DEFAULT_SPRITE_SPEED + Math.random() * DEFAULT_SPRITE_SPEED_VARIANCE;
      this.data[idx + SHED] = 2; 
      this.data[idx + DYING] = 0;
    }

    this.canvas = canvas; 
    this.spriteSize = options.spriteSize ?? 3;
    this.ctx = this.canvas.getContext('2d');
    
    this.layoutCenterX = undefined;
    this.layoutCenterY = undefined;
    this.originX = undefined;
    this.originY = undefined;
    
    this.pointerX = -1000;
    this.pointerY = -1000;

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
      
      // Seed initial positions to origin so they don't fly in from 0,0
      for(let i=0; i < this.maxSprites; i++) {
        let idx = i * STRIDE;
        this.data[idx + X] = this.originX;
        this.data[idx + Y] = this.originY;
      }
    }
    
    this.containerWidth = bounds.width;
    this.containerHeight = bounds.height;
  }

  // --- NEW HELPER: Replaces sprite.set() ---
  setSpriteTarget(idx, tx, ty, ta) {
    this.data[idx + SX] = this.data[idx + X];
    this.data[idx + SY] = this.data[idx + Y];
    this.data[idx + SA] = this.data[idx + A];

    if (tx !== undefined) this.data[idx + TX] = tx;
    if (ty !== undefined) this.data[idx + TY] = ty;
    if (ta !== undefined) this.data[idx + TA] = ta; 

    this.data[idx + PROG] = 0; 
    this.data[idx + SPEED] = DEFAULT_SPRITE_SPEED + Math.random() * DEFAULT_SPRITE_SPEED_VARIANCE;
  }

  moveTo(newX, newY) {
    if (this.layoutCenterX === undefined) return;
    const dx = newX - this.layoutCenterX;
    const dy = newY - this.layoutCenterY;

    for (let i = 0; i < this.maxSprites; i++) {
      let idx = i * STRIDE;
      if (this.data[idx + DYING] === 0 && this.data[idx + TA] > 0) {
        this.setSpriteTarget(idx, this.data[idx + TX] + dx, this.data[idx + TY] + dy, this.data[idx + TA]);
      }
    }

    this.layoutCenterX = newX;
    this.layoutCenterY = newY;
  }

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
      let idx = i * STRIDE;
      if (this.data[idx + DYING] === 1 && this.data[idx + A] < 0.01) {
        this.data[idx + TA] = 0;
      }
      this.data[idx + SHED] = 2; 
    }

    const newLayout = await layoutGenerator.getLayout(this.containerWidth, this.containerHeight, this.spriteSize);
    if (currentMutateId !== this.mutateId) return;
    
    const offsetX = this.layoutCenterX || 0;
    const offsetY = this.layoutCenterY || 0;

    let activeCount = 0;
    let deadCount = 0;

    // 1. Calculate EXACT Integer Hashes
    for (let i = 0; i < this.maxSprites; i++) {
      let idx = i * STRIDE;
      
      if (this.data[idx + A] > 0.01 || this.data[idx + TA] > 0) {
        this.activeIndices[activeCount] = idx;
        
        // Integer Hashing: Replaces the old `${x},${y}` string map
        const rx = Math.round(this.data[idx + TX]) + 10000;
        const ry = Math.round(this.data[idx + TY]) + 10000;
        this.activeHashes[idx] = (ry * 100000) + rx;
        
        activeCount++;
      } else {
        this.deadIndices[deadCount] = idx;
        deadCount++;
      }
    }

    // 2. Sort Active Sprites by Hash
    const activeView = this.activeIndices.subarray(0, activeCount);
    activeView.sort((idxA, idxB) => this.activeHashes[idxA] - this.activeHashes[idxB]);

    // 3. Prepare and Sort Targets by Hash
    const targetCount = newLayout.length;
    for (let i = 0; i < targetCount; i++) {
       const pt = newLayout[i];
       
       // Detect absolute coordinates from SpriteGroups
       pt.tx = pt.isAbsolute ? pt.x : pt.x + offsetX;
       pt.ty = pt.isAbsolute ? pt.y : pt.y + offsetY;
       
       const rx = Math.round(pt.tx) + 10000;
       const ry = Math.round(pt.ty) + 10000;
       pt.hash = (ry * 100000) + rx;
    }
    newLayout.sort((a, b) => a.hash - b.hash);

    // 4. Two-Pointer Exact Intersection (The "Locking" Phase)
    let pA = 0; // Pointer for Active
    let pT = 0; // Pointer for Targets
    let freeCount = 0;
    
    // Clear reusable array safely
    this.remainingTargets.length = 0; 

    while (pA < activeCount && pT < targetCount) {
      let idx = activeView[pA];
      let hashA = this.activeHashes[idx];
      let target = newLayout[pT];
      let hashT = target.hash;

      if (hashA === hashT) {
        // EXACT MATCH: Lock the sprite in place
        this.data[idx + DYING] = 0;
        this.data[idx + SHED] = 2;
        this.setSpriteTarget(idx, target.tx, target.ty, target.a ?? 1);
        pA++; 
        pT++;
      } else if (hashA < hashT) {
        // Active sprite has no matching target (Free Agent)
        this.freeIndices[freeCount++] = idx;
        pA++;
      } else {
        // Target has no matching sprite (Unclaimed)
        this.remainingTargets.push(target);
        pT++;
      }
    }

    // Sweep up leftovers
    while (pA < activeCount) this.freeIndices[freeCount++] = activeView[pA++];
    while (pT < targetCount) this.remainingTargets.push(newLayout[pT++]);

    // 5. The Migration Phase (For changed pixels only)
    const remainingCount = this.remainingTargets.length;
    const dither = 10;

    // Sort leftovers spatially to prevent criss-crossing (Restoring your original x+y logic)
    const freeView = this.freeIndices.subarray(0, freeCount);
    freeView.sort((idxA, idxB) => (this.data[idxA + X] + this.data[idxA + Y]) - (this.data[idxB + X] + this.data[idxB + Y]));
    this.remainingTargets.sort((a, b) => (a.tx + a.ty) - (b.tx + b.ty));

    for (let i = 0; i < freeCount; i++) {
      let idx = freeView[i];
      this.data[idx + DYING] = 0;
      this.data[idx + SHED] = 2; 

      if (i < remainingCount) {
        const pt = this.remainingTargets[i];
        this.setSpriteTarget(idx, pt.tx, pt.ty, pt.a ?? 1);
      } else {
        // Excess sprites shed
        let randomTarget;
        if (remainingCount > 0) {
          randomTarget = this.remainingTargets[Math.floor(Math.random() * remainingCount)];
        } else if (targetCount > 0) {
          randomTarget = newLayout[Math.floor(Math.random() * targetCount)];
        } else {
          randomTarget = { tx: this.layoutCenterX, ty: this.layoutCenterY, a: 0 };
        }
        this.setSpriteTarget(idx, randomTarget.tx, randomTarget.ty, 0); 
        this.data[idx + SHED] = 0.1 + Math.random() * 0.2; 
      }
    }

    // 6. Spawn Phase
    let spawnedCount = 0;
    while (freeCount + spawnedCount < remainingCount && deadCount > 0) {
      deadCount--;
      let idx = this.deadIndices[deadCount]; 
      const pt = this.remainingTargets[freeCount + spawnedCount];
      
      let guideIdx = -1;
      if (freeCount > 0) {
        guideIdx = freeView[Math.floor(Math.random() * freeCount)];
      }

      if (guideIdx !== -1) {
        const angle = Math.random() * Math.PI * 2; 
        const radius = 20 + Math.random() * 30; 
        this.data[idx + X] = this.data[guideIdx + X] + Math.cos(angle) * radius;
        this.data[idx + Y] = this.data[guideIdx + Y] + Math.sin(angle) * radius;
      } else {
        // Spawn in a dithered sphere around the intended target coordinate
        const angle = Math.random() * Math.PI * 2;
        const radius = 20 + Math.random() * 30; // Adjust radius here for wider/tighter initial spawn
        this.data[idx + X] = pt.tx + Math.cos(angle) * radius;
        this.data[idx + Y] = pt.ty + Math.sin(angle) * radius;
      }

      this.data[idx + A] = 0; 
      this.data[idx + DYING] = 0;
      this.data[idx + SHED] = 2; 
      this.data[idx + DRAG] = 0.2 + Math.random() * 1.5;
      
      this.setSpriteTarget(idx, pt.tx, pt.ty, pt.a ?? 1);
      spawnedCount++;
    }
  }

  _renderLoop(timestamp) {
    const dt = timestamp - this.lastTime;
    this.lastTime = timestamp;
    const timeScale = Math.min(dt, 100) / 16.666; 

    this.ctx.clearRect(0, 0, this.width, this.height);
    this.ctx.fillStyle = 'rgba(255, 255, 255, 1)';

    const data = this.data; 

    for (let i = 0; i < this.maxSprites; i++) {
      let idx = i * STRIDE;
      
      // Early exit for dead sprites
      if (data[idx + A] === 0 && data[idx + TA] <= 0) continue;

      const oldX = data[idx + X];
      const oldY = data[idx + Y];
      let isDying = data[idx + DYING] === 1;

      // 1. Trigger Decimation
      if (!isDying && data[idx + PROG] >= data[idx + SHED]) {
        isDying = true;
        data[idx + DYING] = 1;
        data[idx + TA] = 0; // Wipe the target alpha so it knows to stay dead
        
        const vx = data[idx + X] - data[idx + SX];
        const vy = data[idx + Y] - data[idx + SY];
        const angle = Math.atan2(vy, vx) + (Math.random() - 0.5) * 2;
        const burstForce = 4 + Math.random() * 6;
        
        data[idx + EVX] = Math.cos(angle) * burstForce;
        data[idx + EVY] = Math.sin(angle) * burstForce;
      }

      // 2. State Routing
      if (isDying) {
        // --- DYING STATE ---
        data[idx + EVX] *= 0.9;
        data[idx + EVY] *= 0.9;
        data[idx + X] += data[idx + EVX] * timeScale;
        data[idx + Y] += data[idx + EVY] * timeScale;
        
        const decayBase = 1 - 0.05;
        const deathDecay = 1 - Math.exp(Math.log(decayBase) * timeScale); 
        data[idx + A] += (0 - data[idx + A]) * deathDecay;
        
        const globalDx = data[idx + X] - oldX;
        const globalDy = data[idx + Y] - oldY;
        const swerveStrength = data[idx + CURL_DIR] * 0.45 * data[idx + DRAG]; 
        
        data[idx + X] += -data[idx + CURL_CW] * globalDy * swerveStrength;
        data[idx + Y] += data[idx + CURL_CW] * globalDx * swerveStrength;

      } else {
        // --- ALIVE STATE ---
        if (data[idx + PROG] < 1) {
          data[idx + PROG] += data[idx + SPEED] * data[idx + DRAG] * timeScale;
          if (data[idx + PROG] > 1) data[idx + PROG] = 1;

          const t = data[idx + PROG];
          let ease;
          if (t < 0.5) {
            ease = 4 * t * t * t;
          } else {
            const val = -2 * t + 2;
            ease = 1 - (val * val * val * val) / 2; 
          }

          const globalDx = data[idx + TX] - data[idx + SX];
          const globalDy = data[idx + TY] - data[idx + SY];

          const baseX = data[idx + SX] + globalDx * ease;
          const baseY = data[idx + SY] + globalDy * ease;

          const turbulenceForce = Math.sin(t * Math.PI); 
          const swerveStrength = data[idx + CURL_DIR] * 0.05 * turbulenceForce * data[idx + DRAG]; 
          
          data[idx + X] = baseX + (-globalDy * swerveStrength);
          data[idx + Y] = baseY + (globalDx * swerveStrength);
        }

        // Kinetic Alpha / Speed calc (ONLY runs if Alive)
        const vx = (data[idx + X] - oldX) / timeScale;
        const vy = (data[idx + Y] - oldY) / timeScale;
        const speedSq = vx * vx + vy * vy; 
        const speed = Math.sqrt(speedSq); 

        const targetDistSq = (data[idx + TX] - data[idx + X])**2 + (data[idx + TY] - data[idx + Y])**2;
        const dist = Math.sqrt(targetDistSq);

        const kineticAlpha = (speed/4) * 0.6;
        const clampedKineticAlpha = Math.max(0.1, Math.min(1.5, kineticAlpha));

        let deadzoneMix = 0;
        if (dist < 5) {
          deadzoneMix = 1;
        } else if (dist < 15) {
          deadzoneMix = 1 - ((dist - 5) / 10);
        }

        const desiredAlpha = (1 - deadzoneMix) * clampedKineticAlpha + deadzoneMix * data[idx + TA];
        const alphaEaseBase = 1 - 0.2;
        const alphaEase = 1 - Math.exp(Math.log(alphaEaseBase) * timeScale);
        
        data[idx + A] += (desiredAlpha - data[idx + A]) * alphaEase;
      }

      // 3. Floating-Point Hard Clamp & Drawing
      if (data[idx + A] < 0.005) {
        data[idx + A] = 0; // Snap it to absolute zero so the early exit catches it next frame
      } else if (data[idx + A] >= 0.01) {
        this.ctx.globalAlpha = Math.min(1, data[idx + A]);
        this.ctx.fillRect(data[idx + X] - (this.spriteSize / 2), data[idx + Y] - (this.spriteSize / 2), this.spriteSize, this.spriteSize);
      }
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
        let generator;
        if (data.layoutType === 'SpriteWrite') generator = new SpriteWrite(data.config);
        else if (data.layoutType === 'SpriteImage') generator = new SpriteImage(data.config);
        else if (data.layoutType === 'SpriteGroup') generator = new SpriteGroup(data.config); // Add this
        
        if (generator) await pool.mutateTo(generator);
      }
      break;
  }
};

export class SpriteGroup extends LayoutController {
  constructor(config) {
    super();
    this.children = config.children;
  }

  async getLayout(containerWidth, containerHeight, spriteSize) {
    const finalLayout = [];
    
    for (const child of this.children) {
      let generator;
      if (child.type === 'SpriteWrite') generator = new SpriteWrite(child.config);
      else if (child.type === 'SpriteImage') generator = new SpriteImage(child.config);

      if (generator) {
        const layout = await generator.getLayout(containerWidth, containerHeight, spriteSize);
        for (const pt of layout) {
          finalLayout.push({
            x: pt.x + child.offsetX,
            y: pt.y + child.offsetY,
            a: pt.a,
            isAbsolute: true // Flag to bypass the global pool offset
          });
        }
      }
    }
    return finalLayout;
  }
}