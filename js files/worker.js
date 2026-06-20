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
    console.log("All letter sprites cached and ready.");
  }
}

const shaderRamCache = new Map();

const shader_vertex_source_path = './physengine.vert.glsl';
const shader_fragment_source_path = './physengine.frag.glsl';

class ShaderCache {
  static async preload() {
    // 1. Bump the version to invalidate the old cache
    const cacheStorage = await caches.open('hsrp-shaders-v3'); 
    const paths = [shader_vertex_source_path, shader_fragment_source_path];

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
    console.log("Shaders preloaded and cached.");
  }
}

// ─── Global Sprite Pool ──────────────────────────────────────

export class SpritePool {
  constructor(canvas, options = {}) {
    this.canvas = canvas; 
    this.spriteSize = options.spriteSize ?? 3;
    this.maxSprites = options.maxSprites ?? 100000;
    
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

    this.stride = 3; 
    this.data = new Float32Array(this.maxSprites * this.stride);
    this.activeSprites = 0; 
    this.currentLayout = [];

    this.gl = this.canvas.getContext('webgl2', { premultipliedAlpha: false }) || 
              this.canvas.getContext('webgl', { premultipliedAlpha: false });

    const gl = this.gl;

    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    // Retrieve the strings directly from the RAM cache
    const vsSource = shaderRamCache.get(shader_vertex_source_path);
    const fsSource = shaderRamCache.get(shader_fragment_source_path);

    if (!vsSource || !fsSource) {
        throw new Error("WebGL failed: Shaders missing from RAM cache.");
    }

    const vertexShader = this._compileShader(gl, gl.VERTEX_SHADER, vsSource);
    const fragmentShader = this._compileShader(gl, gl.FRAGMENT_SHADER, fsSource);
    
    this.program = gl.createProgram();
    gl.attachShader(this.program, vertexShader);
    gl.attachShader(this.program, fragmentShader);
    gl.linkProgram(this.program);
    gl.useProgram(this.program);

    this.posLoc = gl.getAttribLocation(this.program, "a_position");
    this.alphaLoc = gl.getAttribLocation(this.program, "a_alpha");
    this.resLoc = gl.getUniformLocation(this.program, "u_resolution");
    this.sizeLoc = gl.getUniformLocation(this.program, "u_spriteSize");

    this.buffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    gl.bufferData(gl.ARRAY_BUFFER, this.data.byteLength, gl.DYNAMIC_DRAW);

    const BYTES_PER_FLOAT = 4;
    const STRIDE_BYTES = this.stride * BYTES_PER_FLOAT;

    gl.enableVertexAttribArray(this.posLoc);
    gl.vertexAttribPointer(this.posLoc, 2, gl.FLOAT, false, STRIDE_BYTES, 0);

    gl.enableVertexAttribArray(this.alphaLoc);
    gl.vertexAttribPointer(this.alphaLoc, 1, gl.FLOAT, false, STRIDE_BYTES, 2 * BYTES_PER_FLOAT);
    
    this.layoutCenterX = undefined;
    this.layoutCenterY = undefined;
    this.originX = undefined;
    this.originY = undefined;

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
    this.gl.useProgram(this.program);
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
    this._updateBufferData(); // Snap to new positions instantly
  }

  resetMove() {
    if (this.originX !== undefined && this.originY !== undefined) {
        this.moveTo(this.originX, this.originY);
    }
  }

  async mutateTo(layoutGenerator) {
    const result = await layoutGenerator.getLayout(this.containerWidth, this.containerHeight, this.spriteSize);
    const newLayout = result.layout || result;
    const zones = result.zones || [];

    self.postMessage({ type: 'INTERACTIVE_ZONES', zones: zones });

    this.currentLayout = newLayout;
    this._updateBufferData(); // Push layout to GPU instantly
  }

  _updateBufferData() {
    const offsetX = this.layoutCenterX || 0;
    const offsetY = this.layoutCenterY || 0;

    // Determine how many sprites we actually need to draw
    this.activeSprites = Math.min(this.currentLayout.length, this.maxSprites);

    for (let i = 0; i < this.activeSprites; i++) {
      const pt = this.currentLayout[i];
      const idx = i * this.stride;
      
      // Calculate final absolute X/Y 
      this.data[idx + 0] = pt.isAbsolute ? pt.x : pt.x + offsetX;
      this.data[idx + 1] = pt.isAbsolute ? pt.y : pt.y + offsetY;
      // Use provided alpha, default to 1
      this.data[idx + 2] = pt.a !== undefined ? pt.a : 1.0; 
    }

    const gl = this.gl;
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buffer);
    
    // Only upload the subset of the array that we actually updated
    const subArray = this.data.subarray(0, this.activeSprites * this.stride);
    gl.bufferSubData(gl.ARRAY_BUFFER, 0, subArray);
  }

  explodeAt(px, py) {
    // Deliberate No-op. Ensures main thread doesn't crash when it fires this event.
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

  _renderLoop() {
    const gl = this.gl;
    
    gl.clearColor(0, 0, 0, 0); 
    gl.clear(gl.COLOR_BUFFER_BIT);

    // Draw only the active sprites, skipping physics calculations entirely
    if (this.activeSprites > 0) {
      gl.drawArrays(gl.POINTS, 0, this.activeSprites);
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