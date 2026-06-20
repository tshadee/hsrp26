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