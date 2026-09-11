from PIL import Image
import numpy as np

img = Image.open("/Users/selvi.none/.gemini/antigravity/brain/7b781582-1984-4058-baf8-6f247e7a7b0f/media__1784137975352.png").convert("RGBA")
data = np.array(img)
h, w, _ = data.shape

# The image has 4 icons horizontally. Let's split into 4 equal width chunks
chunk_w = w // 4
names = ["home", "looks", "ava", "profile"]

for i in range(4):
    chunk = data[:, i*chunk_w:(i+1)*chunk_w, :]
    
    # We want to isolate the icon.
    # Background is mostly white. The text is at the bottom.
    # Let's crop the top 70% of the chunk to avoid the text
    icon_region = chunk[:int(h*0.7), :, :]
    
    # Convert to grayscale to find the drawing
    r, g, b = icon_region[:,:,0], icon_region[:,:,1], icon_region[:,:,2]
    gray = 0.2989 * r + 0.5870 * g + 0.1140 * b
    
    # The drawing is dark, background is light.
    # Let's create an alpha mask: 255 for darkest, 0 for lightest
    # Find min and max gray in this region to normalize
    min_g = np.min(gray)
    max_g = np.max(gray)
    
    if max_g - min_g < 20: # Empty region, fallback
        continue
        
    alpha = 255 - np.clip((gray - min_g) / (max_g - min_g) * 255, 0, 255)
    
    # Create the output transparent white icon
    out = np.zeros_like(icon_region)
    out[:,:,0] = 255
    out[:,:,1] = 255
    out[:,:,2] = 255
    out[:,:,3] = alpha.astype(np.uint8)
    
    # Crop to bounding box
    pil_out = Image.fromarray(out)
    bbox = pil_out.getbbox()
    if bbox:
        pil_out = pil_out.crop(bbox)
        pil_out.save(f"/Users/selvi.none/Desktop/fitme-claudeintegration/fitmefinal_git/fitme-ui/assets/images/tab-{names[i]}.png")

