#version 300 es
precision highp float;

// PING-PONG BUFFERS (Dynamic)
in vec4 a_pos_dying; // [x, y, z, currentAlpha]
in vec4 a_vel_speed; // [dx, dy, dz, speed]

// CPU BUFFERS (Static Targets)
in vec4 a_target_ui; // [tx, ty, tz, isUI]
in vec4 a_color;     // [r, g, b, targetAlpha]

// UNIFORMS
uniform float u_deltaTime; // Pass this from your JS requestAnimationFrame loop

// OUTPUTS
out vec4 out_pos_dying;
out vec4 out_vel_speed;

// Pseudo-random generator for the burst
float random(vec2 st) {
    return fract(sin(dot(st.xy, vec2(12.9898,78.233))) * 43758.5453123);
}

void main() {
    vec3 pos = a_pos_dying.xyz;
    vec3 vel = a_vel_speed.xyz;
    vec3 target = a_target_ui.xyz;
    
    float currentAlpha = a_pos_dying.w;
    float targetAlpha = a_color.a;
    float speed = a_vel_speed.w;

    // Time scaling (matching your JS logic)
    float dt = min(u_deltaTime, 100.0);
    float timeScale = (dt / 16.666) * 0.75;

    // --- SLEEP STATE ---
    if (currentAlpha <= 0.005 && targetAlpha <= 0.005) {
        out_pos_dying = a_pos_dying;
        out_vel_speed = a_vel_speed;
        return;
    }

    // --- DYING STATE (Decimation / Shedding) ---
    if (targetAlpha <= 0.005 && currentAlpha > 0.005) {
        // 1. Initial Burst (Triggered only when it just starts dying)
        // We use speed as a flag. If speed > 0, it hasn't bursted yet.
        if (speed > 0.0) {
            float angle = random(pos.xy) * 6.28318;
            float burstForce = 2.0 + (random(pos.yx) * 5.0);
            vel.x = cos(angle) * burstForce;
            vel.y = sin(angle) * burstForce;
            speed = 0.0; // Flag as bursted
        }

        // 2. Dying Friction
        float dyingFriction = exp(log(0.8) * timeScale);
        vel.xy *= dyingFriction;
        
        pos.xy += vel.xy * timeScale;
        
        // 3. Death Decay (Alpha fade)
        float deathDecay = 1.0 - exp(log(0.99) * timeScale); 
        currentAlpha += (0.0 - currentAlpha) * deathDecay;

        // 4. Curl / Swerve
        // Simulating your curl data with position-based pseudo-randoms
        float curlDir = (random(pos.xy * 0.1) - 0.5) * 2.0; 
        float curlCW = sign(random(pos.yx) - 0.5);
        float drag = 0.1; // Hardcoded for now, or pass via uniform
        
        float swerveStrength = curlDir * 0.45 * drag;
        vec2 globalD = vel.xy; // Using velocity as delta
        
        pos.x += -curlCW * globalD.y * swerveStrength;
        pos.y += curlCW * globalD.x * swerveStrength;
    } 
    // --- ALIVE STATE ---
    else {
        // Wake up alpha instantly or fade in
        currentAlpha = targetAlpha; 

        vec3 diff = target - pos;
        
        // Your spring physics ported directly
        vel += diff * speed * timeScale;
        
        // standard friction
        float aliveFriction = exp(log(0.9) * timeScale);
        vel *= aliveFriction;
        
        pos += vel * timeScale;
        
        // Reset speed flag so it can burst again later if needed
        speed = 0.01; 
    }

    // Output dynamic state
    out_pos_dying = vec4(pos, currentAlpha);
    out_vel_speed = vec4(vel, speed);
}