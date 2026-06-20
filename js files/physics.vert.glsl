#version 300 es
precision highp float;

in vec4 a_pos_dying;
in vec4 a_target_drag;
in vec4 a_vel_speed;
in vec4 a_color;
in vec4 a_curl_interact;
in vec4 a_skip_pad;

out vec4 out_pos_dying;
out vec4 out_target_drag;
out vec4 out_vel_speed;
out vec4 out_color;
out vec4 out_curl_interact;
out vec4 out_skip_pad;

void main() {
    // Snap current X/Y to target X/Y for static testing
    vec4 next_pos = a_pos_dying;
    next_pos.xy = a_target_drag.xy;
    
    out_pos_dying = next_pos;
    out_target_drag = a_target_drag;
    out_vel_speed = a_vel_speed;
    out_color = a_color;
    out_curl_interact = a_curl_interact;
    out_skip_pad = a_skip_pad;
}