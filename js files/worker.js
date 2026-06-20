console.log("[Worker] Is working. Yup.");

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
      'question', 'slash', 'period', 'exclamation', 'at', 'hash', 'dollar', 'percent', 'caret', 'ampersand', 'asterisk', 'left_paren', 'right_paren', 'comma', 'apostrophe', 'semicolon', 'colon', 'less_than', 'greater_than', 'plus', 'equals', 'dash', 'left_brace', 'right_brace', 'left_bracket', 'right_bracket', 'pipe', 'tilde', 'backtick'
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
    console.log("[Worker > ShapeCache] All letter sprites cached and ready.");
  }
}

const shaderRamCache = new Map();

const shader_vertex_phys_source_path = './physics.vert.glsl';
const shader_vertex_render_source_path = './render.vert.glsl';
const shader_fragment_render_source_path = './render.frag.glsl';

class ShaderCache {
  static async preload() {
    // 1. Bump the version to invalidate the old cache
    const cacheStorage = await caches.open('hsrp-shaders-v3'); 
    const paths = [ shader_vertex_phys_source_path,
                    shader_vertex_render_source_path, 
                    shader_fragment_render_source_path];

    const fetchPromises = paths.map(async (url) => {
      if (shaderRamCache.has(url)) return;

      let response = await cacheStorage.match(url);

      if (!response) {
        try {
          // 2. Add a timestamp query parameter to bust the browser's HTTP cache
          const fetchUrl = `${url}?t=${Date.now()}`;
          response = await fetch(fetchUrl);
          
          if (response.ok) {
            // Store it using the ORIGINAL url as the key, not the timestamped one
            await cacheStorage.put(url, response.clone());
          } else {
            console.error(`Failed to fetch shader: ${url}`);
            return;
          }
        } catch (e) {
          console.warn(`Network fail for shader ${url}`);
          return;
        }
      }

      const source = await response.text();
      shaderRamCache.set(url, source);
    });

    await Promise.all(fetchPromises);
    console.log("[Worker > ShaderCache] Shaders preloaded and cached.");
  }
}

// ─── Global Sprite Pool ──────────────────────────────────────

/*
The main thread should only be aware of (per sprite):
  tx, ty, tz (target positions)
  R, G, B, A (target colour and alpha)

Sprites that have alpha of <0.01 should not be calculated.

All other params are stored within the shader and GPU. CPU should not have to compute anything.
The ideal architecture is that CPU assigns target positions for sprites and GPU
does the physics computation to bring those sprites to the position. 

Will likely need to use GPGPU or PP-VAO techniques

GPU params:

Global Params - should be updatable by CPU:
  > buffer for target positions assigned by CPU - up to 200,000 points
  > flow redirectors - in additional to sprite maps given by the CPU, there may be 3D models
    assigned by the CPU to be rendered alongside sprite maps. GPU needs to compute.


Per Sprite Params:
  Positioning (current): X, Y, Z (fp32)
  Positioning (target): tx, ty, tz (fp32)
  Movement: dx, dy, dz (fp16)
  Colour: R, G, B, A (uint8)
  SpParams: isDying (bool)
            drag (fp16)
            speed (fp16)
            curl_dir (fp16x3 (could be vec3))
            isInteractable (bool)
            calculationSkip (bool)
*/

export class SpritePool {
  constructor(canvas, options = {}) {
    this.canvas = canvas; 
    this.spriteSize = options.spriteSize ?? 3;
    this.maxSprites = options.maxSprites ?? 200000;
    this.mutateId = 0;
    this.activeSprites = 0; 
    this.currentLayout = [];

    // CPU ECS Tracking Arrays
    this.activeHashes = new Float64Array(this.maxSprites);
    this.activeIndices = new Int32Array(this.maxSprites);
    this.deadIndices = new Int32Array(this.maxSprites);
    this.freeIndices = new Int32Array(this.maxSprites);
    this.remainingTargets = [];
    
    const GRID_SIZE = 150 * 150;
    this.gridHead = new Int32Array(GRID_SIZE);
    this.gridNext = new Int32Array(this.maxSprites);
    this.targetClaimed = new Uint8Array(this.maxSprites);

    // A tiny buffer used purely for injecting spawn coordinates into the GPU
    this.singleSpawnBuffer = new Float32Array(this.gpuStride);

    this.gl = this.canvas.getContext('webgl2', { 
        premultipliedAlpha: false,
        powerPreference: "high-performance" // Demands the dedicated GPU
    });
    if (!this.gl) throw new Error("WebGL2 not supported on this device.");
    const gl = this.gl;

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // 1. Get Shaders from Cache
    const vsPhysicsSource = shaderRamCache.get(shader_vertex_phys_source_path);
    const vsRenderSource = shaderRamCache.get(shader_vertex_render_source_path);
    const fsRenderSource = shaderRamCache.get(shader_fragment_render_source_path);

    if (!vsPhysicsSource || !vsRenderSource || !fsRenderSource) {
        throw new Error("WebGL failed: Shaders missing from RAM cache.");
    }

    // 2. Compile Shaders
    const vertexPhysicsShader = this._compileShader(gl, gl.VERTEX_SHADER, vsPhysicsSource);
    const vertexRenderShader = this._compileShader(gl, gl.VERTEX_SHADER, vsRenderSource); 
    const fragmentRenderShader = this._compileShader(gl, gl.FRAGMENT_SHADER, fsRenderSource);
    
    // Dummy fragment shader to appease strict WebGL linkers for the physics compute pass
    const dummyFsSource = `#version 300 es\nvoid main() {}`;
    const dummyFsShader = this._compileShader(gl, gl.FRAGMENT_SHADER, dummyFsSource);

    // ==========================================
    // 3. BUILD PHYSICS PROGRAM
    // ==========================================
    this.physicsProgram = gl.createProgram();
    gl.attachShader(this.physicsProgram, vertexPhysicsShader);
    gl.attachShader(this.physicsProgram, dummyFsShader); // Appease the WebGL gods
    
    this._bindAttributeLocations(this.physicsProgram);

    // ==========================================
    // DATA STRUCTURES
    // ==========================================
    // CPU Data: Target (4) + Color (4) = 8 floats per sprite
    this.cpuStride = 8;
    this.cpuData = new Float32Array(this.maxSprites * this.cpuStride);
    
    // GPU Data: Position (4) + Velocity (4) = 8 floats per sprite
    this.gpuStride = 8;
    this.gpuInitialData = new Float32Array(this.maxSprites * this.gpuStride);

    // Initialize GPU data to 0 so they don't spawn at Infinity
    for (let i = 0; i < this.maxSprites; i++) {
        const idx = i * this.gpuStride;
        this.gpuInitialData[idx + 3] = 0.0; // isDying
        this.gpuInitialData[idx + 7] = 0.00001; // default speed
    }

    // ==========================================
    // BUFFERS & VAOs
    // ==========================================
    const BYTES = 4;
    
    // 1. The CPU Buffer (Static)
    this.cpuBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cpuBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.cpuData.byteLength, gl.DYNAMIC_DRAW);

    // 2. The GPU Ping-Pong Buffers
    this.gpuBuffers = [gl.createBuffer(), gl.createBuffer()];
    for (let i = 0; i < 2; i++) {
        gl.bindBuffer(gl.ARRAY_BUFFER, this.gpuBuffers[i]);
        gl.bufferData(gl.ARRAY_BUFFER, this.gpuInitialData, gl.DYNAMIC_COPY); // Seed initial positions
    }

    this.vaos = [gl.createVertexArray(), gl.createVertexArray()];

    for (let i = 0; i < 2; i++) {
        gl.bindVertexArray(this.vaos[i]);

        // A. Bind GPU Buffer to Attribs 0 & 1
        gl.bindBuffer(gl.ARRAY_BUFFER, this.gpuBuffers[i]);
        this.gl.enableVertexAttribArray(0); // a_pos_dying
        this.gl.vertexAttribPointer(0, 4, this.gl.FLOAT, false, this.gpuStride * BYTES, 0);
        this.gl.enableVertexAttribArray(1); // a_vel_speed
        this.gl.vertexAttribPointer(1, 4, this.gl.FLOAT, false, this.gpuStride * BYTES, 4 * BYTES);

        // B. Bind CPU Buffer to Attribs 2 & 3
        gl.bindBuffer(gl.ARRAY_BUFFER, this.cpuBuffer);
        this.gl.enableVertexAttribArray(2); // a_target_ui
        this.gl.vertexAttribPointer(2, 4, this.gl.FLOAT, false, this.cpuStride * BYTES, 0);
        this.gl.enableVertexAttribArray(3); // a_color
        this.gl.vertexAttribPointer(3, 4, this.gl.FLOAT, false, this.cpuStride * BYTES, 4 * BYTES);
    }
    gl.bindVertexArray(null);

    // ==========================================
    // TRANSFORM FEEDBACK
    // ==========================================
    // CRITICAL: We only capture the 2 GPU variables now!
    const feedbackVaryings = ['out_pos_dying', 'out_vel_speed'];
    gl.transformFeedbackVaryings(this.physicsProgram, feedbackVaryings, gl.INTERLEAVED_ATTRIBS);
    gl.linkProgram(this.physicsProgram); // Relink AFTER setting varyings!

    this.transformFeedbacks = [gl.createTransformFeedback(), gl.createTransformFeedback()];
    for (let i = 0; i < 2; i++) {
        gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, this.transformFeedbacks[i]);
        // TF only writes to the GPU buffer
        gl.bindBufferBase(gl.TRANSFORM_FEEDBACK_BUFFER, 0, this.gpuBuffers[(i + 1) % 2]); 
    }
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);

    // ==========================================
    // 4. BUILD RENDER PROGRAM 
    // ==========================================
    this.renderProgram = gl.createProgram();
    gl.attachShader(this.renderProgram, vertexRenderShader);
    gl.attachShader(this.renderProgram, fragmentRenderShader);
    
    this._bindAttributeLocations(this.renderProgram);
    gl.linkProgram(this.renderProgram);

    this.readIndex = 0; 
    
    // Grab Uniform Locations for Rendering
    this.resLoc = gl.getUniformLocation(this.renderProgram, "u_resolution");
    this.sizeLoc = gl.getUniformLocation(this.renderProgram, "u_spriteSize");

    this._renderLoop = this._renderLoop.bind(this);
    requestAnimationFrame(this._renderLoop);
  }

  // Forces both programs to use the exact same attribute locations so our VAOs work universally
  _bindAttributeLocations(program) {
    const gl = this.gl;
    gl.bindAttribLocation(program, 0, "a_pos_dying");
    gl.bindAttribLocation(program, 1, "a_vel_speed");
    gl.bindAttribLocation(program, 2, "a_target_ui");
    gl.bindAttribLocation(program, 3, "a_color");
  }

  _enableAttrib(loc, size, stride, offset) {
    this.gl.enableVertexAttribArray(loc);
    this.gl.vertexAttribPointer(loc, size, this.gl.FLOAT, false, stride, offset);
  }

  updateBounds(bounds) {
    this.width = bounds.windowWidth;
    this.height = bounds.windowHeight;
    this.canvas.width = this.width;
    this.canvas.height = this.height;
    this.originX = bounds.originX;
    this.originY = bounds.originY;

    this.gl.viewport(0, 0, this.width, this.height);
    
    // Update resolution uniforms in the render program
    this.gl.useProgram(this.renderProgram);
    this.gl.uniform2f(this.resLoc, this.width, this.height);
    this.gl.uniform1f(this.sizeLoc, this.spriteSize * 1.15);

    if (this.layoutCenterX === undefined) {
      this.layoutCenterX = this.originX;
      this.layoutCenterY = this.originY;
    }
    
    this.containerWidth = bounds.width;
    this.containerHeight = bounds.height;
  }

  moveTo(newX, newY) {
    if (this.layoutCenterX === undefined) return;
    this.layoutCenterX = newX;
    this.layoutCenterY = newY;
    this._updateBufferData(); 
  }

  resetMove() {
    if (this.originX !== undefined && this.originY !== undefined) {
        this.moveTo(this.originX, this.originY);
    }
  }

  async mutateTo(layoutGenerator) {
    const result = await layoutGenerator.getLayout(this.containerWidth, this.containerHeight, this.spriteSize);
    const newLayout = result.layout || result;
    self.postMessage({ type: 'INTERACTIVE_ZONES', zones: result.zones || [] });

    this.lastMorphTime = performance.now();
    const currentMutateId = ++this.mutateId;
    if (currentMutateId !== this.mutateId) return;

    const offsetX = this.layoutCenterX || 0;
    const offsetY = this.layoutCenterY || 0;

    let activeCount = 0;
    let deadCount = 0;
    let freeCount = 0;

    // 1. Calculate Hashes from `cpuData` (Using Previous Targets as a proxy for position)
    for (let i = 0; i < this.maxSprites; i++) {
      let idx = i * this.cpuStride;
      let alpha = this.cpuData[idx + 7]; // Alpha is at offset 7
      
      if (alpha > 0.01) {
        this.activeIndices[activeCount] = i; // Store logical index, not byte offset
        
        // Use the previous target (offset 0 and 1) for the spatial hash
        const tx32 = Math.fround(this.cpuData[idx + 0]);
        const ty32 = Math.fround(this.cpuData[idx + 1]);
        const rx = Math.round(tx32) + 10000;
        const ry = Math.round(ty32) + 10000;
        
        this.activeHashes[i] = (ry * 100000) + rx;
        activeCount++;
      } else {
        this.deadIndices[deadCount++] = i;
      }
    }

    // 2. Sort Active Sprites & Targets
    const activeView = this.activeIndices.subarray(0, activeCount);
    activeView.sort((idxA, idxB) => this.activeHashes[idxA] - this.activeHashes[idxB]);

    const targetCount = newLayout.length;
    for (let i = 0; i < targetCount; i++) {
       const pt = newLayout[i];
       pt.tx = pt.isAbsolute ? pt.x : pt.x + offsetX;
       pt.ty = pt.isAbsolute ? pt.y : pt.y + offsetY;
       const rx = Math.round(Math.fround(pt.tx)) + 10000;
       const ry = Math.round(Math.fround(pt.ty)) + 10000;
       pt.hash = (ry * 100000) + rx;
    }
    newLayout.sort((a, b) => a.hash - b.hash);

    // ==========================================
    // 3. Two-Pointer EXACT Intersection (The "Locking" Phase)
    // ==========================================
    let pA = 0;
    let pT = 0;
    this.remainingTargets.length = 0; 

    while (pA < activeCount && pT < targetCount) {
      let idx = activeView[pA]; // Logical sprite index
      let hashA = this.activeHashes[idx];
      let target = newLayout[pT];

      if (hashA === target.hash) {
        // Perfect match! Just update static properties in the CPU buffer.
        let cpuIdx = idx * this.cpuStride;
        this.cpuData[cpuIdx + 3] = target.isUI ? 1.0 : 0.0;
        this.cpuData[cpuIdx + 7] = target.a ?? 1.0; // Ensure it stays awake
        
        pA++; pT++;
      } else if (hashA < target.hash) {
        this.freeIndices[freeCount++] = idx; 
        pA++;
      } else {
        this.remainingTargets.push(target);
        pT++;
      }
    }

    while (pA < activeCount) this.freeIndices[freeCount++] = activeView[pA++];
    while (pT < targetCount) this.remainingTargets.push(newLayout[pT++]);


    // ==========================================
    // 4. ECS SPATIAL HASHING (The "Rearrange" Phase)
    // ==========================================
    const remainingCount = this.remainingTargets.length;
    const CHUNK_SIZE = 64; 
    const GRID_COLS = 150; 
    const GRID_ROWS = 150;
    const OFFSET = 3000; // Shift bounds to avoid negative grid indices

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


    // ==========================================
    // 5. Localized Nearest-Neighbor Assignment
    // ==========================================
    // (Ensure YIELD_BATCH_SIZE_PER_FRAME is passed to worker or defined here)
    const BATCH_SIZE = 333; 
    const MAX_MORPH_DIST = 150;
    const MAX_MORPH_DIST_SQ = MAX_MORPH_DIST * MAX_MORPH_DIST;
    
    for (let i = 0; i < freeCount; i++) {

      if (i > 0 && i % BATCH_SIZE === 0) {
        this.lastMorphTime = performance.now(); 
        await yieldFrame(); 
      }

      let idx = this.freeIndices[i];
      let cpuIdx = idx * this.cpuStride;
      
      // KEY DIFFERENCE: Use the *previous target* as the spatial anchor
      // because the CPU no longer knows the mid-flight GPU coordinates!
      let sx = this.cpuData[cpuIdx + 0]; 
      let sy = this.cpuData[cpuIdx + 1]; 
      
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
        
        this.cpuData[cpuIdx + 0] = pt.tx;
        this.cpuData[cpuIdx + 1] = pt.ty;
        this.cpuData[cpuIdx + 3] = pt.isUI ? 1.0 : 0.0;
        this.cpuData[cpuIdx + 7] = pt.a ?? 1.0; 
      } else {
        // Decimate & Dissolve: No targets left within 150px. 
        // Assign a random drift target and set alpha to 0 so the GPU puts it to sleep.
        const driftAngle = Math.random() * Math.PI * 2;
        const driftRadius = 80 + Math.random() * 80;
        
        this.cpuData[cpuIdx + 0] = sx + Math.cos(driftAngle) * driftRadius;
        this.cpuData[cpuIdx + 1] = sy + Math.sin(driftAngle) * driftRadius;
        this.cpuData[cpuIdx + 7] = 0.0; // Alpha 0 = Sleep
      }
    }

    // HELPER FUNCTION for assigning targets inside the algorithm:
    const setTarget = (spriteIndex, pt) => {
        const cpuIdx = spriteIndex * this.cpuStride;
        this.cpuData[cpuIdx + 0] = pt.tx;
        this.cpuData[cpuIdx + 1] = pt.ty;
        this.cpuData[cpuIdx + 3] = pt.isUI ? 1.0 : 0.0;
        
        this.cpuData[cpuIdx + 4] = 1.0; // R
        this.cpuData[cpuIdx + 5] = 1.0; // G
        this.cpuData[cpuIdx + 6] = 1.0; // B
        this.cpuData[cpuIdx + 7] = pt.a ?? 1.0; // Alpha > 0 keeps it awake
    };

    // ==========================================
    // 6. Localized Spawn Phase
    // ==========================================
    const gl = this.gl;
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null); 

    let deadReadIndex = 0; // NEW: Start reading from the lowest available dead index

    for (let i = 0; i < remainingCount; i++) {
      if (this.targetClaimed[i] === 0 && deadReadIndex < deadCount) {
          
          let spriteIdx = this.deadIndices[deadReadIndex++]; 
          const pt = this.remainingTargets[i];
          
          // Set the CPU target
          setTarget(spriteIdx, pt);

          // Force the CPU buffer to think it's ALREADY at the target, 
          // so the next morph doesn't drag it from 0,0
          let cpuIdx = spriteIdx * this.cpuStride;
          this.cpuData[cpuIdx + 0] = pt.tx;
          this.cpuData[cpuIdx + 1] = pt.ty;

          // Inject the burst spawn coordinates directly to the GPU
          const angle = Math.random() * Math.PI * 2;
          const radius = 20 + Math.random() * 30; 
          
          this.singleSpawnBuffer[0] = pt.tx + Math.cos(angle) * radius; 
          this.singleSpawnBuffer[1] = pt.ty + Math.sin(angle) * radius; 
          this.singleSpawnBuffer[2] = 0.0; 
          this.singleSpawnBuffer[3] = 1.0; // We'll use 'w' for current Alpha now!
          
          this.singleSpawnBuffer[4] = 0.0; 
          this.singleSpawnBuffer[5] = 0.0; 
          this.singleSpawnBuffer[6] = 0.0; 
          this.singleSpawnBuffer[7] = 0.15; 

          const byteOffset = spriteIdx * this.gpuStride * 4; 
          
          for (let b = 0; b < 2; b++) {
              gl.bindBuffer(gl.ARRAY_BUFFER, this.gpuBuffers[b]);
              gl.bufferSubData(gl.ARRAY_BUFFER, byteOffset, this.singleSpawnBuffer);
          }
      }
    }

    // ==========================================
    // 8. Upload the CPU Targets & Calculate True Draw Boundary
    // ==========================================
    
    // Scan backwards to find the absolute highest index currently alive
    let highestActiveIndex = 0;
    for (let i = this.maxSprites - 1; i >= 0; i--) {
        if (this.cpuData[i * this.cpuStride + 7] > 0.01) {
            highestActiveIndex = i;
            break;
        }
    }
    
    // Tell WebGL to draw from 0 up to our highest active memory slot
    this.activeSprites = highestActiveIndex + 1;
    
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cpuBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, this.cpuData.subarray(0, this.maxSprites * this.cpuStride));
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }



  _updateBufferData() {
    const offsetX = this.layoutCenterX || 0;
    const offsetY = this.layoutCenterY || 0;

    const newSpriteCount = Math.min(this.currentLayout.length, this.maxSprites);
    const previousSpriteCount = this.activeSprites;

    // We must draw enough sprites to cover the previous layout fading out, 
    // or the new layout coming in.
    this.activeSprites = Math.max(previousSpriteCount, newSpriteCount);

    for (let i = 0; i < this.activeSprites; i++) {
      const idx = i * this.cpuStride;

      if (i < newSpriteCount) {
        // ACTIVE SPRITES (Generation & Moving)
        const pt = this.currentLayout[i];
        const targetX = pt.isAbsolute ? pt.x : pt.x + offsetX;
        const targetY = pt.isAbsolute ? pt.y : pt.y + offsetY;

        this.cpuData[idx + 0] = targetX;
        this.cpuData[idx + 1] = targetY;
        this.cpuData[idx + 2] = 0.0; // tz
        this.cpuData[idx + 3] = pt.isUI ? 1.0 : 0.0; // isUI

        this.cpuData[idx + 4] = 1.0; // r
        this.cpuData[idx + 5] = 1.0; // g
        this.cpuData[idx + 6] = 1.0; // b
        this.cpuData[idx + 7] = pt.a !== undefined ? pt.a : 1.0; // a
      } else {
        // DEAD SPRITES (Decimation)
        // Keep their target wherever it was, but set alpha to 0 so they sleep
        this.cpuData[idx + 7] = 0.0; 
      }
    }

    // Push ONLY the CPU target buffer to the GPU
    const gl = this.gl;
    const subArray = this.cpuData.subarray(0, this.activeSprites * this.cpuStride);
    
    gl.bindBuffer(gl.ARRAY_BUFFER, this.cpuBuffer);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, subArray);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  explodeAt(px, py) {
    // Will be a Uniform soon!
  }

  _compileShader(gl, type, source) {
    const shader = gl.createShader(type);
    gl.shaderSource(shader, source);
    gl.compileShader(shader);
    if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
      console.error(`Shader fail (${type === gl.VERTEX_SHADER ? 'VERTEX' : 'FRAGMENT'}):`, gl.getShaderInfoLog(shader));
      gl.deleteShader(shader);
    }
    return shader;
  }

  _renderLoop(timestamp) {
    const gl = this.gl;
    if (this.activeSprites === 0) {
        console.log("[renderLoop] No active sprites on the scene");
        requestAnimationFrame(this._renderLoop);
        return;
    }

    

    const writeIndex = (this.readIndex + 1) % 2;

    // --- PASS 1: PHYSICS COMPUTE ---
    const dt = timestamp - (this.lastTime || timestamp);
    this.lastTime = timestamp;
    
    gl.useProgram(this.physicsProgram);
    const dtLoc = gl.getUniformLocation(this.physicsProgram, "u_deltaTime");
    gl.uniform1f(dtLoc, dt);
    gl.bindVertexArray(this.vaos[this.readIndex]);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, this.transformFeedbacks[this.readIndex]);

    gl.enable(gl.RASTERIZER_DISCARD); 
    gl.beginTransformFeedback(gl.POINTS);
    gl.drawArrays(gl.POINTS, 0, this.activeSprites);
    gl.endTransformFeedback();
    gl.disable(gl.RASTERIZER_DISCARD);
    gl.bindTransformFeedback(gl.TRANSFORM_FEEDBACK, null);

    // --- PASS 2: RENDER TO SCREEN ---
    gl.useProgram(this.renderProgram);
    gl.clearColor(0, 0, 0, 0); 
    gl.clear(gl.COLOR_BUFFER_BIT);

    gl.bindVertexArray(this.vaos[writeIndex]);
    gl.drawArrays(gl.POINTS, 0, this.activeSprites);
    gl.bindVertexArray(null);

    this.readIndex = writeIndex;
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

let pool = null;
let isInitializing = false;
let messageQueue = [];

// Helper function to handle messages once the pool is guaranteed to exist
async function handleMessage(data) {
  switch (data.type) {
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
}

self.onmessage = async (e) => {
  const data = e.data;

  // 1. If we are currently fetching shaders, queue all incoming messages
  if (isInitializing) {
    messageQueue.push(data);
    return;
  }

  // 2. Handle the initial boot sequence
  if (data.type === 'INIT') {
    isInitializing = true;
    
    // Wait for the shaders to be ready
    await ShaderCache.preload();
    
    // Boot the pool
    pool = new SpritePool(data.canvas, data.options);
    ShapeCache.preload('./shapes/letters/NVMono/');
    
    isInitializing = false;
    
    // Flush the queue of any messages that piled up during the await
    while (messageQueue.length > 0) {
      const queuedData = messageQueue.shift();
      await handleMessage(queuedData);
    }
    return;
  }

  // 3. Normal message handling
  await handleMessage(data);
};