import json
import os
import numpy as np
from PIL import Image

def generate_random_sprites_from_image(input_path, sprite_count, output_path, invert_image=False, contrast_scale=5.0):
    # 1. Load Image
    try:
        img = Image.open(input_path)
    except IOError:
        print(f"Error: Could not load image at '{input_path}'.")
        return

    width, height = img.size

    # Force conversion to RGBA to ensure we have a true alpha channel
    img_rgba = img.convert('RGBA')
    
    # Create a grayscale version to calculate the brightness (for the JSON 'a' value)
    img_gray = img.convert('L')

    # Convert to numpy arrays, normalize to 0.0 - 1.0 scale
    rgba_array = np.array(img_rgba) / 255.0
    gray_array = np.array(img_gray) / 255.0

    r_channel = rgba_array[:, :, 0]
    g_channel = rgba_array[:, :, 1]
    b_channel = rgba_array[:, :, 2]
    alpha_channel = rgba_array[:, :, 3]

    # 2. Find all valid pixels
    # Conditions for validity:
    # - Original alpha > 0
    # - R, G, and B must all be >= 0.05 (anything below 0.05 in either channel is transparent)
    # - Originally black/below 0.025 intensity is excluded
    valid_mask = (
        (alpha_channel > 0) & 
        (r_channel >= 0.01) & 
        (g_channel >= 0.01) & 
        (b_channel >= 0.01) & 
        (gray_array >= 0.01)
    )

    valid_y, valid_x = np.where(valid_mask)

    if len(valid_x) == 0:
        print(f"Error: No valid pixels found in '{input_path}' after applying thresholds.")
        return

    # 3. Apply Visual Transformations
    if invert_image:
        # Invert the normalized grayscale
        gray_array = 1.0 - gray_array
        
    # Crank the contrast using a power curve (intensity ^ contrast_scale)
    gray_array = gray_array ** contrast_scale

    # 4. Randomly sample points from the valid pixels
    # replace=True allows us to generate more sprites than there are pixels if needed.
    indices = np.random.choice(len(valid_x), size=sprite_count, replace=True)

    sprites = []
    for idx in indices:
        x = int(valid_x[idx])
        y = int(valid_y[idx])
        
        # Determine the JSON 'a' value based on the newly transformed grayscale array
        na = gray_array[y, x]
        
        # Normalize coordinates
        nx = x / width
        ny = y / height

        sprites.append({
            "x": round(max(0.0, min(1.0, nx)), 4),
            "y": round(max(0.0, min(1.0, ny)), 4),
            "z": 0.5,
            "a": round(na, 4),  
            "b": 0
        })

    # 5. Export Data
    filename = os.path.basename(input_path)
    safe_name = os.path.splitext(filename)[0]

    output_data = {
        "meta": {
            "id": f"image_{safe_name}",
            "spriteCount": len(sprites),
            "description": f"Randomly sampled sprites from '{filename}' (Inverted: {invert_image}, Contrast: ^{contrast_scale})",
            "coordinateSpace": "normalized_0_1"
        },
        "sprites": sprites
    }

    os.makedirs(os.path.dirname(output_path) or ".", exist_ok=True)
    with open(output_path, 'w') as f:
        json.dump(output_data, f, indent=2)

    print(f"Generated {output_path} ({len(sprites)} sprites)")

if __name__ == "__main__":
    # Example Configuration
    input_image = "./images/arrow-left-white.png" # Can be .png or .jpg
    output_json = "./shapes/images/arrow-left-white.sprites.json"
    sprites_to_generate = 1000
    
    # Toggle these values
    invert_image = False 
    contrast_scale = 1.0
    
    print("Beginning random sprite extraction...")
    
    # Generate the file
    if os.path.exists(input_image):
        generate_random_sprites_from_image(
            input_image, 
            sprites_to_generate, 
            output_json, 
            invert_image=invert_image, 
            contrast_scale=contrast_scale
        )
    else:
        print(f"Please provide a valid image path. '{input_image}' was not found.")
        
    print("Pipeline complete.")