#version 300 es
precision highp float;

in vec4 a_pos_dying;
in vec4 a_color;

uniform vec2 u_resolution;
uniform float u_spriteSize;

out vec4 v_color;

void main() {
    vec2 zeroToOne = a_pos_dying.xy / u_resolution;
    vec2 zeroToTwo = zeroToOne * 2.0;
    vec2 clipSpace = zeroToTwo - 1.0;
    gl_Position = vec4(clipSpace * vec2(1, -1), 0.0, 1.0);
    gl_PointSize = u_spriteSize;
    v_color = a_color;
}