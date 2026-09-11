(function() {
  // ── Utilities ──────────────────────────────────────────────────────────────
  function text(sel) {
    var el = document.querySelector(sel);
    return el ? (el.textContent || '').trim() : null;
  }
  function attr(sel, a) {
    var el = document.querySelector(sel);
    return el ? el.getAttribute(a) : null;
  }
  function metaProp(p) {
    var el = document.querySelector('meta[property="' + p + '"]') ||
             document.querySelector('meta[name="' + p + '"]');
    return el ? el.getAttribute('content') : null;
  }
  function parseFloat2(s) {
    if (s == null) return NaN;
    var n = parseFloat(String(s).replace(/,/g, '').replace(/[^\d.]/g, ''));
    return n;
  }

  // ── 1. __NEXT_DATA__ (Myntra and Next.js sites) ────────────────────────────
  var nextData = null;
  var nd = document.getElementById('__NEXT_DATA__');
  if (nd) { nextData = nd.textContent; }

  // ── 2. All JSON-LD scripts ─────────────────────────────────────────────────
  var jsonLD = [];
  var ldScripts = document.querySelectorAll('script[type="application/ld+json"]');
  for (var i = 0; i < ldScripts.length; i++) {
    var content = (ldScripts[i].textContent || '').trim();
    if (content) jsonLD.push(content);
  }
  console.log('[FitMe] JSON-LD count:', jsonLD.length);
  if (jsonLD.length) console.log('[FitMe] First JSON-LD (200):', jsonLD[0].slice(0, 200));

  // ── 3. OpenGraph + meta fallbacks ─────────────────────────────────────────
  var title = text('#title') || text('#productTitle') || metaProp('og:title') ||
              metaProp('twitter:title') || (document.title || '').trim() || null;
  if (title) {
    title = title.replace(/^Buy\s+/i, '');
    title = title.split(' - ')[0];
    title = title.split('|')[0];
    title = title.trim();
  }
  var description = metaProp('og:description') || metaProp('description');
  var ogImage = metaProp('og:image') || metaProp('twitter:image');
  var brand = metaProp('product:brand') || metaProp('og:site_name');
  var priceAmount = null;

  // ── 4. Noise filter for image collection ──────────────────────────────────
  function isNoise(el) {
    while (el && el !== document.body) {
      var cl = (el.className || '').toString().toLowerCase();
      var id = (el.id || '').toString().toLowerCase();
      if (cl.includes('similar') || id.includes('similar') ||
          cl.includes('recommend') || id.includes('recommend') ||
          cl.includes('related') || id.includes('related') ||
          cl.includes('swatch') || id.includes('swatch') ||
          cl.includes('color') || id.includes('color') ||
          cl.includes('variant') || id.includes('variant') ||
          cl.includes('widget') || id.includes('widget') ||
          cl.includes('footer') || id.includes('footer') ||
          cl.includes('header') || id.includes('header') ||
          cl.includes('nav') || id.includes('nav') ||
          cl.includes('menu') || id.includes('menu') ||
          cl.includes('feedback') || id.includes('feedback') ||
          cl.includes('payment') || id.includes('payment') ||
          cl.includes('delivery') || id.includes('delivery') ||
          cl.includes('tax') || id.includes('tax')) {
        return true;
      }
      el = el.parentElement;
    }
    return false;
  }

  // ── 5. Collect product images ─────────────────────────────────────────────
  var imgs = [];
  var seen = {};
  function pushImg(src) {
    if (!src) return;
    if (src.indexOf('data:') === 0) return;
    if (seen[src]) return;
    seen[src] = 1;
    imgs.push(src);
  }
  if (ogImage) pushImg(ogImage);

  // Prefer known product-gallery selectors first
  var galleryRoots = document.querySelectorAll(
    '#main-image-container img, #imgTagWrapperId img, img#landingImage, img[data-a-dynamic-image],' +
    '.image-grid-image, .image-grid-imageContainer, [class*="ImageGallery"], [class*="image-gallery"],' +
    '[class*="product-image"], [class*="ProductImage"], picture img, [data-testid*="image"] img,' +
    'img[src*="assets.ajio.com"], img[data-src*="assets.ajio.com"],' +
    'img[data-src*="hm.com"], img[src*="hm.com"],' +
    '.product-hero img, .product-image img');

  var attrList = ['src', 'data-src', 'data-original', 'data-lazy', 'data-srcset', 'srcset'];

  function extractSrc(el) {
    var s = '';
    var dynStr = el.getAttribute ? el.getAttribute('data-a-dynamic-image') : null;
    if (dynStr) {
      try {
        var obj = JSON.parse(dynStr);
        var keys = Object.keys(obj);
        if (keys.length) {
          // Choose the URL with the largest width (extract numbers before Wx)
          var bestKey = keys[0];
          var getWidth = function(k) { var m = k.match(/-(\d+)Wx/); return m ? parseInt(m[1],10) : 0; };
          var maxW = getWidth(bestKey);
          for (var i = 1; i < keys.length; i++) {
            var w = getWidth(keys[i]);
            if (w > maxW) { maxW = w; bestKey = keys[i]; }
          }
          s = bestKey;
        }
      } catch(e) { /* ignore parse errors */ }
    }
    if (!s) {
      for (var a = 0; a < attrList.length; a++) {
        var v = el.getAttribute ? el.getAttribute(attrList[a]) : el[attrList[a]];
        if (v && v.indexOf('data:') !== 0 && !v.includes('placeholder')) { s = v; break; }
      }
    }
    // Pick last item from srcset
    if (s && s.indexOf(',') !== -1 && s.indexOf('http') === 0) {
      var parts = s.split(',');
      s = parts[parts.length - 1].trim().split(' ')[0];
    }
    return s;
  }

  for (var g = 0; g < galleryRoots.length; g++) {
    var el = galleryRoots[g];
    var isAmz = (el.hasAttribute && el.hasAttribute('data-a-dynamic-image')) ||
                el.id === 'landingImage' ||
                (el.closest && el.closest('#main-image-container, #imgTagWrapperId'));
    if (!isAmz && isNoise(el)) continue;
    if (el.tagName === 'IMG') {
      pushImg(extractSrc(el));
    } else {
      var sub = el.querySelector('img');
      if (sub) pushImg(extractSrc(sub));
    }
  }

  // Fallback: all <img> on page
  if (imgs.length < 3) {
    var allImgs = document.querySelectorAll('img');
    for (var j = 0; j < allImgs.length; j++) {
      var imgEl = allImgs[j];
      var isAmz2 = (imgEl.hasAttribute && imgEl.hasAttribute('data-a-dynamic-image')) ||
                   imgEl.id === 'landingImage' ||
                   (imgEl.closest && imgEl.closest('#main-image-container, #imgTagWrapperId'));
      if (!isAmz2 && isNoise(imgEl)) continue;
      var s2 = extractSrc(imgEl) || imgEl.currentSrc || imgEl.src;
      if (s2 && s2.indexOf('data:') !== 0 && /\.(jpg|jpeg|png|webp)/i.test(s2)) pushImg(s2);
    }
  }


  // ── 6. Platform-specific overrides ────────────────────────────────────────
  var host = window.location.host.toLowerCase();

  // ────── Myntra ────────────────────────────────────────────────────────────
  if (host.includes('myntra')) {
    var t1 = text('h1.pdp-title') || '';
    var t2 = text('h1.pdp-name') || '';
    if (t1 || t2) {
      title = (t1 + ' ' + t2).trim();
    }
    try {
      if (nextData) {
        var nd = JSON.parse(nextData);
        var pData = nd.props.pageProps.initialState.pdpData;
        if (pData && pData.name) {
           title = (pData.brand && pData.brand.name ? pData.brand.name + ' ' : '') + pData.name;
        }
        if (pData && pData.media && pData.media.albums && pData.media.albums.length > 0) {
           var albumImgs = pData.media.albums[0].images;
           if (albumImgs && albumImgs.length > 0) {
              var newImgs = [];
              for (var idx = 0; idx < albumImgs.length; idx++) {
                 if (albumImgs[idx].imageURL) newImgs.push(albumImgs[idx].imageURL);
              }
              if (newImgs.length > 0) {
                 imgs = newImgs.concat(imgs);
              }
           }
        }
      }
    } catch(e) {}

  // ────── Amazon ────────────────────────────────────────────────────────────
  } else if (host.includes('amazon')) {
    var p = text('.priceToPay .a-price-whole') ||
            text('#corePrice_feature_div .a-price-whole') ||
            text('#corePriceDisplay_desktop_feature_div .a-price-whole') ||
            text('.a-price .a-offscreen');
    if (p) priceAmount = p;

    var amzImg = document.querySelector('#landingImage') ||
                 document.querySelector('#imgBlkFront') ||
                 document.querySelector('#main-image') ||
                 document.querySelector('#imgTagWrapperId img') ||
                 document.querySelector('img[data-a-dynamic-image]');
    if (amzImg) {
      var dyn = amzImg.getAttribute('data-a-dynamic-image');
      if (dyn) {
        try { var ks = Object.keys(JSON.parse(dyn)); if (ks.length && !imgs.includes(ks[0])) imgs.unshift(ks[0]); } catch(e) {}
      } else if (amzImg.src && !amzImg.src.startsWith('data:') && !imgs.includes(amzImg.src)) {
        imgs.unshift(amzImg.src);
      }
    }

    var t = text('#title') || text('#productTitle');
    if (t) title = t;
    var d = text('#productDescription') || text('#feature-bullets');
    if (d) description = d;

  // ────── H&M ───────────────────────────────────────────────────────────────
  } else if (host.includes('hm.com')) {
    // Step 1: explicit price attributes
    var p = text('[data-testid="product-price-value"]') ||
            text('[data-testid="product-price"]') ||
            text('[class*="product-detail-main-price-value"]') ||
            text('#product-price') ||
            text('hm-product-price');

    // Step 2: JSON-LD price scan
    if (!p) {
      for (var si = 0; si < ldScripts.length; si++) {
        try {
          var ld = JSON.parse(ldScripts[si].textContent);
          var objs = Array.isArray(ld) ? ld : (ld['@graph'] ? ld['@graph'] : [ld]);
          for (var oi = 0; oi < objs.length; oi++) {
            var offers = objs[oi].offers;
            if (!offers) continue;
            if (Array.isArray(offers)) offers = offers[0];
            var prc = (offers.lowPrice !== undefined ? String(offers.lowPrice) : null) || String(offers.price || '');
            var fval = parseFloat2(prc);
            if (!isNaN(fval) && fval >= 1 && fval <= 200000) { p = String(fval); break; }
          }
          if (p) break;
        } catch(e) {}
      }
    }

    // Step 3: DOM price scan
    if (!p) {
      var els = document.querySelectorAll('span, p, div, strong, em');
      var priceClassBest = null, priceClassVal = Infinity, anyBest = null, anyVal = Infinity;
      var promoRe = /free|shipping|over|above|member|earn|loyalty|total|subtotal|delivery|voucher/i;
      for (var ei = 0; ei < els.length; ei++) {
        var e = els[ei];
        var st = window.getComputedStyle(e);
        if (st && (st.display === 'none' || st.visibility === 'hidden')) continue;
        if (e.children.length > 2) continue;
        var txt = (e.textContent || '').trim();
        if (!txt || txt.length > 200 || promoRe.test(txt)) continue;
        var m = txt.match(/(?:₹|Rs\.?|INR)\s*([\d,]+(?:\.\d{1,2})?)/i);
        if (!m) continue;
        var fval = parseFloat2(m[1].replace(/,/g, ''));
        if (isNaN(fval) || fval < 1 || fval > 200000) continue;
        var cls = (e.className || '').toLowerCase();
        var priceScore = /price|cost|amount|mrp/i.test(cls) ? fval : Infinity;
        if (priceScore < priceClassVal) { priceClassBest = txt; priceClassVal = priceScore; }
        if (fval < anyVal) { anyBest = txt; anyVal = fval; }
      }
      p = priceClassBest || anyBest;
    }
    if (p) priceAmount = p;

  // ────── AJIO ──────────────────────────────────────────────────────────────
  } else if (host.includes('ajio.com')) {
    // 1. Pull the first JSON-LD object that looks like a Product / ProductGroup
    var ajioData = null;
    for (var i = 0; i < jsonLD.length; i++) {
        try {
            var ldObj = JSON.parse(jsonLD[i]);
            // Handle @graph arrays
            var candidates = ldObj['@graph'] ? ldObj['@graph'] : (Array.isArray(ldObj) ? ldObj : [ldObj]);
            for (var ci = 0; ci < candidates.length; ci++) {
                var c = candidates[ci];
                var t = c['@type'] || '';
                if (typeof t === 'string') t = [t];
                for (var ti = 0; ti < t.length; ti++) {
                    if (t[ti].indexOf('Product') !== -1) { ajioData = c; break; }
                }
                if (ajioData) break;
            }
        } catch(e) {}
        if (ajioData) break;
    }

    // 2. Title - prefer json-ld name, then many DOM selectors
    if (ajioData && ajioData.name) {
        title = ajioData.name.trim();
    } else {
        var t = text('.prod-name') ||
                text('h1.prod-name') ||
                text('[class*="prod-name"]') ||
                text('[class*="product-name"]') ||
                text('[class*="productName"]') ||
                text('[class*="prod-title"]') ||
                text('[class*="product-title"]') ||
                text('[data-testid="product-title"]') ||
                text('[data-testid="productName"]') ||
                text('h1');
        if (t) title = t;
    }
    if (title) {
       title = title.replace(/\s+Online$/i, '').replace(/\s*\|.*$/, '').trim();
    }

    // 3. Brand - read from json-ld if present, otherwise from DOM with many selectors
    if (ajioData && ajioData.brand) {
        brand = typeof ajioData.brand === 'string' ? ajioData.brand.trim() : ((ajioData.brand.name || '').trim() || null);
    }
    if (!brand || brand === 'Unknown') {
        var b = text('[class*="brand-name"]') ||
                text('[class*="brandName"]') ||
                text('[class*="brand-title"]') ||
                text('.brand-name') ||
                text('.brandName') ||
                text('[data-testid="brand-name"]') ||
                text('[data-testid="brandName"]') ||
                text('[class*="prod-desc"] [class*="brand"]') ||
                metaProp('product:brand') ||
                (function() {
                    // Try to find brand from title: pattern is often "Brand Name - Product Name"
                    var og = metaProp('og:title') || '';
                    var parts = og.split(' - ');
                    if (parts.length >= 2) return parts[0].trim();
                    return null;
                })();
        if (b && b.length < 60) brand = b;
    }

    // 4. Price - json-ld offers, then many DOM fallbacks
    if (ajioData && ajioData.offers) {
        var offers = ajioData.offers;
        var first = Array.isArray(offers) ? offers[0] : offers;
        if (first && first.price) priceAmount = String(first.price);
        else if (first && first.lowPrice) priceAmount = String(first.lowPrice);
    }
    if (!priceAmount) {
        var p = text('.prod-cp') ||
                text('[class*="prod-cp"]') ||
                text('[class*="prod-sp"]') ||
                text('[class*="product-price"]') ||
                text('[class*="productPrice"]') ||
                text('[class*="price-wrap"]') ||
                text('[class*="priceWrap"]') ||
                text('[class*="final-price"]') ||
                text('[class*="finalPrice"]') ||
                text('[data-testid="product-price"]') ||
                text('[data-testid*="price"]');
        if (p) priceAmount = p;
    }
    // Scan all spans/divs for price if still missing
    if (!priceAmount) {
        var priceEls = document.querySelectorAll('span, div, p, strong');
        for (var pi = 0; pi < priceEls.length; pi++) {
            var pEl = priceEls[pi];
            var pTxt = (pEl.textContent || '').trim();
            if (pTxt.length > 30 || pEl.children.length > 2) continue;
            var pm = pTxt.match(/(?:₹|Rs\.?|MRP:?\s*₹?)\s*([\d,]+(?:\.\d{1,2})?)/i);
            if (pm) { priceAmount = pTxt; break; }
        }
    }

    // 5. Images - collect from JSON-LD first, then scrape all AJIO CDN images from DOM
    var imgList = [];

    // JSON-LD root image
    if (ajioData && ajioData.image) {
        var rootImgs = Array.isArray(ajioData.image) ? ajioData.image : [ajioData.image];
        for (var ri = 0; ri < rootImgs.length; ri++) {
            var imgUrl = rootImgs[ri];
            if (typeof imgUrl === 'object' && imgUrl.url) imgUrl = imgUrl.url;
            if (typeof imgUrl === 'string' && imgUrl.length > 5) imgList.push(imgUrl.split('?')[0]);
        }
    }
    // hasVariant images
    if (ajioData && ajioData.hasVariant) {
        var variants = Array.isArray(ajioData.hasVariant) ? ajioData.hasVariant : [ajioData.hasVariant];
        for (var v = 0; v < variants.length; v++) {
            var vi = variants[v];
            if (vi && vi.image) {
                var vImgs = Array.isArray(vi.image) ? vi.image : [vi.image];
                for (var vii = 0; vii < vImgs.length; vii++) {
                    if (typeof vImgs[vii] === 'string') imgList.push(vImgs[vii].split('?')[0]);
                }
            }
        }
    }

    // DOM scan: grab every img that points to AJIO's CDN
    var allPageImgs = document.querySelectorAll('img');
    for (var ai = 0; ai < allPageImgs.length; ai++) {
        var imgEl = allPageImgs[ai];
        var srcs = [imgEl.src, imgEl.getAttribute('data-src'), imgEl.getAttribute('data-original'),
                    imgEl.getAttribute('data-lazy'), imgEl.currentSrc];
        for (var si2 = 0; si2 < srcs.length; si2++) {
            var s3 = srcs[si2];
            if (s3 && (s3.includes('assets.ajio.com') || s3.includes('ik.imagekit.io/2gudfl3'))) {
                s3 = s3.split('?')[0];
                if (imgList.indexOf(s3) === -1) imgList.push(s3);
            }
        }
    }

    // Filter out tiny thumbnails and dedupe
    imgList = imgList.filter(function(u) {
        if (!u || u.indexOf('data:') === 0) return false;
        var m = u.match(/-([0-9]+)Wx([0-9]+)H-/i);
        if (m && parseInt(m[1]) < 200) return false;
        return true;
    });

    // Upscale all AJIO images to 1117x1400 (AJIO's largest standard size)
    imgList = imgList.map(function(u) {
        if (u.includes('assets.ajio.com') || u.includes('assets-jiocdn.ajio.com')) {
            return u.replace(/-([0-9]+)Wx([0-9]+)H-/i, '-1117Wx1400H-');
        }
        return u;
    });

    if (imgList.length > 0) {
        // Prepend JSON-LD / CDN images before any others
        var seen2 = {};
        var mergedImgs = [];
        for (var mi = 0; mi < imgList.length; mi++) {
            if (!seen2[imgList[mi]]) { seen2[imgList[mi]] = 1; mergedImgs.push(imgList[mi]); }
        }
        for (var mi2 = 0; mi2 < imgs.length; mi2++) {
            if (!seen2[imgs[mi2]]) { seen2[imgs[mi2]] = 1; mergedImgs.push(imgs[mi2]); }
        }
        imgs = mergedImgs;
        console.log('[FitMe] AJIO images total:', imgs.length);
    }

    // Final fallback: og:image
    if (imgs.length === 0 && ogImage) imgs = [ogImage];

    console.log('[FitMe] AJIO Extracted: title=' + title + ' brand=' + brand + ' price=' + priceAmount + ' imgs=' + imgs.length);

  // ────── Flipkart ──────────────────────────────────────────────────────────
  } else if (host.includes('flipkart.com')) {
    var t = text('.B_NuCI') || text('h1') || text('[class*="G6XhIU"]');
    if (t) title = t;
    var b = text('[class*="G6XhIU"] span') || text('._2WkVRV') || metaProp('og:site_name');
    if (b) brand = b;
    // Flipkart price
    var p = text('._30jeq3._16Jk6d') || text('._30jeq3') ||
            text('[class*="_30jeq3"]') || text('[class*="Nx9bqj"]') ||
            text('[class*="CxhGGd"]');
    if (p) priceAmount = p;
    // Extract 1500x1500 images from JSON-LD (rukmini1.flixcart.com)
    try {
        var fkScripts = document.querySelectorAll('script[type="application/ld+json"]');
        var fkImages = [];
        for (var si = 0; si < fkScripts.length; si++) {
            try {
                var ld = JSON.parse(fkScripts[si].textContent);
                var arr = Array.isArray(ld) ? ld : [ld];
                for (var li = 0; li < arr.length; li++) {
                    var item = arr[li];
                    if (item && item.image) {
                        var imgArr = Array.isArray(item.image) ? item.image : [item.image];
                        for (var ii = 0; ii < imgArr.length; ii++) {
                            var imgUrl = imgArr[ii];
                            if (imgUrl && typeof imgUrl === 'string' && imgUrl.includes('flixcart.com')) {
                                fkImages.push(imgUrl);
                            }
                        }
                    }
                }
            } catch(e) {}
        }
        if (fkImages.length > 0) {
            imgs = fkImages.concat(imgs.filter(function(u) { return !fkImages.includes(u); }));
        }
    } catch(e) {}
    console.log('[FitMe] Flipkart DOM: title=' + title + ' price=' + priceAmount);

  // ────── Nykaa Fashion ─────────────────────────────────────────────────────
  } else if (host.includes('nykaafashion.com') || (host.includes('nykaa.com') && window.location.pathname.indexOf('/fashion/') !== -1)) {
    var t = text('h1') || text('[class*="product-title"]') || text('[class*="ProductTitle"]');
    if (t) title = t;
    var b = text('[class*="brand-name"]') || text('[class*="BrandName"]') || metaProp('og:site_name');
    if (b) brand = b;
    var p = text('[class*="price-container"]') || text('[class*="price-value"]') ||
            text('[class*="selling-price"]') || text('[data-at="price"]');
    if (p) priceAmount = p;
    console.log('[FitMe] Nykaa Fashion DOM: title=' + title + ' price=' + priceAmount);

  // ────── Nykaa (general) ───────────────────────────────────────────────────
  } else if (host.includes('nykaa.com')) {
    var t = text('h1') || text('[class*="product-title"]');
    if (t) title = t;
    var p = text('[class*="price"]') || text('[data-at="price"]') || metaProp('product:price:amount');
    if (p) priceAmount = p;

  // ────── Meesho ────────────────────────────────────────────────────────────
  } else if (host.includes('meesho.com')) {
    var t = text('h1') || text('[class*="ProductTitle"]') || text('[class*="product-title"]');
    if (t) title = t;
    // Meesho renders price dynamically; JSON-LD has it as offers.price
    var p = text('[class*="PriceContainer"]') || text('[class*="price-container"]') ||
            text('[class*="pdp-price"]') || text('[class*="ProductPrice"]') ||
            text('h5') || metaProp('product:price:amount');
    if (p) priceAmount = p;
  } else if (host.includes('zara.com')) {
    var t = text('h1') || text('[class*="product-name"]') || text('[class*="product__name"]');
    if (t) title = t;
    brand = 'Zara';
    // Zara price — JSON-LD is primary; DOM as fallback
    var p = text('[class*="price__amount"]') || text('[class*="money-amount"]') ||
            text('[data-testid="price-current"]') || metaProp('product:price:amount');
    if (p) priceAmount = p;
    console.log('[FitMe] Zara DOM: title=' + title + ' price=' + priceAmount);

  // ────── Generic fallback ──────────────────────────────────────────────────
  } else {
    priceAmount = metaProp('product:price:amount') || metaProp('og:price:amount');
  }

  // ── 6.5 Global Image Upscaling ─────────────────────────────────────────────
  imgs = imgs.filter(function(u) {
      if (!u) return false;
      // AJIO: Filter out tiny thumbnails (Width < 200) because AJIO uses unique path hashes per size.
      if (u.includes('assets.ajio.com') || u.includes('assets-jiocdn.ajio.com')) {
          var m = u.match(/-([0-9]+)Wx[0-9]+H-/i);
          if (m && parseInt(m[1]) < 200) {
              return false;
          }
      }
      return true;
  }).map(function(u) {
      // Amazon high-res (strip resizing suffix)
      if (u.includes('media-amazon.com') || u.includes('images-amazon.com')) {
          return u.replace(/\._[a-zA-Z0-9_,]+_\./, '.');
      }
      // Nykaa / ImageKit: remove path-embedded transform like /tr:h-400,w-300,cm-pad_resize/
      if (u.includes('nykaa.com')) {
          u = u.replace(/\/tr:[^/]+\//g, '/');
          // Upgrade small ?tr=w-NNN to w-800
          u = u.replace(/([?&]tr=(?:[^&]*,)?w-)([0-9]+)/g, function(match, prefix, w) {
              return parseInt(w) < 800 ? prefix + '800' : match;
          });
      }
      // AJIO: replace any "-<width>Wx<height>H-" pattern with a larger size (800x800)
      if (u.includes('assets.ajio.com') || u.includes('assets-jiocdn.ajio.com')) {
          // Strip query parameters first
          u = u.split('?')[0];
          u = u.replace(/-([0-9]+)Wx[0-9]+H-/i, '-800Wx800H-');
      }
      return u;
  });

  // ── 7. Build result ────────────────────────────────────────────────────────
  var __result = {
    title: title,
    brand: brand,
    description: description,
    priceText: priceAmount,
    nextData: nextData,
    jsonLD: jsonLD,
    images: imgs.slice(0, 12)
  };

  console.log('[FitMe] Payload: title=' + title + ' brand=' + brand + ' price=' + priceAmount +
              ' jsonLD=' + jsonLD.length + ' images=' + imgs.length);

  return JSON.stringify(__result);

})();
