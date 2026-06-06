import json
import os
import numpy as np
from PIL import Image

def generate_random_sprites_from_image(input_path, sprite_count, output_path):
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

    # Convert to numpy arrays for fast processing
    rgba_array = np.array(img_rgba)
    gray_array = np.array(img_gray)

    # Extract just the alpha channel from the RGBA array
    alpha_channel = rgba_array[:, :, 3]

    # 2. Find all valid pixels (Image Transparency > 0)
    # This dictates purely POSITIONAL validity. Transparent pixels are ignored.
    valid_y, valid_x = np.where(alpha_channel > 0)

    if len(valid_x) == 0:
        print(f"Error: '{input_path}' is completely transparent.")
        return

    # 3. Randomly sample points from the valid pixels
    # replace=True allows us to generate more sprites than there are pixels if needed.
    indices = np.random.choice(len(valid_x), size=sprite_count, replace=True)

    sprites = []
    for idx in indices:
        x = int(valid_x[idx])
        y = int(valid_y[idx])
        
        # Determine the JSON 'a' value based on the pixel's brightness (0-255)
        # True black (0x000000) will have a brightness of 0 -> na = 0.0
        # White (0xFFFFFF) will have a brightness of 255 -> na = 1.0
        pixel_brightness = gray_array[y, x]
        
        # Normalize coordinates and brightness to 0.0 - 1.0 space
        nx = x / width
        ny = y / height
        na = pixel_brightness / 255.0

        sprites.append({
            "x": round(max(0.0, min(1.0, nx)), 4),
            "y": round(max(0.0, min(1.0, ny)), 4),
            "z": 0.5,
            "a": round(na, 4),  # This is now 0.0 for True Black
            "b": 0
        })

    # 4. Export Data
    filename = os.path.basename(input_path)
    safe_name = os.path.splitext(filename)[0]

    output_data = {
        "meta": {
            "id": f"image_{safe_name}",
            "spriteCount": len(sprites),
            "description": f"Randomly sampled sprites from '{filename}' (A mapped to Brightness)",
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
    input_image = "./images/hsrp-logo.png" # Can be .png or .jpg
    output_json = "./shapes/images/hsrp-logo.sprites.json"
    sprites_to_generate = 50000
    
    print("Beginning random sprite extraction...")
    
    # Generate the file
    if os.path.exists(input_image):
        generate_random_sprites_from_image(input_image, sprites_to_generate, output_json)
    else:
        print(f"Please provide a valid image path. '{input_image}' was not found.")
        
    print("Pipeline complete.")