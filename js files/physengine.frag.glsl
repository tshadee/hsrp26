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