#version 300 es
precision highp float;

// --- INPUTS (Automatically unpacked by WebGL on the way in) ---
in vec3 a_pos;       // 12 bytes (X, Y, Z)
in vec3 a_target;    // 12 bytes (TX, TY, TZ)
in vec3 a_start;     // 12 bytes (SX, SY, SZ)
in vec3 a_ev;        // 6 bytes unpacked to vec3 (EVX, EVY, EVZ)
in vec2 a_curl;      // 2 bytes unpacked to vec2 normalized [-1.0, 1.0]
in vec4 a_color;     // 4 bytes unpacked to vec4 normalized [0.0, 1.0]
in vec4 a_params;    // 4 bytes unpacked to vec4 normalized (PROG, SPEED, DRAG, SHED)
in vec4 a_meta;      // 4 bytes unpacked to vec4 normalized (DYING, IS_UI, TA, PAD)

// --- OUTPUTS (Manually packed into 32-bit chunks on the way out) ---
out vec3 v_pos;
out vec3 v_target;
out vec3 v_start;
out uint v_ev_xy;    // Bytes 36-39: EVX & EVY
out uint v_evz_curl; // Bytes 40-43: EVZ & CURL
out uint v_color;    // Bytes 44-47: R, G, B, A
out uint v_params;   // Bytes 48-51: PROG, SPEED, DRAG, SHED
out uint v_meta;     // Bytes 52-55: DYING, IS_UI, TA, PAD

// --- UNIFORMS ---
uniform float u_dt;
uniform float u_timestamp;
uniform float u_lastMorphTime;
uniform vec3 u_pointer; // Upgraded to 3D pointer
uniform float u_width;

void main() {
    // 1. Map packed params to readable names
    float prog = a_params.x;
    float speed = a_params.y;
    float drag = a_params.z;
    float shed = a_params.w;
    
    float isDying = a_meta.x;
    float isUI = a_meta.y;
    float targetAlpha = a_meta.z;
    
    vec3 pos = a_pos;
    vec3 ev = a_ev;
    vec4 color = a_color;
    
    float timeScale = (min(u_dt, 100.0) / 16.666) * 0.75;
    vec3 oldPos = pos;

    // 2. Trigger Decimation (Shedding)
    // Note: In WebGL, we compare floats to > 0.5 instead of == 1.0 to avoid precision errors
    if (isDying < 0.5 && prog >= shed) {
        isDying = 1.0;
        targetAlpha = 0.0;
        
        // Pseudo-random 3D burst based on starting position
        vec3 noise = fract(sin(pos * vec3(12.9898, 78.233, 45.164)) * 43758.5453) * 2.0 - 1.0;
        ev = normalize(noise) * (2.0 + fract(pos.x * 123.456) * 5.0);
    }

    // 3. 3D State Routing
    if (isDying > 0.5) {
        // --- DYING STATE ---
        float dyingFriction = exp(log(0.8) * timeScale);
        ev *= dyingFriction;
        pos += ev * timeScale;
        
        float deathDecay = 1.0 - exp(log(0.99) * timeScale);
        color.a += (0.0 - color.a) * deathDecay;
        
        // 3D Swerve: Cross product with a fixed up-vector to curl outward
        vec3 globalD = pos - oldPos;
        vec3 up = vec3(0.0, 1.0, 0.0); 
        vec3 swerveDir = cross(globalD, up);
        pos += swerveDir * a_curl.x * 0.45 * drag;

    } else {
        // --- ALIVE STATE ---
        float timeSinceMorph = u_timestamp - u_lastMorphTime;
        bool canSleep = timeSinceMorph > 2500.0;
        
        vec3 pd = pos - u_pointer;
        float pDistSq = dot(pd, pd);
        float hoverRadius = u_width * 0.025; 
        float hoverRadiusSq = hoverRadius * hoverRadius;

        if (canSleep && prog >= 1.0 && pDistSq > hoverRadiusSq * 4.0 && targetAlpha == color.a) {
            pos = a_target;
            ev = vec3(0.0);
        } else {
            vec3 hoverOffset = vec3(0.0);
            if (isUI > 0.5 && pDistSq < hoverRadiusSq) {
                float pDist = sqrt(pDistSq);
                float fluctuation = 0.5 + sin(u_timestamp * 0.005 + float(gl_VertexID)) * 1.0;
                float force = (1.0 - pDist / hoverRadius) * 20.0 * fluctuation;
                hoverOffset = normalize(pd) * force;
            }

            if (prog < 1.0) {
                prog = min(1.0, prog + speed * drag * timeScale);
                float t = prog;
                float ease = t < 0.5 ? 4.0 * t * t * t : 1.0 - pow(-2.0 * t + 2.0, 4.0) / 2.0;

                vec3 globalD = a_target - a_start;
                vec3 basePos = a_start + globalD * ease;

                // 3D Turbulence
                float turbulence = sin(t * 3.14159);
                vec3 curlOffset = cross(globalD, vec3(0.0, 0.0, 1.0)) * a_curl.x;
                
                pos = basePos + curlOffset * 0.05 * turbulence * drag + hoverOffset;
            } else {
                float friction = exp(log(0.9) * drag * timeScale);
                ev *= friction;
                pos += ev * timeScale;

                float easeBack = 1.0 - exp(log(0.7) * timeScale);
                pos += ((a_target + hoverOffset) - pos) * easeBack;
            }

            // Kinetic Alpha calculation
            vec3 vel = (pos - oldPos) / timeScale;
            float currentSpeed = length(vel);
            float dist = distance(a_target, pos);
            
            float kineticAlpha = clamp((currentSpeed / 4.0) * 0.85, 0.1, 1.5);
            float deadzoneMix = dist < 5.0 ? 1.0 : (dist < 15.0 ? 1.0 - ((dist - 5.0) / 10.0) : 0.0);
            
            float desiredAlpha = mix(kineticAlpha, targetAlpha, deadzoneMix);
            color.a += (desiredAlpha - color.a) * (1.0 - exp(log(0.8) * timeScale));
        }
    }

    // Hard clamp alpha
    if (color.a < 0.005) color.a = 0.0;

    // 4. PACKING OUT TO THE BUFFER
    v_pos = pos;
    v_target = a_target;
    v_start = a_start;

    // Pack Float16s (EVX, EVY) into one 32-bit uint
    v_ev_xy = packHalf2x16(ev.xy);

    // Pack EVZ (Float16) and CURL (2x Int8) into one 32-bit uint
    uint packed_evz = packHalf2x16(vec2(ev.z, 0.0)) & 0xFFFFu; // Take lower 16 bits
    uint packed_curl = packSnorm4x8(vec4(a_curl.x, a_curl.y, 0.0, 0.0)); // Snorm gives -1 to 1 mapping
    v_evz_curl = packed_evz | (packed_curl << 16); // Shift curl into upper 16 bits

    // Pack Uint8 blocks directly back to 32-bit uints
    v_color = packUnorm4x8(color);
    v_params = packUnorm4x8(vec4(prog, speed, drag, shed));
    v_meta = packUnorm4x8(vec4(isDying, isUI, targetAlpha, 0.0));
}