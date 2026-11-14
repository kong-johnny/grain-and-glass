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
    margin: Number(margin.value) / 100,
    blur: Number(blur.value) / 100,
    radius: Number(radius.value) / 100,
    lines: watermark.checked ? fields.map((id) => byId(id).value.trim()).filter(Boolean) : [],
  };
}

function layout(image, settings) {
  const width = image.naturalWidth;
  const height = image.naturalHeight;
  const short = Math.min(width, height);
  const border = short * settings.margin;
  const type = short * 0.027;
  const textHeight = settings.lines.length ? type * (settings.lines.length * 1.23 + 0.55) : 0;
  return { width, height, border, type, textHeight };
}

function fitScale(width, height, maxSide) {
  return Math.min(1, maxSide / Math.max(width, height), Math.sqrt(MAX_PIXELS / (width * height)));
}

function cover(ctx, image, width, height, extra = 0) {
  const scale = Math.max((width + extra) / image.naturalWidth, (height + extra) / image.naturalHeight);
  const w = image.naturalWidth * scale;
  const h = image.naturalHeight * scale;
  ctx.drawImage(image, (width - w) / 2, (height - h) / 2, w, h);
}

function background(ctx, image, width, height, settings) {
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
  cover(smallCtx, image, soft.width, soft.height, 6 * amount);
  ctx.drawImage(soft, 0, 0, width, height);

  const glaze = ctx.createLinearGradient(0, 0, 0, height);
  glaze.addColorStop(0, night ? "#0a1118a8" : "#e7f1ec40");
  glaze.addColorStop(1, night ? "#070b12ee" : "#101e19db");
  ctx.fillStyle = glaze;
  ctx.fillRect(0, 0, width, height);
}

function render(canvas, image, settings, maxSide, showOriginal = false) {
  const source = layout(image, settings);
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

  ctx.scale(canvas.width / width, canvas.height / height);
  ctx.imageSmoothingQuality = "high";
  background(ctx, image, width, height, settings);
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
  ctx.drawImage(image, border, border, source.width, source.height);
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

function refresh() {
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
    render(preview, photo, settings, 1400, original);
    byId("stage-message").hidden = true;
    preview.hidden = false;
    const { width, height, border, textHeight } = layout(photo, settings);
    const w = original ? width : width + 2 * border;
    const h = original ? height : height + 2 * border + textHeight;
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

    const { width, height, border, textHeight } = layout(source, settings);
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
