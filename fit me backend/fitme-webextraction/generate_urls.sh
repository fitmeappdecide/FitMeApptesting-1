#!/usr/bin/env bash
# generate_urls.sh – create a file named myntra_urls.txt with 10 product URLs.
# Categories: t-shirts, shirts, jeans, sarees, dresses, shoes, watches, jackets, kurtas, sportswear
CATEGORIES=(
  "tshirts"
  "shirts"
  "jeans"
  "sarees"
  "dresses"
  "shoes"
  "watches"
  "jackets"
  "kurtas"
  "sportswear"
)
OUTPUT="myntra_urls.txt"
> "$OUTPUT"
for cat in "${CATEGORIES[@]}"; do
  # fetch first page of the category, sort by popularity to get a product page
  URL="https://www.myntra.com/$cat?sort=popularity"
  html=$(curl -s "$URL")
  # extract product links like /<category>/.../.../buy
  # Use grep to find href="/category/.../.../buy" then cut to get full URL
  echo "$html" | grep -oE 'href="/[^\"]+/[^\"]+/[^\"]+/[^\"]+/buy"' | head -n 1 | sed -E 's|href="(/[^\"]+)"|https://www.myntra.com\1|' >> "$OUTPUT"
  # pause a bit to be polite
  sleep 1
done
# Ensure we have at most 10 lines (some categories may duplicate URLs)
head -n 10 "$OUTPUT" > temp && mv temp "$OUTPUT"

echo "Generated $(wc -l < "$OUTPUT") URLs:" && cat "$OUTPUT"
