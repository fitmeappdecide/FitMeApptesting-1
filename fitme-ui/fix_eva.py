from PIL import Image

try:
    img_path = "/Users/selvi.none/Desktop/fitme-claudeintegration/fitmefinal_git/fitme-ui/assets/eva.png"
    img = Image.open(img_path).convert("RGBA")
    
    # 1. Find the exact bounding box of non-transparent pixels
    bbox = img.getbbox()
    if not bbox:
        print("Image is completely transparent.")
        exit(1)
        
    left, upper, right, lower = bbox
    cropped = img.crop((left, upper, right, lower))
    cw, ch = cropped.size
    print(f"Tight bounding box size: {cw}x{ch}")
    
    # 2. We want a square canvas. Find the max dimension.
    max_dim = max(cw, ch)
    
    # 3. Add padding. The user wants a square canvas like 128x128 or 256x256, 
    # with 4-8px padding if the final display size is ~26x26.
    # So if the target is 256x256, and we want 8px padding when scaled down to 26px...
    # Actually, a simple ratio: 10% padding on each side.
    # Let's just make the final canvas size exactly 256x256.
    # The icon should take up most of it, say 224x224 (leaving 16px padding on all sides).
    
    final_size = 256
    padding = 24
    target_inner_size = final_size - (padding * 2)
    
    # Scale the cropped image to fit within target_inner_size while maintaining aspect ratio
    scale = target_inner_size / max_dim
    new_w = int(cw * scale)
    new_h = int(ch * scale)
    
    # Resize cropped image using high-quality resampling (LANCZOS)
    resized = cropped.resize((new_w, new_h), Image.Resampling.LANCZOS)
    
    # 4. Create a new transparent square canvas
    final_img = Image.new("RGBA", (final_size, final_size), (0, 0, 0, 0))
    
    # 5. Paste the resized icon into the center of the square canvas
    paste_x = (final_size - new_w) // 2
    paste_y = (final_size - new_h) // 2
    final_img.paste(resized, (paste_x, paste_y))
    
    # 6. Save back to eva.png
    final_img.save(img_path)
    print(f"Successfully processed image to {final_size}x{final_size} square canvas.")
    
except Exception as e:
    print("Error:", e)
