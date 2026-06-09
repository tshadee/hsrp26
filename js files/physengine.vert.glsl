#version 300 es
precision highp float;

// --- UNIFORMS (Global Settings from CPU) ---
uniform vec2 u_resolution;
uniform float u_spriteSize;
uniform float u_timeScale;
uniform vec2 u_pointer;
uniform float u_time;

// --- INPUTS (From the Read Buffer) ---
layout(location = 0) in vec3 a_posAlpha;       // x, y, a
layout(location = 1) in vec3 a_targetPosAlpha; // tx, ty, ta
layout(location = 2) in vec3 a_startPosAlpha;  // sx, sy, sa
layout(location = 3) in vec3 a_progSpeedDrag;  // prog, speed, drag
layout(location = 4) in vec2 a_dyingShed;      // dying, shed
layout(location = 5) in vec2 a_velocity;       // evx, evy
layout(location = 6) in vec3 a_curlAndUi;      // curl_dir, curl_cw, is_ui

// --- OUTPUTS (To the Write Buffer for next frame) ---
out vec3 v_posAlpha;
out vec3 v_targetPosAlpha;
out vec3 v_startPosAlpha;
out vec3 v_progSpeedDrag;
out vec2 v_dyingShed;
out vec2 v_velocity;
out vec3 v_curlAndUi;

// --- TO FRAGMENT SHADER ---
out float v_alphaToFrag;

void main() {
    // We will put the physics math right here later.
    
    // For now, just pass the data straight through untouched so we don't break anything:
    v_posAlpha = a_posAlpha;
    v_targetPosAlpha = a_targetPosAlpha;
    v_startPosAlpha = a_startPosAlpha;
    v_progSpeedDrag = a_progSpeedDrag;
    v_dyingShed = a_dyingShed;
    v_velocity = a_velocity;
    v_curlAndUi = a_curlAndUi;
    
    // Draw logic
    vec2 zeroToOne = a_posAlpha.xy / u_resolution;
    vec2 clipSpace = (zeroToOne * 2.0) - 1.0;
    gl_Position = vec4(clipSpace * vec2(1, -1), 0.0, 1.0);
    gl_PointSize = u_spriteSize;
    v_alphaToFrag = a_posAlpha.z;
}