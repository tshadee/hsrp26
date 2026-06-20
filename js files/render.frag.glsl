#version 300 es
precision mediump float;

in vec4 v_color;
out vec4 fragColor;

void main() {
    if (v_color.a <= 0.005) {
      discard;
    }
    
    // Draw with the precise color and alpha passed from the buffer
    fragColor = v_color;
}