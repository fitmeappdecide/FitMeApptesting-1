from PIL import Image
import numpy as np

img = Image.open("/Users/selvi.none/Desktop/fitme-claudeintegration/fitmefinal_git/fitme-ui/assets/images/ava-logo.png").convert("RGBA")
data = np.array(img)

# Background color is roughly (34, 40, 50)
# We calculate distance from background color
bg_color = np.array([34, 40, 50, 255])
diff = np.abs(data.astype(int) - bg_color)
is_bg = np.all(diff[:, :, :3] < 20, axis=2)

# Make background transparent, and make the logo solid white (for tinting)
# To preserve anti-aliasing, we can use the lightness or distance to blend the alpha
# Calculate lightness of original pixels
# Beige is (225, 208, 183) -> Lightness is high
# BG is (34, 40, 50) -> Lightness is low
r, g, b, a = data[:,:,0], data[:,:,1], data[:,:,2], data[:,:,3]
gray = 0.2989 * r + 0.5870 * g + 0.1140 * b

# Normalize gray so that BG is 0 and Beige is 255
gray_norm = np.clip((gray - 38) / (215 - 38) * 255, 0, 255).astype(np.uint8)

# Set all pixels to white, but use the normalized gray as the alpha channel!
data[:,:,0] = 255
data[:,:,1] = 255
data[:,:,2] = 255
data[:,:,3] = gray_norm

img_out = Image.fromarray(data)

# Crop to bounding box of the non-transparent pixels
bbox = img_out.getbbox()
if bbox:
    img_out = img_out.crop(bbox)

# Save the transparent icon
img_out.save("/Users/selvi.none/Desktop/fitme-claudeintegration/fitmefinal_git/fitme-ui/assets/images/ava-logo-transparent.png")
