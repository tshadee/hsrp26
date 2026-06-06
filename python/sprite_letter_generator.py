import json
import os
import cv2
import numpy as np
from PIL import Image, ImageDraw, ImageFont

def skeletonize(img):
    """
    Iteratively thins a binary image to a 1-pixel wide skeleton
    to emulate the center stroke of the shape.
    """
    skel = np.zeros(img.shape, np.uint8)
    
    # Ensure the image is strictly binary
    _, img_thresh = cv2.threshold(img, 127, 255, 0)
    
    # Use a cross-shaped structuring element for skeletonization
    element = cv2.getStructuringElement(cv2.MORPH_CROSS, (3, 3))
    
    while True:
        eroded = cv2.erode(img_thresh, element)
        temp = cv2.dilate(eroded, element)
        temp = cv2.subtract(img_thresh, temp)
        skel = cv2.bitwise_or(skel, temp)
        img_thresh = eroded.copy()
        
        # Stop when there are no more white pixels left to erode
        if cv2.countNonZero(img_thresh) == 0:
            break
            
    return skel

def generate_typographic_sprites():
    # 1. Configuration
    font_path = "C:/Windows/Fonts/cour.ttf"  # Ensure this points to a valid font
    #font_path = "python/RogetaRegular.ttf"
    sprite_count = 50
    canvas_size = 300
    charset = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.!@#$%^&*() -_=+[]{}|;:,.<>?/~`"
    output_dir = "./shapes/letters/"

    special_char_outputs = {
        '?': 'question',
        '/': 'slash',
        '.': 'period',
        '!': 'exclamation',
        '@': 'at',
        '#': 'hash',
        '$': 'dollar',
        '%': 'percent',
        '^': 'caret',
        '&': 'ampersand',
        '*': 'asterisk',
        '(': 'left_paren',
        ')': 'right_paren',
        ' ': 'space',
        '\n': 'enter',
        ',': 'comma', 
        "'": 'apostrophe', 
        '"': 'quotation',
        ';': 'semicolon', 
        ':': 'colon',
        '<': 'less_than',
        '>': 'greater_than',
        '+': 'plus',
        '=': 'equals',
        '-': 'dash',
        '{': 'left_brace',
        '}': 'right_brace',
        '[': 'left_bracket',
        ']': 'right_bracket',
        '|': 'pipe',
        '~': 'tilde',
        '`': 'backtick' 
    }

    os.makedirs(output_dir, exist_ok=True)

    # 2. Setup Canvas & Font
    img = Image.new('L', (canvas_size, canvas_size), color=0)
    draw = ImageDraw.Draw(img)

    try:
        # Scale font to about 60% of canvas to leave room for ascenders/descenders
        font = ImageFont.truetype(font_path, int(canvas_size * 0.6))
    except IOError:
        print(f"Error: Could not load font at '{font_path}'.")
        return

    # 3. Calculate Global Typographic Metrics
    ascent, descent = font.getmetrics()
    total_height = ascent + descent
    
    # Find the maximum width of any character in the set
    max_width = max(draw.textlength(c, font=font) for c in charset)
    
    # Create a square "viewport" based on the largest dimension (+10% padding)
    # This prevents distortion and ensures consistent scaling
    square_size = max(max_width, total_height) * 1.1 
    
    # The canvas coordinates where we will anchor every letter
    anchor_x = canvas_size / 2
    anchor_y = canvas_size / 2 
    
    # Calculate the logical top-left of our normalization viewport
    viewport_left = anchor_x - (square_size / 2)
    
    # The vertical center of the text is (baseline - ascent + half_height)
    text_center_y = anchor_y - ascent + (total_height / 2)
    viewport_top = text_center_y - (square_size / 2)

    print(f"Global Viewport Setup: Size={square_size:.2f}px, Baseline={anchor_y}px")

    # 4. Process Each Character
    for char in charset:
        # Clear the canvas
        draw.rectangle([0, 0, canvas_size, canvas_size], fill=0)
        
        # Draw letter anchored exactly at the center horizontally, and on the baseline vertically
        draw.text((anchor_x, anchor_y), char, font=font, fill=255, anchor="ms")

        # Convert to OpenCV format
        img_np = np.array(img)

        # Skeletonize the image to find the center stroke instead of the outline
        skeleton_img = skeletonize(img_np)

        # Find all outlines on the thinned skeleton
        contours, _ = cv2.findContours(skeleton_img, cv2.RETR_LIST, cv2.CHAIN_APPROX_NONE)

        if not contours:
            print(f"Warning: No strokes found for '{char}'. Skipping.")
            continue

        # Calculate the total perimeter length
        total_length = sum(cv2.arcLength(cnt, closed=True) for cnt in contours)

        # Distribute sprites evenly
        step_size = total_length / sprite_count
        sprites = []
        current_distance = 0

        for cnt in contours:
            pts = cnt.reshape(-1, 2)
            pts = np.vstack((pts, pts[0])) # Close the loop

            for i in range(len(pts) - 1):
                p1 = pts[i].astype(float)
                p2 = pts[i+1].astype(float)
                dist = np.linalg.norm(p2 - p1)

                while current_distance + dist >= step_size:
                    ratio = (step_size - current_distance) / dist
                    px = p1[0] + ratio * (p2[0] - p1[0])
                    py = p1[1] + ratio * (p2[1] - p1[1])

                    # Normalize against the GLOBAL viewport, not the local bounding box
                    nx = (px - viewport_left) / square_size
                    ny = (py - viewport_top) / square_size

                    sprites.append({
                        "x": round(max(0.0, min(1.0, nx)), 4),
                        "y": round(max(0.0, min(1.0, ny)), 4),
                        "z": 0.5,
                        "a": 1.0,
                        "b": 0
                    })

                    p1 = np.array([px, py])
                    dist = np.linalg.norm(p2 - p1)
                    current_distance = 0
                    
                    if len(sprites) == sprite_count:
                        break
                else:
                    current_distance += dist
                
                if len(sprites) == sprite_count:
                    break
            if len(sprites) == sprite_count:
                break

        # 5. Export Data
        
        # Determine safe filename
        if char in special_char_outputs:
            safe_name = special_char_outputs[char]
        elif char.isupper():
            safe_name = f"{char}_upper"
        elif char.islower():
            safe_name = f"{char}_lower"
        else:
            safe_name = char

        output_data = {
            "meta": {
                "id": f"character_{safe_name}",
                "spriteCount": len(sprites),
                "description": f"Character '{char}' - Stroke Skeletonized & Typographically Aligned",
                "coordinateSpace": "normalized_0_1"
            },
            "sprites": sprites
        }

        filename = os.path.join(output_dir, f"{safe_name}.sprites.json")
        with open(filename, 'w') as f:
            json.dump(output_data, f, indent=2)

        print(f"Generated {filename} ({len(sprites)} sprites)")

if __name__ == "__main__":
    print("Beginning aligned skeleton extraction pipeline...")
    generate_typographic_sprites()
    print("Pipeline complete.")