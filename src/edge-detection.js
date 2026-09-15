/**
 * Sobel edge detection pipeline — turn a photo into printable black-and-white line art.
 *
 * Pipeline:  toGrayscale -> gaussianBlur -> sobelEdge -> dilate -> removeNoise
 *
 * All functions are pure and operate on flat typed arrays: no DOM, no canvas,
 * no network, no dependencies. Runs in browsers and in Node.js.
 *
 * Extracted from the production tool at https://coloringzap.com
 * (photo -> line art / "turn photo into coloring page").
 */

/**
 * Convert RGBA bytes to grayscale using Rec. 601 luma.
 * @param {Uint8ClampedArray|Uint8Array} rgba RGBA, length = width*height*4
 * @returns {Float32Array} grayscale, length = width*height
 */
export function toGrayscale(rgba, width, height) {
  const gray = new Float32Array(width * height);
  for (let i = 0; i < width * height; i++) {
    gray[i] = 0.299 * rgba[i * 4] + 0.587 * rgba[i * 4 + 1] + 0.114 * rgba[i * 4 + 2];
  }
  return gray;
}

/**
 * Separable Gaussian blur (horizontal + vertical pass).
 * @param {Float32Array} gray
 * @param {number} radius kernel radius (>=0); 0 effectively disables blur
 * @returns {Float32Array} blurred grayscale
 */
export function gaussianBlur(gray, width, height, radius) {
  const sigma = radius * 0.8 + 0.5;
  const kernelSize = radius * 2 + 1;
  const kernel = new Float32Array(kernelSize);
  let sum = 0;
  for (let i = 0; i < kernelSize; i++) {
    const x = i - radius;
    kernel[i] = Math.exp(-(x * x) / (2 * sigma * sigma));
    sum += kernel[i];
  }
  for (let i = 0; i < kernelSize; i++) kernel[i] /= sum;

  const temp = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let k = 0; k < kernelSize; k++) {
        let px = x + k - radius;
        if (px < 0) px = 0;
        if (px >= width) px = width - 1;
        acc += gray[y * width + px] * kernel[k];
      }
      temp[y * width + x] = acc;
    }
  }

  const result = new Float32Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      let acc = 0;
      for (let k = 0; k < kernelSize; k++) {
        let py = y + k - radius;
        if (py < 0) py = 0;
        if (py >= height) py = height - 1;
        acc += temp[py * width + x] * kernel[k];
      }
      result[y * width + x] = acc;
    }
  }
  return result;
}

/**
 * Sobel edge detection with a magnitude threshold.
 * @param {Float32Array} gray  (usually the blurred grayscale)
 * @param {number} threshold gradient magnitude cutoff — higher = fewer, cleaner lines
 * @returns {Uint8Array} 255 = edge (black line), 0 = background (white paper)
 */
export function sobelEdge(gray, width, height, threshold) {
  const edges = new Uint8Array(width * height);
  const gx = [-1, 0, 1, -2, 0, 2, -1, 0, 1];
  const gy = [-1, -2, -1, 0, 0, 0, 1, 2, 1];

  for (let y = 1; y < height - 1; y++) {
    for (let x = 1; x < width - 1; x++) {
      let sumX = 0, sumY = 0, idx = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const px = gray[(y + dy) * width + (x + dx)];
          sumX += px * gx[idx];
          sumY += px * gy[idx];
          idx++;
        }
      }
      const mag = Math.sqrt(sumX * sumX + sumY * sumY);
      if (mag > threshold) edges[y * width + x] = 255;
    }
  }
  return edges;
}

/**
 * Morphological dilation — thickens lines so they survive printing.
 * @param {Uint8Array} edges
 * @param {number} iterations 0 = no-op
 */
export function dilate(edges, width, height, iterations) {
  let current = edges;
  for (let iter = 0; iter < iterations; iter++) {
    const next = new Uint8Array(width * height);
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const idx = y * width + x;
        if (current[idx] === 255) { next[idx] = 255; continue; }
        let found = false;
        for (let dy = -1; dy <= 1 && !found; dy++) {
          for (let dx = -1; dx <= 1 && !found; dx++) {
            const nx = x + dx, ny = y + dy;
            if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
              if (current[ny * width + nx] === 255) found = true;
            }
          }
        }
        next[idx] = found ? 255 : 0;
      }
    }
    current = next;
  }
  return current;
}

/**
 * Drop isolated edge pixels (an edge pixel with no edge neighbour is noise).
 */
export function removeNoise(edges, width, height) {
  const cleaned = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const idx = y * width + x;
      if (edges[idx] !== 255) continue;
      let count = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (dx === 0 && dy === 0) continue;
          const nx = x + dx, ny = y + dy;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height) {
            if (edges[ny * width + nx] === 255) count++;
          }
        }
      }
      cleaned[idx] = count > 0 ? 255 : 0;
    }
  }
  return cleaned;
}

/**
 * Convenience: run the whole pipeline.
 * @returns {Uint8Array} 255 = line, 0 = paper
 */
export function photoToLineArt(rgba, width, height, opts = {}) {
  const { blurRadius = 2, threshold = 40, dilateIterations = 1, denoise = true } = opts;
  let gray = toGrayscale(rgba, width, height);
  if (blurRadius > 0) gray = gaussianBlur(gray, width, height, blurRadius);
  let edges = sobelEdge(gray, width, height, threshold);
  if (dilateIterations > 0) edges = dilate(edges, width, height, dilateIterations);
  if (denoise) edges = removeNoise(edges, width, height);
  return edges;
}
