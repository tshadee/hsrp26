let DEFAULT_SPRITE_SPEED = 0.15;  
let DEFAULT_SPRITE_SPEED_VARIANCE = 0.04;

let SPRITE_DRAG_BASE = 0.1;
let SPRITE_DRAG_VARIANCE = 0.4;

let SPRITE_SPAWN_RADIUS_BASE = 20;
let SPRITE_SPAWN_RADIUS_VARIANCE = 30;

let SPRITE_CLICK_FORCE = 10;
let SPRITE_CLICK_FORCE_RADIUS = 0.085;

let SPRITE_HOVER_RADIUS = 0.025;

let MORPH_TIME_CULLING_MS = 2500;

let K_ALPHA_MULTIPLIER = 0.85;

let YIELD_BATCH_SIZE_PER_FRAME = 333;

let SPRITE_SHEDDING_THRESHOLD = 0.125;


//below should not be exposed to user for obvious reasons

const MAX_SPRITES = 100000; // TODO: put in debug menu or else someone's PC WILL explode
const STRIDE = 19; // floats per sprite

// Offsets mapping 
const X = 0, Y = 1, A = 2;
const TX = 3, TY = 4, TA = 5;      // Target
const SX = 6, SY = 7, SA = 8;      // Start
const PROG = 9, SPEED = 10, DRAG = 11;
const DYING = 12, SHED = 13;       // 0 for false, 1 for true
const EVX = 14, EVY = 15;          // Expel Velocity
const CURL_DIR = 16, CURL_CW = 17;
const IS_UI = 18;


//TODO: moving shader source to physengine.glsl

const shader_vertex_source_path = './physengine.vert.glsl'
const shader_fragment_source_path = './physengine.frag.glsl'

const vsSource = `
  attribute vec2 a_position;
  attribute float a_alpha;
  
  uniform vec2 u_resolution;
  uniform float u_spriteSize;
  
  varying float v_alpha;

  void main() {
    // Convert pixels from 0->resolution to 0.0->1.0
    vec2 zeroToOne = a_position / u_resolution;
    // Convert from 0->1 to 0->2
    vec2 zeroToTwo = zeroToOne * 2.0;
    // Convert from 0->2 to -1->+1 (clip space)
    vec2 clipSpace = zeroToTwo - 1.0;
    
    // WebGL Y is inverted compared to Canvas 2D, so we flip it
    gl_Position = vec4(clipSpace * vec2(1, -1), 0, 1);
    
    // Set point size and pass alpha to the fragment shader
    gl_PointSize = u_spriteSize;
    v_alpha = a_alpha;
  }
`;

const fsSource = `
  precision mediump float;
  varying float v_alpha;

  void main() {
    // If alpha is zero, discard the pixel entirely to save GPU cycles
    if (v_alpha <= 0.005) {
      discard; 
    }
    // Draw a white square with the calculated alpha
    gl_FragColor = vec4(1.0, 1.0, 1.0, v_alpha);
  }
`;

function getSeededRandom(seed) {
  return function() {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280;
  };
}

function shuffleArray(array, seed = 12345) {
  const rng = getSeededRandom(seed);
  for (let i = array.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

const yieldFrame = () => new Promise(resolve => requestAnimationFrame(resolve));

const ramCache = new Map();

//absolute cinema function right here 
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

class ShaderLoader {
  static async load(vertPath, fragPath) {
    const cacheStorage = await caches.open('hsrp-shaders-v1');
    const sources = {};

    const fetchShader = async (url, type) => {
      let response = await cacheStorage.match(url);
      
      if (!response) {
        try {
          response = await fetch(url);
          if (response.ok) {
            await cacheStorage.put(url, response.clone());
          } else {
            throw new Error(`Failed to fetch ${url}`);
          }
        } catch (e) {
          console.error(`Network fail for shader: ${url}`, e);
          return null;
        }
      }
      sources[type] = await response.text();
    };

    await Promise.all([
      fetchShader(vertPath, 'vertex'),
      fetchShader(fragPath, 'fragment')
    ]);

    return sources;
  }
}

// ─── Global Sprite Pool ──────────────────────────────────────

export class SpritePool {
  constructor(canvas, options = {}) {
    this.maxSprites = options.maxSprites ?? 50000;
    
    // Allocate memory
    this.data = new Float32Array(this.maxSprites * STRIDE);
    this.activeIndices = new Int32Array(this.maxSprites);
    this.activeHashes = new Float64Array(this.maxSprites * STRIDE); 
    this.freeIndices = new Int32Array(this.maxSprites);
    this.deadIndices = new Int32Array(this.maxSprites);
    this.remainingTargets = []; // array for leftover targets
    this.gridHead = new Int32Array(22500); // 150 x 150 grid
    this.gridNext = new Int32Array(this.maxSprites);
    this.targetClaimed = new Uint8Array(this.maxSprites);
    
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
      this.data[idx + DRAG] = SPRITE_DRAG_BASE + Math.random() * SPRITE_DRAG_VARIANCE;
      this.data[idx + SPEED] = DEFAULT_SPRITE_SPEED + Math.random() * DEFAULT_SPRITE_SPEED_VARIANCE;
      this.data[idx + SHED] = 2; 
      this.data[idx + DYING] = 0;
    }

    this.canvas = canvas; 
    this.spriteSize = options.spriteSize ?? 3;
    this.interactionType = options.interactionType ?? 'ui'; // Store interaction type
    this.lastMorphTime = performance.now(); // Track last morph

    this.gl = this.canvas.getContext('webgl2', { premultipliedAlpha: false }) || 
          this.canvas.getContext('webgl', { premultipliedAlpha: false });

    const gl = this.gl;

    // Enable alpha blending
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // 1. Compile Shaders & Link Program
    const vertexShader = this._compileShader(gl, gl.VERTEX_SHADER, vsSource);
    const fragmentShader = this._compileShader(gl, gl.FRAGMENT_SHADER, fsSource);
    this.program = gl.createProgram();
    gl.attachShader(this.program, vertexShader);
    gl.attachShader(this.program, fragmentShader);
    gl.linkProgram(this.program);
    gl.useProgram(this.program);

    // 2. Look up locations
    this.posLoc = gl.getAttribLocation(this.program, "a_position");
    this.alphaLoc = gl.getAttribLocation(this.program, "a_alpha");
    this.resLoc = gl.getUniformLocation(this.program, "u_resolution");
    this.sizeLoc = gl.getUniformLocation(this.program, "u_spriteSize");

    // 3. Create the GPU buffer
    this.buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    // Allocate GPU memory once using DYNAMIC_DRAW (since we update it every frame)
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);

    // 4. Teach WebGL how to read interleaved array
    const BYTES_PER_FLOAT = 4;
    const STRIDE_BYTES = STRIDE * BYTES_PER_FLOAT;

    gl.enableVertexAttribArray(this.posLoc);
    // Read 2 floats (x, y), skip STRIDE bytes, start at offset 0
    gl.vertexAttribPointer(this.posLoc, 2, gl.FLOAT, false, STRIDE_BYTES, 0);

    gl.enableVertexAttribArray(this.alphaLoc);
    // Read 1 float (alpha), skip STRIDE bytes, start at offset 2 floats (8 bytes)
    gl.vertexAttribPointer(this.alphaLoc, 1, gl.FLOAT, false, STRIDE_BYTES, 2 * BYTES_PER_FLOAT);
    
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

    this.gl.viewport(0, 0, this.width, this.height);
    this.gl.uniform2f(this.resLoc, this.width, this.height);
    this.gl.uniform1f(this.sizeLoc, this.spriteSize * 1.15);

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


  setSpriteTarget(idx, tx, ty, ta, isUI = 0) {
    this.data[idx + SX] = this.data[idx + X];
    this.data[idx + SY] = this.data[idx + Y];
    this.data[idx + SA] = this.data[idx + A];

    if (tx !== undefined) this.data[idx + TX] = tx;
    if (ty !== undefined) this.data[idx + TY] = ty;
    if (ta !== undefined) this.data[idx + TA] = ta; 
    if (isUI !== undefined) this.data[idx + IS_UI] = isUI; // Write the flag

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
    this.lastMorphTime = performance.now();
    const currentMutateId = ++this.mutateId;

    const result = await layoutGenerator.getLayout(this.containerWidth, this.containerHeight, this.spriteSize);
    if (currentMutateId !== this.mutateId) return;
    
    const newLayout = result.layout || result;
    const zones = result.zones || [];

    self.postMessage({ type: 'INTERACTIVE_ZONES', zones: zones });

    const offsetX = this.layoutCenterX || 0;
    const offsetY = this.layoutCenterY || 0;

    // Reset dying states safely
    for (let i = 0; i < this.maxSprites; i++) {
      let idx = i * STRIDE;
      if (this.data[idx + DYING] === 1 && this.data[idx + A] < 0.01) {
        this.data[idx + TA] = 0;
      }
      this.data[idx + SHED] = 2; 
    }

    let activeCount = 0;
    let deadCount = 0;
    let freeCount = 0; // Initialize freeCount early

    // 1. Calculate EXACT Hashes & Route Dying Sprites
    for (let i = 0; i < this.maxSprites; i++) {
      let idx = i * STRIDE;
      
      if (this.data[idx + A] > 0.01 || this.data[idx + TA] > 0) {
        if (this.data[idx + DYING] === 1) {
          this.freeIndices[freeCount++] = idx;
        } else {
          this.activeIndices[activeCount] = idx;
          // fround forces JS Float64s into Float32 precision before rounding
          const tx32 = Math.fround(this.data[idx + TX]);
          const ty32 = Math.fround(this.data[idx + TY]);
          const rx = Math.round(tx32) + 10000;
          const ry = Math.round(ty32) + 10000;
          this.activeHashes[idx] = (ry * 100000) + rx;
          activeCount++;
        }
      } else {
        this.deadIndices[deadCount++] = idx;
      }
    }

    // 2. Sort Active Sprites & Targets by Exact Hash
    const activeView = this.activeIndices.subarray(0, activeCount);
    activeView.sort((idxA, idxB) => this.activeHashes[idxA] - this.activeHashes[idxB]);

    const targetCount = newLayout.length;
    for (let i = 0; i < targetCount; i++) {
       const pt = newLayout[i];
       pt.tx = pt.isAbsolute ? pt.x : pt.x + offsetX;
       pt.ty = pt.isAbsolute ? pt.y : pt.y + offsetY;
       
       // fround fix, again
       const tx32 = Math.fround(pt.tx);
       const ty32 = Math.fround(pt.ty);
       const rx = Math.round(tx32) + 10000;
       const ry = Math.round(ty32) + 10000;
       pt.hash = (ry * 100000) + rx;
    }
    newLayout.sort((a, b) => a.hash - b.hash);

    // 3. Two-Pointer EXACT Intersection (The "Locking" Phase)
    let pA = 0;
    let pT = 0;
    this.remainingTargets.length = 0; 

    while (pA < activeCount && pT < targetCount) {
      let idx = activeView[pA];
      let hashA = this.activeHashes[idx];
      let target = newLayout[pT];

      if (hashA === target.hash) {
        this.data[idx + DYING] = 0;
        this.data[idx + SHED] = 2;
        this.data[idx + TA] = target.a ?? 1;
        this.data[idx + IS_UI] = target.isUI ?? 0;
        pA++; pT++;
      } else if (hashA < target.hash) {
        this.freeIndices[freeCount++] = idx; // Appends to the pre-populated dying sprites
        pA++;
      } else {
        this.remainingTargets.push(target);
        pT++;
      }
    }

    while (pA < activeCount) this.freeIndices[freeCount++] = activeView[pA++];
    while (pT < targetCount) this.remainingTargets.push(newLayout[pT++]);

    // 4. ECS SPATIAL HASHING (The "Rearrange" Phase)
    const remainingCount = this.remainingTargets.length;
    const CHUNK_SIZE = 64; 
    const GRID_COLS = 150; 
    const GRID_ROWS = 150;
    const OFFSET = 3000; // Shift bounds so offscreen coordinates don't break the array index

    this.gridHead.fill(-1);
    this.targetClaimed.fill(0, 0, remainingCount);

    // Populate the flat spatial grid with leftover targets
    for (let i = 0; i < remainingCount; i++) {
      const pt = this.remainingTargets[i];
      const cx = Math.floor((pt.tx + OFFSET) / CHUNK_SIZE);
      const cy = Math.floor((pt.ty + OFFSET) / CHUNK_SIZE);
      
      const safeCx = Math.max(0, Math.min(GRID_COLS - 1, cx));
      const safeCy = Math.max(0, Math.min(GRID_ROWS - 1, cy));
      const cell = safeCy * GRID_COLS + safeCx;

      this.gridNext[i] = this.gridHead[cell];
      this.gridHead[cell] = i;
    }

    // 333 per frame @ 60fps = ~20,000 sprites processed per second
    const BATCH_SIZE = YIELD_BATCH_SIZE_PER_FRAME;

    // 5. Localized Nearest-Neighbor Assignment
    const MAX_MORPH_DIST = 150;
    const MAX_MORPH_DIST_SQ = MAX_MORPH_DIST * MAX_MORPH_DIST;
    
    for (let i = 0; i < freeCount; i++) {

      if (i > 0 && i % BATCH_SIZE === 0) {
        this.lastMorphTime = performance.now(); // Keep awake
        await yieldFrame(); 
        if (currentMutateId !== this.mutateId) return; 
      }


      let idx = this.freeIndices[i];
      let sx = this.data[idx + X];
      let sy = this.data[idx + Y];
      
      let cx = Math.floor((sx + OFFSET) / CHUNK_SIZE);
      let cy = Math.floor((sy + OFFSET) / CHUNK_SIZE);

      let bestTargetIdx = -1;
      let bestDistSq = MAX_MORPH_DIST_SQ;

      // Scan the immediate 3x3 chunk neighborhood
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          let checkCx = cx + dx;
          let checkCy = cy + dy;
          
          if (checkCx >= 0 && checkCx < GRID_COLS && checkCy >= 0 && checkCy < GRID_ROWS) {
            let cell = checkCy * GRID_COLS + checkCx;
            let targetIdx = this.gridHead[cell];
            
            // Traverse the linked list in this chunk
            while (targetIdx !== -1) {
              if (this.targetClaimed[targetIdx] === 0) {
                let pt = this.remainingTargets[targetIdx];
                let distX = sx - pt.tx;
                let distY = sy - pt.ty;
                let distSq = distX * distX + distY * distY;
                
                if (distSq < bestDistSq) {
                  bestDistSq = distSq;
                  bestTargetIdx = targetIdx;
                }
              }
              targetIdx = this.gridNext[targetIdx];
            }
          }
        }
      }

      if (bestTargetIdx !== -1) {
        // Claim target in range
        this.targetClaimed[bestTargetIdx] = 1;
        const pt = this.remainingTargets[bestTargetIdx];
        this.data[idx + DYING] = 0;
        this.data[idx + SHED] = 2; 
        this.setSpriteTarget(idx, pt.tx, pt.ty, pt.a ?? 1, pt.isUI ?? 0);
      } else {
        // No text targets left within 150px. Decimate and dissolve.
        const driftAngle = Math.random() * Math.PI * 2;
        const driftRadius = 80 + Math.random() * 80;
        
        this.setSpriteTarget(idx, sx + Math.cos(driftAngle) * driftRadius, sy + Math.sin(driftAngle) * driftRadius, 0, 0); 
        this.data[idx + SHED] = SPRITE_SHEDDING_THRESHOLD + Math.random() * SPRITE_SHEDDING_THRESHOLD * 2;
      }
    }

    // 6. Localized Spawn Phase (For unfulfilled targets)
    for (let i = 0; i < remainingCount; i++) {

      if (i > 0 && i % BATCH_SIZE === 0) {
        this.lastMorphTime = performance.now(); // Keep awake
        await yieldFrame();
        if (currentMutateId !== this.mutateId) return;
      }

      if (this.targetClaimed[i] === 0) {
        if (deadCount > 0) {
          deadCount--;
          let idx = this.deadIndices[deadCount]; 
          const pt = this.remainingTargets[i];
          
          const angle = Math.random() * Math.PI * 2;
          const radius = SPRITE_SPAWN_RADIUS_BASE + Math.random() * SPRITE_SPAWN_RADIUS_VARIANCE; 
          this.data[idx + X] = pt.tx + Math.cos(angle) * radius;
          this.data[idx + Y] = pt.ty + Math.sin(angle) * radius;
          this.data[idx + A] = 0; 
          this.data[idx + DYING] = 0;
          this.data[idx + SHED] = 2; 
          this.data[idx + DRAG] = SPRITE_DRAG_BASE + Math.random() * SPRITE_DRAG_VARIANCE;
          
          this.setSpriteTarget(idx, pt.tx, pt.ty, pt.a ?? 1, pt.isUI ?? 0);
        }
      }
    }
  }

  explodeAt(px, py) {
    this.lastMorphTime = performance.now(); // Wake up from sleep

    const radius = this.width * SPRITE_CLICK_FORCE_RADIUS; 
    const forceMax = SPRITE_CLICK_FORCE; 
    
    for (let i = 0; i < this.maxSprites; i++) {
      let idx = i * STRIDE;
      if (this.data[idx + IS_UI] !== 1) continue;
      if (this.data[idx + A] === 0 || this.data[idx + DYING] === 1) continue;

      const dx = this.data[idx + X] - px;
      const dy = this.data[idx + Y] - py;
      const distSq = dx * dx + dy * dy;

      if (distSq < radius * radius) {
        const dist = Math.sqrt(distSq);
        const force = (1 - dist / radius) * forceMax;
        const angle = Math.atan2(dy, dx) + (Math.random() - 0.5) * 0.5;

        // Apply impulse velocity instead of physical displacement
        this.data[idx + EVX] += Math.cos(angle) * force;
        this.data[idx + EVY] += Math.sin(angle) * force;

        // Snap PROG to 1 to force it into the idle spring-back state
        this.data[idx + PROG] = 1; 
      }
    }
  }

  _compileShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error("Shader fail:", gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
    }
    return shader;
  }

  _renderLoop(timestamp) {
    const dt = timestamp - this.lastTime;
    this.lastTime = timestamp;

    const SIMULATION_SPEED = 0.75; 
    const timeScale = (Math.min(dt, 100) / 16.666) * SIMULATION_SPEED;

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
        
        // Pure 360-degree random outward burst
        const angle = Math.random() * Math.PI * 2;
        const burstForce = 2 + Math.random() * 5; // Slightly gentler for a dust-like dissipation
        
        data[idx + EVX] = Math.cos(angle) * burstForce;
        data[idx + EVY] = Math.sin(angle) * burstForce;
      }

      // 2. State Routing
      if (isDying) {
        // --- DYING STATE ---
        const dyingFriction = Math.exp(Math.log(0.8) * timeScale);
        data[idx + EVX] *= dyingFriction;
        data[idx + EVY] *= dyingFriction;
        
        data[idx + X] += data[idx + EVX] * timeScale;
        data[idx + Y] += data[idx + EVY] * timeScale;
        
        const decayBase = 1 - 0.01;
        const deathDecay = 1 - Math.exp(Math.log(decayBase) * timeScale); 
        data[idx + A] += (0 - data[idx + A]) * deathDecay;
        
        const globalDx = data[idx + X] - oldX;
        const globalDy = data[idx + Y] - oldY;
        const swerveStrength = data[idx + CURL_DIR] * 0.45 * data[idx + DRAG]; 
        
        data[idx + X] += -data[idx + CURL_CW] * globalDy * swerveStrength;
        data[idx + Y] += data[idx + CURL_CW] * globalDx * swerveStrength;
      }

       else {
        // --- ALIVE STATE ---
        const timeSinceMorph = timestamp - this.lastMorphTime;
        const canSleep = timeSinceMorph > MORPH_TIME_CULLING_MS;
        
        const pdx = data[idx + X] - this.pointerX;
        const pdy = data[idx + Y] - this.pointerY;
        const pDistSq = pdx * pdx + pdy * pdy;
        const hoverRadius = this.width * SPRITE_HOVER_RADIUS; 
        const hoverRadiusSq = hoverRadius * hoverRadius;

        // Optimization: Skip physics if settled, old enough, and cursor is far away
        if (canSleep && data[idx + PROG] >= 1 && pDistSq > hoverRadiusSq * 4 && data[idx + TA] === data[idx + A]) {
          data[idx + X] = data[idx + TX];
          data[idx + Y] = data[idx + TY];
          data[idx + EVX] = 0;
          data[idx + EVY] = 0;
        } else {
          // Physics Calculation Block
          let hoverOffsetX = 0;
          let hoverOffsetY = 0;

          if ( data[idx + IS_UI] === 1 && pDistSq < hoverRadiusSq) {
            const pDist = Math.sqrt(pDistSq);
            const fluctuation = 0.5 + Math.sin(timestamp * 0.005 + i) * 1.0;
            const force = (1 - pDist / hoverRadius) * 20 * fluctuation;
            const angle = Math.atan2(pdy, pdx);
            
            hoverOffsetX = Math.cos(angle) * force;
            hoverOffsetY = Math.sin(angle) * force;
          }

          if (data[idx + PROG] < 1) {
            data[idx + PROG] += data[idx + SPEED] * data[idx + DRAG] * timeScale;
            if (data[idx + PROG] > 1) data[idx + PROG] = 1;

            const t = data[idx + PROG];
            let ease = t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 4) / 2;

            const globalDx = data[idx + TX] - data[idx + SX];
            const globalDy = data[idx + TY] - data[idx + SY];

            const baseX = data[idx + SX] + globalDx * ease;
            const baseY = data[idx + SY] + globalDy * ease;

            const turbulenceForce = Math.sin(t * Math.PI); 
            const swerveStrength = data[idx + CURL_DIR] * 0.05 * turbulenceForce * data[idx + DRAG]; 
            
            data[idx + X] = baseX + (-globalDy * swerveStrength) + hoverOffsetX;
            data[idx + Y] = baseY + (globalDx * swerveStrength) + hoverOffsetY;
          } else {
            // Apply impulse velocity and friction
            const friction = Math.exp(Math.log(0.9) * data[idx + DRAG] * timeScale);
            data[idx + EVX] *= friction;
            data[idx + EVY] *= friction;
            
            data[idx + X] += data[idx + EVX] * timeScale;
            data[idx + Y] += data[idx + EVY] * timeScale;

            // Idle Spring-back
            const easeBack = 1 - Math.exp(Math.log(0.7) * timeScale);
            data[idx + X] += ((data[idx + TX] + hoverOffsetX) - data[idx + X]) * easeBack;
            data[idx + Y] += ((data[idx + TY] + hoverOffsetY) - data[idx + Y]) * easeBack;
          }

          // Kinetic Alpha / Speed calc
          const vx = (data[idx + X] - oldX) / timeScale;
          const vy = (data[idx + Y] - oldY) / timeScale;
          const speed = Math.sqrt(vx * vx + vy * vy); 
          const dist = Math.sqrt((data[idx + TX] - data[idx + X])**2 + (data[idx + TY] - data[idx + Y])**2);

          const kineticAlpha = Math.max(0.1, Math.min(1.5, (speed/4) * K_ALPHA_MULTIPLIER));
          let deadzoneMix = dist < 5 ? 1 : (dist < 15 ? 1 - ((dist - 5) / 10) : 0);

          const desiredAlpha = (1 - deadzoneMix) * kineticAlpha + deadzoneMix * data[idx + TA];
          data[idx + A] += (desiredAlpha - data[idx + A]) * (1 - Math.exp(Math.log(0.8) * timeScale));
        }
      }

      // 3. Floating-Point Hard Clamp & Drawing
      if (data[idx + A] < 0.005) {
        data[idx + A] = 0; // Snap it to absolute zero so the early exit catches it next frame
      }

    }

    // 1. Clear the canvas
    const gl = this.gl;
    gl.clearColor(0, 0, 0, 0); // Transparent background
    gl.clear(gl.COLOR_BUFFER_BIT);

    // 2. Upload the updated Float32Array to the GPU
    // bufferSubData is incredibly fast for this
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.data, gl.DYNAMIC_DRAW);

    // 3. Draw all 50,000 sprites in ONE command
    gl.drawArrays(gl.POINTS, 0, this.maxSprites);

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
        'shape': 'shapes/', 
        '3Dshape': '3dshapes/'   
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
    this.fontSize = config.fontSize; 
    this.densityFactor = config.densityFactor;
    this.anchor = config.anchor;
    this.justify = config.justify;
    this.align = config.align;
    this.wrap = config.wrap;
    this.pixelMultiplier = config.pixelMultiplier; 
    this.hsRatio = config.hsRatio; 
    this.vsRatio = config.vsRatio;
    this.isUI = config.isUI || 0;
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

  _parseRichText(rawText) {
    const chars = [];
    let isBold = false;
    let isItalic = false;
    let currentLinkType = null;
    let currentLinkTarget = null;
    
    // Matches [b], [/b], [a:0], [/a], [h:url], [/h]
    const tokenRegex = /\[(\/?)(b|i|h|a)(?::(.*?))?\]/g;
    
    let lastIndex = 0;
    let match;

    while ((match = tokenRegex.exec(rawText)) !== null) {
      // Push preceding normal text
      const precedingText = rawText.substring(lastIndex, match.index);
      for (let char of precedingText) {
        chars.push({ char, isBold, isItalic, linkType: currentLinkType, linkTarget: currentLinkTarget });
      }

      // Determine tag action
      const isClosing = match[1] === '/';
      const tag = match[2];
      const target = match[3];

      if (tag === 'b') isBold = !isClosing;
      if (tag === 'i') isItalic = !isClosing;
      
      if (tag === 'h') {
        if (isClosing) { currentLinkType = null; currentLinkTarget = null; }
        else { currentLinkType = 'hyperlink'; currentLinkTarget = target; }
      }
      
      if (tag === 'a') {
        if (isClosing) { currentLinkType = null; currentLinkTarget = null; }
        else { currentLinkType = 'intralink'; currentLinkTarget = target; }
      }

      lastIndex = tokenRegex.lastIndex;
    }

    // Push remaining text
    const remainingText = rawText.substring(lastIndex);
    for (let char of remainingText) {
      chars.push({ char, isBold, isItalic, linkType: currentLinkType, linkTarget: currentLinkTarget });
    }

    return chars;
  }

  async _generateLinkBox(zone, containerWidth, containerHeight, spriteSize, finalLayout) {
    if (zone.actionType !== 'intralink') return; // Only draw for [a] tags!

    // Add a tiny bit of padding so the box frames the text nicely
    const padding = spriteSize * 2.5; 
    const boxWidth = zone.width + padding * 2;
    const boxHeight = zone.height + padding * 2;
    const boxX = zone.x - padding;
    const boxY = zone.y - padding;

    // Convert pixel bounds to percentages for SpriteRectangle
    const rectWidthPct = (boxWidth / containerWidth) * 100;
    const rectHeightPct = (boxHeight / containerHeight) * 100;

    // Convert local pixel center to 0-100% anchor
    const centerPx = boxX + (boxWidth / 2);
    const centerPy = boxY + (boxHeight / 2);
    const anchorXPct = (centerPx / containerWidth + 0.5) * 100;
    const anchorYPct = (centerPy / containerHeight + 0.5) * 100;

    const rectGen = new SpriteRectangle({
        width: rectWidthPct,
        height: rectHeightPct,
        densityFactor: 0.6,
        anchor: { x: anchorXPct, y: anchorYPct },
        justify: 'center',
        align: 'center',
        layers: 1,
        layerSpacing: 0,
        layerDirection: 'outwards',
        cornerRadius: 1 // 1% as requested
    });

    const rectResult = await rectGen.getLayout(containerWidth, containerHeight, spriteSize);
    
    // Inject the generated rectangle sprites directly into the text layout
    for (const pt of rectResult.layout) {
        pt.isUI = 1; // Make the border reactive to the cursor
        finalLayout.push(pt);
    }
  }

  async getLayout(containerWidth, containerHeight, spriteSize) {
    const finalLayout = [];
    const interactiveZones = []; // To store bounding boxes
    
    // 1. Calculate our dynamic vmin scale
    const vmin = Math.min(containerWidth, containerHeight);
    const dynamicFontSize = vmin * (this.fontSize / 1000);

    // 2. Apply it to the core variables
    const letterScale = dynamicFontSize * this.pixelMultiplier;
    const dynamicHs = dynamicFontSize * this.hsRatio;
    const dynamicVs = dynamicFontSize * this.vsRatio;

    const letterArea = letterScale * letterScale;
    const spriteArea = spriteSize * spriteSize;
    const targetSpriteCount = Math.floor((letterArea / spriteArea) * this.densityFactor);
    const charWidth = letterScale + dynamicHs;

    // 1. Parse string into rich character array
    let parsedData = this._parseRichText(this.text);

    // 2. Wrap Algorithm (modified for rich data)
    let lines = [];
    if (this.wrap) {
        let currentLine = [];
        let currentLineWidth = 0;

        for (let i = 0; i < parsedData.length; i++) {
            const token = parsedData[i];
            
            if (token.char === '\n') {
                lines.push({ tokens: currentLine, width: currentLineWidth - dynamicHs });
                currentLine = [];
                currentLineWidth = 0;
                continue;
            }

            currentLine.push(token);
            currentLineWidth += charWidth;

            if (currentLineWidth > containerWidth) {
                lines.push({ tokens: currentLine, width: currentLineWidth - dynamicHs });
                currentLine = [];
                currentLineWidth = 0;
            }
        }
        if (currentLine.length > 0) lines.push({ tokens: currentLine, width: currentLineWidth - dynamicHs });
    } else {
        let currentLine = [];
        let currentLineWidth = 0;
        for (const token of parsedData) {
            if (token.char === '\n') {
                lines.push({ tokens: currentLine, width: Math.max(0, currentLineWidth - dynamicHs) });
                currentLine = [];
                currentLineWidth = 0;
            } else {
                currentLine.push(token);
                currentLineWidth += charWidth;
            }
        }
        lines.push({ tokens: currentLine, width: Math.max(0, currentLineWidth - dynamicHs) });
    }

    const totalHeight = (lines.length * letterScale) + ((lines.length - 1) * dynamicVs);

    // 3. Anchor Math Translation
    // Convert 0-100% to actual local coordinates (-width/2 to +width/2)
    const anchorPointX = (this.anchor.x / 100 - 0.5) * containerWidth;
    const anchorPointY = (this.anchor.y / 100 - 0.5) * containerHeight;

    let currentY = 0;
    if (this.align === 'top') {
       currentY = anchorPointY; 
    } else if (this.align === 'bottom') {
       currentY = anchorPointY - totalHeight; 
    } else { 
       currentY = anchorPointY - (totalHeight / 2); 
    }

    let activeZone = null;

    for (const line of lines) {
      let currentX = 0;
      if (this.justify === 'left') {
        currentX = anchorPointX; // Left edge of text starts at anchor
      } else if (this.justify === 'right') {
        currentX = anchorPointX - line.width; // Right edge of text ends at anchor
      } else { 
        currentX = anchorPointX - (line.width / 2); // Center is on anchor
      }

      for (let i = 0; i < line.tokens.length; i++) {
        const token = line.tokens[i];

        if (token.linkType) {
            if (!activeZone) {
                activeZone = { 
                    x: currentX, 
                    y: currentY, 
                    target: token.linkTarget, 
                    actionType: token.linkType 
                };
            }
            activeZone.width = (currentX - activeZone.x) + letterScale;
            activeZone.height = letterScale;
        } else if (activeZone) {
            interactiveZones.push({...activeZone});
            await this._generateLinkBox(activeZone, containerWidth, containerHeight, spriteSize, finalLayout);
            activeZone = null;
        }

        if (token.char !== ' ') {
          const safeFilename = this._sanitizeChar(token.char);
          const letterBlueprint = new ShapeParent(safeFilename, 'letter');
          const rawSpriteData = await letterBlueprint.getLayout();

          // Shallow copy to protect the RAM cache!
          let spriteData = [...rawSpriteData]; 
          
          // Density is now a direct percentage of the blueprint's actual point count
          const targetSpriteCount = Math.max(1, Math.floor(spriteData.length * this.densityFactor));

          if (spriteData.length > targetSpriteCount) {
            // Seed based on character code and its position in the line
            const seed = token.char.charCodeAt(0) + (i * 100);
            shuffleArray(spriteData, seed); 
            spriteData = spriteData.slice(0, targetSpriteCount);
          }

          // Flag for the physics engine
          const isLinkUI = (token.linkType || this.isUI === 1) ? 1 : 0;

          for (const pt of spriteData) {
            let px = pt.x;
            let py = pt.y;

            if (token.isItalic) px += (1 - py) * 0.3; 

            let finalX = currentX + (px * letterScale);
            let finalY = currentY + (py * letterScale);

            // Pass the isUI flag down to the final layout
            finalLayout.push({ x: finalX, y: finalY, a: pt.a, isUI: isLinkUI });

            if (token.isBold) {
               finalLayout.push({ x: finalX + (letterScale * 0.08), y: finalY, a: pt.a, isUI: isLinkUI });
            }
          }
        }
        currentX += charWidth;
      }
      
      // Close any active zone at the end of a line
      if (activeZone) {
          interactiveZones.push({...activeZone});

          await this._generateLinkBox(activeZone, containerWidth, containerHeight, spriteSize, finalLayout);

          activeZone = null;
      }
      currentY += letterScale + dynamicVs;
    }

    return { layout: finalLayout, zones: interactiveZones };
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
    this.isUI = config.isUI;
    this.aspectRatio = config.aspectRatio || 1.0;
  }

  async getLayout(containerWidth, containerHeight, spriteSize) {
    const finalLayout = [];

    // Fetch the raw normalized data from the image map
    const imageBlueprint = new ShapeParent(this.filename, 'image');
    const rawSpriteData = await imageBlueprint.getLayout();

    if (!rawSpriteData || rawSpriteData.length === 0) return [];

    // SHALLOW COPY to protect the deterministic cache
    let spriteData = [...rawSpriteData];

    this.scale *= containerHeight / 1080;

    // Optional Density Filtering
    const imageArea = this.scale * this.scale;
    const spriteArea = spriteSize * spriteSize;
    const targetSpriteCount = Math.floor((imageArea / spriteArea) * this.densityFactor);

    if (spriteData.length > targetSpriteCount) {
      let seed = 0;
      for (let i = 0; i < this.filename.length; i++) {
        seed = (seed << 5) - seed + this.filename.charCodeAt(i);
      }
      
      shuffleArray(spriteData, Math.abs(seed)); 
      spriteData = spriteData.slice(0, targetSpriteCount);
    }

    // Process coordinates
    for (const pt of spriteData) {
      finalLayout.push({
        x: (pt.x - 0.5) * this.scale,
        y: (pt.y - 0.5) * this.scale,
        a: pt.a,
        isUI: this.isUI
      });
    }
    
    return { layout: finalLayout, zones: [] };
  }
}

export class SpriteRectangle extends LayoutController {
  constructor(config) {
    super();
    this.width = config.width;
    this.height = config.height;
    this.densityFactor = config.densityFactor;
    this.anchor = config.anchor;
    this.justify = config.justify;
    this.align = config.align;
    this.layers = config.layers || 1;
    this.layerSpacing = config.layerSpacing || 5;
    this.layerDirection = config.layerDirection || 'outwards';
    this.cornerRadius = config.cornerRadius || 0;
  }

  async getLayout(containerWidth, containerHeight, spriteSize) {
    const finalLayout = [];
    
    const basePixelWidth = containerWidth * (this.width / 100);
    const basePixelHeight = containerHeight * (this.height / 100);

    const anchorPointX = (this.anchor.x / 100 - 0.5) * containerWidth;
    const anchorPointY = (this.anchor.y / 100 - 0.5) * containerHeight;

    let baseStartY = 0;
    if (this.align === 'top') baseStartY = anchorPointY; 
    else if (this.align === 'bottom') baseStartY = anchorPointY - basePixelHeight; 
    else baseStartY = anchorPointY - (basePixelHeight / 2); 

    let baseStartX = 0;
    if (this.justify === 'left') baseStartX = anchorPointX; 
    else if (this.justify === 'right') baseStartX = anchorPointX - basePixelWidth; 
    else baseStartX = anchorPointX - (basePixelWidth / 2); 

    const step = spriteSize / this.densityFactor;
    const sign = this.layerDirection === 'inwards' ? -1 : 1;

    // Calculate base radius. Using the smallest container dimension so it remains circular.
    const maxAllowedRadius = Math.min(basePixelWidth, basePixelHeight) / 2;
    let baseRadius = Math.min(containerWidth, containerHeight) * (this.cornerRadius / 100);
    baseRadius = Math.min(baseRadius, maxAllowedRadius); // Prevent overlap

    for (let l = 0; l < this.layers; l++) {
      let delta = l * this.layerSpacing * sign;
      
      let currentWidth = basePixelWidth + (2 * delta);
      let currentHeight = basePixelHeight + (2 * delta);
      let startX = baseStartX - delta;
      let startY = baseStartY - delta;

      if (currentWidth <= 0 || currentHeight <= 0) continue;

      // Inner layers get a smaller radius, outer layers get a larger one
      let r = Math.max(0, baseRadius + delta);
      r = Math.min(r, Math.min(currentWidth, currentHeight) / 2);

      const straightW = Math.max(0, currentWidth - (2 * r));
      const straightH = Math.max(0, currentHeight - (2 * r));

      const countTop = Math.floor(straightW / step);
      const countRight = Math.floor(straightH / step);
      const countBottom = Math.floor(straightW / step);
      const countLeft = Math.floor(straightH / step);

      // --- STRAIGHT EDGES ---
      for(let i = 0; i <= countTop; i++) finalLayout.push({ x: startX + r + (i * step), y: startY, a: 1, isUI: 1 });
      for(let i = 0; i <= countRight; i++) finalLayout.push({ x: startX + currentWidth, y: startY + r + (i * step), a: 1, isUI: 1 });
      for(let i = 0; i <= countBottom; i++) finalLayout.push({ x: startX + currentWidth - r - (i * step), y: startY + currentHeight, a: 1, isUI: 1 });
      for(let i = 0; i <= countLeft; i++) finalLayout.push({ x: startX, y: startY + currentHeight - r - (i * step), a: 1, isUI: 1 });

      // --- CORNER ARCS ---
      if (r > 0) {
        const cornerCircum = (Math.PI * 2 * r) / 4;
        const cornerCount = Math.floor(cornerCircum / step);
        
        for(let i = 1; i < cornerCount; i++) {
          // Top Left
          const t1 = Math.PI + (Math.PI / 2) * (i / cornerCount);
          finalLayout.push({ x: startX + r + r * Math.cos(t1), y: startY + r + r * Math.sin(t1), a: 1, isUI: 1 });
          // Top Right
          const t2 = 1.5 * Math.PI + (Math.PI / 2) * (i / cornerCount);
          finalLayout.push({ x: startX + currentWidth - r + r * Math.cos(t2), y: startY + r + r * Math.sin(t2), a: 1, isUI: 1 });
          // Bottom Right
          const t3 = 0 + (Math.PI / 2) * (i / cornerCount);
          finalLayout.push({ x: startX + currentWidth - r + r * Math.cos(t3), y: startY + currentHeight - r + r * Math.sin(t3), a: 1, isUI: 1 });
          // Bottom Left
          const t4 = 0.5 * Math.PI + (Math.PI / 2) * (i / cornerCount);
          finalLayout.push({ x: startX + r + r * Math.cos(t4), y: startY + currentHeight - r + r * Math.sin(t4), a: 1, isUI: 1 });
        }
      }
    }

    return { layout: finalLayout, zones: [] };
  }
}

export class SpriteSlider extends SpriteRectangle {
  constructor(config) {
    super(config);
    this.ballPosition = config.ballPosition ?? 50;
    this.ballDiameter = config.ballDiameter ?? 3;
    this.id = config.id ?? 'default_slider';
  }
  
  async getLayout(containerWidth, containerHeight, spriteSize) {
    // 1. Get the foundational track layout from the parent
    const result = await super.getLayout(containerWidth, containerHeight, spriteSize);
    
    // 2. Re-calculate the base track origin points to find the ball's center
    const basePixelWidth = containerWidth * (this.width / 100);
    const basePixelHeight = containerHeight * (this.height / 100);
    const anchorPointX = (this.anchor.x / 100 - 0.5) * containerWidth;
    const anchorPointY = (this.anchor.y / 100 - 0.5) * containerHeight;

    let baseStartY = 0;
    if (this.align === 'top') baseStartY = anchorPointY; 
    else if (this.align === 'bottom') baseStartY = anchorPointY - basePixelHeight; 
    else baseStartY = anchorPointY - (basePixelHeight / 2); 

    let baseStartX = 0;
    if (this.justify === 'left') baseStartX = anchorPointX; 
    else if (this.justify === 'right') baseStartX = anchorPointX - basePixelWidth; 
    else baseStartX = anchorPointX - (basePixelWidth / 2); 

    // 3. Ball calculations
    const ballRadius = Math.min(containerWidth, containerHeight) * (this.ballDiameter / 100) / 2;
    const ballX = baseStartX + (basePixelWidth * (this.ballPosition / 100));
    const ballY = baseStartY + (basePixelHeight / 2);

    const rSq = ballRadius * ballRadius;

    // 4. Spatial Warp: Push any sprites inside the ball outward to its perimeter
    for (let i = 0; i < result.layout.length; i++) {
      const pt = result.layout[i];
      const dx = pt.x - ballX;
      const dy = pt.y - ballY;
      const distSq = dx * dx + dy * dy;

      if (distSq < rSq) {
        const dist = Math.sqrt(distSq);
        
        if (dist === 0) {
          // Edge case: if a point is dead-center, default to pushing it straight up
          pt.y = ballY - ballRadius;
        } else {
          // Normalize the vector and multiply by the desired radius
          pt.x = ballX + (dx / dist) * ballRadius;
          pt.y = ballY + (dy / dist) * ballRadius;
        }
        
        // Flag warped points as UI so the ball area is highly reactive to the cursor
        pt.isUI = 1; 
      }
    }

    // Make the clickable height at least as tall as the ball so it's easy to grab
    const clickableHeight = Math.max(basePixelHeight, containerHeight * (this.ballDiameter / 100));
    
    // Center the clickable zone over the track
    const zoneX = baseStartX;
    const zoneY = baseStartY + (basePixelHeight / 2) - (clickableHeight / 2);

    result.zones.push({
      x: zoneX,
      y: zoneY,
      width: basePixelWidth,
      height: clickableHeight,
      actionType: 'slider',
      id: this.id,
      value: this.ballPosition
    });

    return result;
  }
}

export class SpriteGroup extends LayoutController {
  constructor(config) {
    super();
    this.children = config.children;
  }

  async getLayout(containerWidth, containerHeight, spriteSize) {
    const finalLayout = [];
    const finalZones = [];
    
    for (const child of this.children) {
      if (child.active === false) continue;

      let generator;
      if (child.type === 'SpriteWrite') generator = new SpriteWrite(child.config);
      else if (child.type === 'SpriteImage') generator = new SpriteImage(child.config);
      else if (child.type === 'SpriteRectangle') generator = new SpriteRectangle(child.config);
else if (child.type === 'SpriteSlider') generator = new SpriteSlider(child.config); 

      if (generator) {
        const result = await generator.getLayout(containerWidth, containerHeight, spriteSize);
        // Handle the new object format
        const layout = result.layout || result; 
        const zones = result.zones || [];

        for (const pt of layout) {
          finalLayout.push({
            x: pt.x + child.offsetX,
            y: pt.y + child.offsetY,
            a: pt.a,
            isUI: pt.isUI || 0,
            isAbsolute: true // Bypasses the pool's local center offset
          });
        }

        // Apply offsets to the interactive zones as well!
        for (const zone of zones) {
          finalZones.push({
            ...zone,
            x: zone.x + child.offsetX,
            y: zone.y + child.offsetY,
            isAbsolute: true 
          });
        }
      }
    }
    return { layout: finalLayout, zones: finalZones };
  }
}

self.onmessage = async (e) => {
  const data = e.data;

  switch (data.type) {
    case 'INIT':
      pool = new SpritePool(data.canvas, data.options);
      // Preload default
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
    case 'POINTER_DOWN':
      if (pool) pool.explodeAt(data.x, data.y);
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
        else if (data.layoutType === 'SpriteRectangle') generator = new SpriteRectangle(data.config);
        else if (data.layoutType === 'SpriteGroup') generator = new SpriteGroup(data.config);
        
        if (generator) await pool.mutateTo(generator);
      }
      break;
    case 'UPDATE_PHYSICS_CONFIG':
      {
      const cfg = data.config;
      if (cfg.DEFAULT_SPRITE_SPEED !== undefined) DEFAULT_SPRITE_SPEED = cfg.DEFAULT_SPRITE_SPEED;
      if (cfg.DEFAULT_SPRITE_SPEED_VARIANCE !== undefined) DEFAULT_SPRITE_SPEED_VARIANCE = cfg.DEFAULT_SPRITE_SPEED_VARIANCE;
      if (cfg.SPRITE_DRAG_BASE !== undefined) SPRITE_DRAG_BASE = cfg.SPRITE_DRAG_BASE;
      if (cfg.SPRITE_DRAG_VARIANCE !== undefined) SPRITE_DRAG_VARIANCE = cfg.SPRITE_DRAG_VARIANCE;
      if (cfg.SPRITE_SPAWN_RADIUS_BASE !== undefined) SPRITE_SPAWN_RADIUS_BASE = cfg.SPRITE_SPAWN_RADIUS_BASE;
      if (cfg.SPRITE_SPAWN_RADIUS_VARIANCE !== undefined) SPRITE_SPAWN_RADIUS_VARIANCE = cfg.SPRITE_SPAWN_RADIUS_VARIANCE;
      if (cfg.SPRITE_CLICK_FORCE !== undefined) SPRITE_CLICK_FORCE = cfg.SPRITE_CLICK_FORCE;
      if (cfg.SPRITE_CLICK_FORCE_RADIUS !== undefined) SPRITE_CLICK_FORCE_RADIUS = cfg.SPRITE_CLICK_FORCE_RADIUS;
      if (cfg.SPRITE_HOVER_RADIUS !== undefined) SPRITE_HOVER_RADIUS = cfg.SPRITE_HOVER_RADIUS;
      if (cfg.MORPH_TIME_CULLING_MS !== undefined) MORPH_TIME_CULLING_MS = cfg.MORPH_TIME_CULLING_MS;
      if (cfg.K_ALPHA_MULTIPLIER !== undefined) K_ALPHA_MULTIPLIER = cfg.K_ALPHA_MULTIPLIER;
      if (cfg.YIELD_BATCH_SIZE_PER_FRAME !== undefined) YIELD_BATCH_SIZE_PER_FRAME = cfg.YIELD_BATCH_SIZE_PER_FRAME;
      if (cfg.SPRITE_SHEDDING_THRESHOLD !== undefined) SPRITE_SHEDDING_THRESHOLD = cfg.SPRITE_SHEDDING_THRESHOLD;
      }
      break;
  }
};

let pool = null;