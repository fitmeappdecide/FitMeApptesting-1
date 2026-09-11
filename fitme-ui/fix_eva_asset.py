from PIL import Image

try:
    img_path = "/Users/selvi.none/Desktop/fitme-claudeintegration/fitmefinal_git/fitme-ui/assets/eva.png"
    img = Image.open(img_path).convert("RGBA")
    
    # Get exact transparent bounding box
    bbox = img.getbbox()
    if not bbox:
        print("Image is entirely transparent!")
        exit(1)
        
    left, upper, right, lower = bbox
    cropped = img.crop((left, upper, right, lower))
    cw, ch = cropped.size
    print(f"Original bounding box: {cw}x{ch}")
    
    # User requested 128x128 or 256x256 with 4-8px padding.
    # Let's use a 128x128 canvas, with 6px padding.
    # So max dimension of the icon will be 128 - 12 = 116.
    final_size = 128
    padding = 6
    target_max_dim = final_size - (padding * 2)
    
    # Calculate scale to fit the max dimension to 116
    scale = target_max_dim / max(cw, ch)
    new_w = int(cw * scale)
    new_h = int(ch * scale)
    print(f"Scaled size: {new_w}x{new_h}")
    
    # Resize with high-quality Lanczos filter
    resized = cropped.resize((new_w, new_h), Image.Resampling.LANCZOS)
    
    # Create the new perfectly square transparent canvas
    final_img = Image.new("RGBA", (final_size, final_size), (0, 0, 0, 0))
    
    # Paste exactly in the geometric center
    paste_x = (final_size - new_w) // 2
    paste_y = (final_size - new_h) // 2
    final_img.paste(resized, (paste_x, paste_y))
    
    # Save back to disk
    final_img.save(img_path)
    
    print(f"Successfully saved centered {final_size}x{final_size} asset with {padding}px padding.")
except Exception as e:
    print(f"Error: {e}")
