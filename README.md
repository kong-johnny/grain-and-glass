# 玻璃暗房 · Grain & Glass

裁切相机照片、调色，并添加毛玻璃边框和可编辑的相机参数水印。图片解码、EXIF 解析、预览和导出均在浏览器内完成。

## 使用

1. 选择或拖入一张 JPG、PNG 或 WebP 照片。页面会读取文件内可识别的 EXIF，自动填写相机品牌和型号、镜头、焦距、光圈、快门、ISO 和拍摄日期。
2. 在 **裁切** 里选择原图比例、1:1、4:5 等比例。用放大滑块调整取景范围，再直接拖动预览里的照片调整构图。聚焦预览后也可用方向键移动。比例只应用于照片主体，成图还会包含边框和水印区。
3. 在 **调色** 里选择预设并调整强度，也可以手动调曝光、对比度、饱和度和冷暖。玻璃边框会随裁切和调色后的照片取色。
4. 选择毛玻璃、白相纸或暗调边框，调整边框宽度、模糊强度和圆角。可以对照原图，也可以编辑或关闭水印。
5. 选择 JPG 或 PNG，然后点击 **下载成图**。默认保留裁切区域的像素尺寸并向外添加边框和水印区，也可限制成图长边为 2048 px。为兼顾移动端，极大图片的成图会缩放到长边不超过 8192 px、总像素不超过 1600 万。

优先使用相机直出的 JPEG。经社交软件转发或二次导出的图片可能已经移除 EXIF，此时可以手动填写。RAW 和 HEIC 可以先转成 JPEG。成图只包含可见水印，原文件的 EXIF（如 GPS 坐标）不会写入导出文件。

## 调色预设

| 预设 | 调整方向 | 适合尝试的场景 |
| --- | --- | --- |
| 低饱和纪实 | 降低饱和度，暗部微冷，提升反差 | 街拍、纪实 |
| 鲜艳风光 | 提高饱和度和反差 | 自然风光、天空、植物 |
| 柔和人像 | 降低反差，稍提曝光 | 人像、柔光场景 |
| 暖调复古 | 柔化明暗，给画面添琥珀色 | 日常、逆光 |
| 冷影暖光 | 暗部偏青，亮部偏暖 | 城市、夜景 |
| 高反差黑白 | 去除色彩，拉开明暗 | 建筑、光影 |

预设为本项目自制，参考富士对不同摄影场景的色调取舍，以及 Lightroom 对暗部、亮部的分区调色。 [富士胶片模拟](https://www.fujifilm-x.com/en-us/products/film-simulation/) · [Lightroom 调色](https://helpx.adobe.com/lightroom/desktop/edit-photos/edit-photos.html)

## 本地运行

在仓库根目录执行 `python3 -m http.server 8765`，然后访问 [本地预览](http://localhost:8765)。

## 部署到 GitHub Pages

1. 将目录内容推送到 GitHub 仓库的 `main` 分支。若使用 GitHub Free，请用公开仓库。
2. 进入仓库的 **Settings → Pages**。
3. 在 **Source** 选择 **Deploy from a branch**，选择 **main** 和 **/ (root)**，保存。
4. 部署完成后可在 Pages 设置里打开站点。普通项目仓库的地址形如 `https://用户名.github.io/仓库名/`。

项目使用静态 HTML、CSS 和 JavaScript，无需安装前端依赖或运行构建命令。资源使用相对路径，可部署到 GitHub Pages 的仓库子目录。 [GitHub Pages 官方说明](https://docs.github.com/en/pages/getting-started-with-github-pages/configuring-a-publishing-source-for-your-github-pages-site)

## 来源

- 示例照片由 Finge Holden 拍摄，使用 Unsplash License。 [照片原页](https://unsplash.com/photos/a-lake-surrounded-by-mountains-and-trees-NwJ-bJk4VRE) · [Unsplash License](https://unsplash.com/license)
- EXIF 解析使用随项目提供的 exifr 7.1.3 Lite（MIT）。 [exifr](https://github.com/MikeKovarik/exifr) · [许可证](assets/vendor/exifr-LICENSE.txt)
- 边框与水印版式参考。 [QiLing Tools](https://qilingtools.com/en/image/camera-frame) · [Lenscript Mark](https://mark.lenscript.cn/en/?style=darkroom)
