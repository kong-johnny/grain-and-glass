"use strict";

const byId = (id) => document.getElementById(id);
const preview = byId("preview");
const fileInput = byId("file");
const compare = byId("compare");
const download = byId("download");
const margin = byId("margin");
const blur = byId("blur");
const radius = byId("radius");
const watermark = byId("watermark");
const fields = ["camera", "lens", "parameters", "caption"];
const presets = {
  glass: { margin: 8, blur: 62, radius: 2 },
  paper: { margin: 6, blur: 0, radius: 0 },
  night: { margin: 9, blur: 75, radius: 2 },
};
const cropDefaults = { "crop-ratio": "free", "crop-zoom": 100, "crop-x": 50, "crop-y": 50 };
const gradeDefaults = { grade: "none", "grade-strength": 100, exposure: 0, contrast: 0, saturation: 0, warmth: 0 };
const grades = {
  none: { hint: "保持照片原有色调。" },
  chrome: { hint: "压低饱和度，暗部略偏冷，适合街拍与纪实。", saturation: -0.27, contrast: 0.14, shadows: -0.13, highlights: 0.03 },
  vivid: { hint: "加强色彩与反差，适合山水、天空和植物。", saturation: 0.32, contrast: 0.15 },
  portrait: { hint: "柔化反差，稍提中间调，适合人像。", exposure: 0.15, saturation: -0.12, contrast: -0.15, highlights: 0.07 },
  amber: { hint: "抬起暗部，添一点琥珀色，适合日常和逆光。", saturation: -0.16, contrast: -0.18, shadows: 0.10, highlights: 0.22 },
  cinema: { hint: "暗部偏青，亮部偏暖，适合城市与夜景。", saturation: -0.14, contrast: 0.13, shadows: -0.29, highlights: 0.19 },
  mono: { hint: "去掉色彩并拉开明暗，适合光影和建筑。", saturation: -1, contrast: 0.25 },
};
// Bound allocation for browsers with low Canvas area limits.
const MAX_PIXELS = 16_000_000;
const MAX_SIDE = 8192;

let photo;
let filename = "示例照片";
let original = false;
let loadRequest = 0;
let loading = false;
let exporting = false;
let previewRequest;

function notify(message, error = false) {
  const status = byId("status");
  status.textContent = message;
  status.classList.toggle("error", error);
}

function selectedPreset() {
  return document.querySelector('input[name="preset"]:checked').value;
}

function options() {
  return {
    preset: selectedPreset(),
    cropRatio: byId("crop-ratio").value,
    zoom: Number(byId("crop-zoom").value) / 100,
    cropX: Number(byId("crop-x").value) / 100,
    cropY: Number(byId("crop-y").value) / 100,
    grade: colorSettings(),
    margin: Number(margin.value) / 100,
    blur: Number(blur.value) / 100,
    radius: Number(radius.value) / 100,
    lines: watermark.checked ? fields.map((id) => byId(id).value.trim()).filter(Boolean) : [],
  };
}

function cropBox(image, settings) {
  const fullWidth = image.naturalWidth;
  const fullHeight = image.naturalHeight;
  const [ratioWidth, ratioHeight] = settings.cropRatio === "free"
    ? [fullWidth, fullHeight]
    : settings.cropRatio.split(":").map(Number);
  const ratio = ratioWidth / ratioHeight;
  const width = Math.max(1, Math.round(Math.min(fullWidth, fullHeight * ratio) / settings.zoom));
  const height = Math.max(1, Math.round(Math.min(fullHeight, fullWidth / ratio) / settings.zoom));
  return {
    width, height,
    x: Math.round((fullWidth - width) * settings.cropX),
    y: Math.round((fullHeight - height) * settings.cropY),
  };
}

function colorSettings() {
  const preset = grades[byId("grade").value];
  const strength = Number(byId("grade-strength").value) / 100;
  return {
    exposure: Number(byId("exposure").value) + (preset.exposure || 0) * strength,
    contrast: Number(byId("contrast").value) / 100 + (preset.contrast || 0) * strength,
    saturation: Math.max(-1, Number(byId("saturation").value) / 100 + (preset.saturation || 0) * strength),
    warmth: Number(byId("warmth").value) / 100,
    shadows: (preset.shadows || 0) * strength,
    highlights: (preset.highlights || 0) * strength,
  };
}

function gradePixels(ctx, width, height, grade) {
  const exposure = 2 ** grade.exposure;
  const saturation = 1 + grade.saturation;
  const tone = Float32Array.from({ length: 256 }, (_, value) => {
    const level = value / 255;
    const linear = level <= 0.04045 ? level / 12.92 : ((level + 0.055) / 1.055) ** 2.4;
    const adjusted = Math.min(1, linear * exposure);
    const exposed = adjusted <= 0.0031308 ? adjusted * 12.92 : 1.055 * adjusted ** (1 / 2.4) - 0.055;
    return 255 * (exposed + grade.contrast * (exposed - 0.5) * (1 - 4 * (exposed - 0.5) ** 2) * 2);
  });
  const tint = Float32Array.from({ length: 256 }, (_, value) => {
    const level = value / 255;
    return 90 * (grade.warmth * 4 * level * (1 - level)
      + grade.shadows * (1 - level) ** 2 + grade.highlights * level ** 2);
  });
  // Process strips to bound pixel readback memory on mobile.
  for (let y = 0; y < height; y += 128) {
    const strip = ctx.getImageData(0, y, width, Math.min(128, height - y));
    const pixels = strip.data;
    for (let i = 0; i < pixels.length; i += 4) {
      const r = tone[pixels[i]];
      const g = tone[pixels[i + 1]];
      const b = tone[pixels[i + 2]];
      const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
      const shift = tint[Math.round(luma)];
      pixels[i] = luma + (r - luma) * saturation + shift;
      pixels[i + 1] = luma + (g - luma) * saturation - shift * 0.18;
      pixels[i + 2] = luma + (b - luma) * saturation - shift;
    }
    ctx.putImageData(strip, 0, y);
  }
}

function layout(crop, settings) {
  const { width, height } = crop;
  const short = Math.min(width, height);
  const border = Math.round(short * settings.margin);
  const type = short * 0.027;
  const textHeight = settings.lines.length ? type * (settings.lines.length * 1.23 + 0.55) : 0;
  return { width, height, border, type, textHeight };
}

function fitScale(width, height, maxSide) {
  return Math.min(1, maxSide / Math.max(width, height), Math.sqrt(MAX_PIXELS / (width * height)));
}

function cover(ctx, image, crop, width, height, extra = 0) {
  const scale = Math.max((width + extra) / crop.width, (height + extra) / crop.height);
  const w = crop.width * scale;
  const h = crop.height * scale;
  ctx.drawImage(image, crop.x, crop.y, crop.width, crop.height, (width - w) / 2, (height - h) / 2, w, h);
}

function background(ctx, image, crop, width, height, settings) {
  const paper = settings.preset === "paper";
  const night = settings.preset === "night";
  ctx.fillStyle = paper ? "#f6f3ec" : "#17231d";
  ctx.fillRect(0, 0, width, height);
  if (paper) return;

  // Blur a small copy so the effect costs about the same at every export size.
  // Resampling also gives browsers without Canvas filters a soft fallback.
  const sw = Math.max(1, Math.round(width * 360 / Math.max(width, height)));
  const sh = Math.max(1, Math.round(height * 360 / Math.max(width, height)));
  const soft = document.createElement("canvas");
  const supportsFilter = "filter" in soft.getContext("2d");
  const reduction = supportsFilter ? 1 : 1 + settings.blur * 22;
  soft.width = Math.max(1, Math.round(sw / reduction));
  soft.height = Math.max(1, Math.round(sh / reduction));
  const smallCtx = soft.getContext("2d");
  const amount = Math.min(soft.width, soft.height) * settings.blur * 0.105;
  if (supportsFilter) smallCtx.filter = `blur(${amount}px)`;
  cover(smallCtx, image, crop, soft.width, soft.height, 6 * amount);
  ctx.drawImage(soft, 0, 0, width, height);

  const glaze = ctx.createLinearGradient(0, 0, 0, height);
  glaze.addColorStop(0, night ? "#0a1118a8" : "#e7f1ec40");
  glaze.addColorStop(1, night ? "#070b12ee" : "#101e19db");
  ctx.fillStyle = glaze;
  ctx.fillRect(0, 0, width, height);
}

function render(canvas, image, settings, maxSide, showOriginal = false) {
  const crop = cropBox(image, settings);
  const source = showOriginal
    ? { width: image.naturalWidth, height: image.naturalHeight }
    : layout(crop, settings);
  const width = source.width + (showOriginal ? 0 : 2 * source.border);
  const height = source.height + (showOriginal ? 0 : 2 * source.border + source.textHeight);
  const scale = fitScale(width, height, maxSide);
  canvas.width = Math.max(1, Math.floor(width * scale));
  canvas.height = Math.max(1, Math.floor(height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) throw new Error("Canvas unavailable");
  if (showOriginal) {
    ctx.drawImage(image, 0, 0, canvas.width, canvas.height);
    return;
  }

  let foreground = image;
  let region = crop;
  if (Object.values(settings.grade).some(Boolean)) {
    foreground = document.createElement("canvas");
    foreground.width = Math.max(1, Math.round(crop.width * scale));
    foreground.height = Math.max(1, Math.round(crop.height * scale));
    const pixels = foreground.getContext("2d", { willReadFrequently: true });
    pixels.imageSmoothingQuality = "high";
    pixels.drawImage(image, crop.x, crop.y, crop.width, crop.height, 0, 0, foreground.width, foreground.height);
    gradePixels(pixels, foreground.width, foreground.height, settings.grade);
    region = { x: 0, y: 0, width: foreground.width, height: foreground.height };
  }
  ctx.scale(canvas.width / width, canvas.height / height);
  ctx.imageSmoothingQuality = "high";
  background(ctx, foreground, region, width, height, settings);
  const { border, type } = source;
  const rounding = Math.min(source.width, source.height) * settings.radius;
  ctx.beginPath();
  ctx.roundRect(border, border, source.width, source.height, rounding);
  ctx.save();
  ctx.shadowColor = settings.preset === "paper" ? "#24281a2b" : "#060c0a9e";
  ctx.shadowBlur = border * scale * 0.45;
  ctx.shadowOffsetY = border * scale * 0.15;
  ctx.fillStyle = settings.preset === "paper" ? "#fff" : "#212822";
  ctx.fill();
  ctx.shadowColor = "transparent";
  ctx.clip();
  ctx.drawImage(foreground, region.x, region.y, region.width, region.height,
    border, border, source.width, source.height);
  if (foreground !== image) foreground.width = 1;
  ctx.restore();
  if (settings.preset !== "paper") {
    ctx.strokeStyle = "#ffffff62";
    ctx.lineWidth = type * 0.048;
    ctx.stroke();
  }

  ctx.textBaseline = "middle";
  settings.lines.forEach((line, index) => {
    const main = index === 0;
    ctx.fillStyle = settings.preset === "paper"
      ? (main ? "#252925" : "#494f47")
      : (main ? "#ffffff" : "#ecf1ea");
    ctx.font = `${main ? 650 : 450} ${type * (main ? 1.13 : 0.83)}px system-ui, sans-serif`;
    ctx.letterSpacing = main ? "0px" : `${type * 0.035}px`;
    ctx.fillText(line, border, border + source.height + type * (1.22 + index * 1.23), source.width);
  });
}

function outputLimit() {
  return byId("size").value === "original" ? MAX_SIDE : Number(byId("size").value);
}

function resetControls(defaults) {
  Object.entries(defaults).forEach(([id, value]) => { byId(id).value = value; });
}

function refresh() {
  byId("crop-zoom-value").value = `${byId("crop-zoom").value}%`;
  byId("grade-strength-value").value = `${byId("grade-strength").value}%`;
  byId("grade-strength").disabled = byId("grade").value === "none";
  byId("grade-hint").textContent = grades[byId("grade").value].hint;
  for (const id of ["exposure", "contrast", "saturation", "warmth"]) {
    const value = byId(id).value;
    byId(`${id}-value`).value = `${value > 0 ? "+" : ""}${value}${id === "exposure" ? " EV" : ""}`;
  }
  byId("margin-value").value = `${margin.value}%`;
  byId("blur-value").value = `${blur.value}%`;
  byId("radius-value").value = `${radius.value}%`;
  blur.disabled = selectedPreset() === "paper";
  byId("watermark-fields").hidden = !watermark.checked;
  compare.disabled = !photo || loading;
  download.disabled = !photo || loading || exporting;
  compare.setAttribute("aria-pressed", String(original));
  compare.querySelector("span").textContent = original ? "查看成图" : "查看原图";
  if (!photo) return;

  cancelAnimationFrame(previewRequest);
  previewRequest = requestAnimationFrame(() => {
    const settings = options();
    const crop = cropBox(photo, settings);
    byId("crop-x").disabled = crop.width === photo.naturalWidth;
    byId("crop-y").disabled = crop.height === photo.naturalHeight;
    render(preview, photo, settings, 1400, original);
    byId("stage-message").hidden = true;
    preview.hidden = false;
    const { width, height, border, textHeight } = layout(crop, settings);
    const w = original ? photo.naturalWidth : width + 2 * border;
    const h = original ? photo.naturalHeight : height + 2 * border + textHeight;
    const scale = original ? 1 : fitScale(w, h, outputLimit());
    byId("dimensions").textContent = `${original ? "原图" : "导出"} ${Math.max(1, Math.floor(w * scale))} × ${Math.max(1, Math.floor(h * scale))} px`;
  });
}

function applyPreset() {
  const settings = presets[selectedPreset()];
  margin.value = settings.margin;
  blur.value = settings.blur;
  radius.value = settings.radius;
  refresh();
}

function clean(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function displayNumber(value, digits = 2) {
  return Number(value.toFixed(digits)).toString();
}

async function readExif(file) {
  const tags = await window.exifr.parse(file) || {};
  const make = clean(tags.Make);
  const model = clean(tags.Model);
  const distinctMake = make && !model.toLowerCase().startsWith(make.toLowerCase());
  const camera = [distinctMake ? make : "", model].filter(Boolean).join(" ");
  const lens = clean(tags.LensModel || tags.Lens);
  const focal = positiveNumber(tags.FocalLength);
  const aperture = positiveNumber(tags.FNumber);
  const shutter = positiveNumber(tags.ExposureTime);
  const iso = positiveNumber(tags.ISO || tags.PhotographicSensitivity);
  const printedShutter = shutter > 0 && shutter <= 0.25
    ? `1/${Math.round(1 / shutter)}`
    : displayNumber(shutter, 4);
  const parameters = [
    focal && `${displayNumber(focal)} mm`,
    aperture && `ƒ/${displayNumber(aperture)}`,
    shutter && `${printedShutter} s`,
    iso && `ISO ${iso}`,
  ].filter(Boolean).join("   ·   ");
  const date = tags.DateTimeOriginal || tags.CreateDate;
  const caption = date instanceof Date && Number.isFinite(date.getTime())
    ? [date.getFullYear(), date.getMonth() + 1, date.getDate()].map((n) => String(n).padStart(2, "0")).join(".")
    : clean(date).match(/^\d{4}[:.-]\d{2}[:.-]\d{2}/)?.[0].replace(/[:-]/g, ".") || "";
  return { camera, lens, parameters, caption };
}

async function loadPhoto(file) {
  const request = ++loadRequest;
  loading = true;
  refresh();
  notify("正在读取照片…");
  const objectUrl = file ? URL.createObjectURL(file) : null;
  try {
    const image = new Image();
    image.src = objectUrl || "./assets/sample.jpg";
    const [_, metadata] = await Promise.all([
      image.decode(),
      file ? readExif(file).catch(() => ({})) : {
        camera: "DJI FC3582",
        lens: "",
        parameters: "",
        caption: "Lago di Braies",
      },
    ]);
    if (request !== loadRequest) return;

    photo = image;
    resetControls(cropDefaults);
    filename = file ? file.name : "示例照片";
    original = false;
    fields.forEach((id) => {
      const field = byId(id);
      field.value = (metadata[id] || "").slice(0, field.maxLength);
    });
    const found = Object.values(metadata).some(Boolean);
    byId("metadata").textContent = file
      ? (found ? "已填写可识别的 EXIF 信息，可手动编辑。" : "未读取到相机 EXIF，可手动填写。")
      : "示例水印可直接编辑。";
    byId("source").textContent = filename;
    byId("source").title = filename;
    notify(file ? "照片已载入" : "");
  } catch {
    if (request !== loadRequest) return;
    if (!photo) byId("stage-message").textContent = "请选择一张照片开始编辑。";
    notify(file ? "无法打开此照片，请选择有效的 JPG、PNG 或 WebP 文件。" : "示例照片加载失败，请打开自己的照片。", true);
  } finally {
    if (objectUrl) URL.revokeObjectURL(objectUrl);
    if (request === loadRequest) {
      loading = false;
      refresh();
    }
  }
}

async function exportPhoto() {
  if (!photo || loading || exporting) return;
  const settings = options();
  const source = photo;
  const name = filename;
  const format = byId("format").value;
  const limit = outputLimit();
  const keepSource = byId("size").value === "original";
  const mime = `image/${format}`;
  const canvas = document.createElement("canvas");
  exporting = true;
  download.disabled = true;
  notify("正在生成成图…");
  try {
    await new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
    render(canvas, source, settings, limit);
    const blob = await new Promise((resolve) => canvas.toBlob(resolve, mime, 0.95));
    if (!blob || blob.type !== mime) throw new Error("Image encoding failed");
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${name.replace(/\.[^.]+$/, "")}-glass.${format === "jpeg" ? "jpg" : "png"}`;
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30_000);

    const { width, height, border, textHeight } = layout(cropBox(source, settings), settings);
    const scaled = keepSource && fitScale(width + 2 * border, height + 2 * border + textHeight, limit) < 1;
    notify(scaled ? "已生成下载。超大照片已缩小至浏览器可导出的尺寸。" : "已生成下载。");
  } catch {
    notify("导出失败，请试试限制成图长边为 2048 px。", true);
  } finally {
    canvas.width = 1;
    canvas.height = 1;
    exporting = false;
    refresh();
  }
}

byId("upload").addEventListener("click", () => fileInput.click());
fileInput.addEventListener("change", () => {
  if (fileInput.files[0]) loadPhoto(fileInput.files[0]);
  fileInput.value = "";
});
window.addEventListener("dragover", (event) => {
  if (!event.dataTransfer.types.includes("Files")) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = "copy";
  document.body.classList.add("dragging");
});
window.addEventListener("dragleave", (event) => {
  if (!event.relatedTarget) document.body.classList.remove("dragging");
});
window.addEventListener("drop", (event) => {
  if (!event.dataTransfer.types.includes("Files")) return;
  event.preventDefault();
  document.body.classList.remove("dragging");
  if (event.dataTransfer.files[0]) loadPhoto(event.dataTransfer.files[0]);
});

document.querySelectorAll('input[name="preset"]').forEach((input) => input.addEventListener("change", applyPreset));
[margin, blur, radius, watermark, byId("size"), ...fields.map(byId)].forEach((element) => {
  element.addEventListener("input", refresh);
});
function editPhoto() {
  original = false;
  refresh();
}

for (const id of [...Object.keys(cropDefaults), ...Object.keys(gradeDefaults)]) {
  byId(id).addEventListener("input", editPhoto);
}
byId("crop-reset").addEventListener("click", () => {
  resetControls(cropDefaults);
  editPhoto();
});
byId("grade-reset").addEventListener("click", () => {
  resetControls(gradeDefaults);
  editPhoto();
});
byId("reset").addEventListener("click", () => {
  document.querySelector('input[value="glass"]').checked = true;
  applyPreset();
});
compare.addEventListener("click", () => {
  original = !original;
  refresh();
});
download.addEventListener("click", exportPhoto);

refresh();
loadPhoto();
