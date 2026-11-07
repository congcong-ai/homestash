#!/usr/bin/env python3
"""用 Pillow 生成网页 WebP 和 T5 表情资源，原始 GIF 保持不变。"""
from io import BytesIO
import json
from collections import deque
from pathlib import Path
from PIL import Image, ImageSequence, ImageFilter

ROOT = Path(__file__).resolve().parents[2]
MANIFEST = json.loads((ROOT / "packages/avatar/stickers.json").read_text())
SIZE = 216


def cutout(frame):
    """只移除与图像边界连通的浅色背景，保留眼睛中的白色。"""
    rgb = frame.convert("RGB")
    width, height = rgb.size
    pixels = rgb.load()
    alpha = Image.new("L", rgb.size, 255)
    mask = alpha.load()
    queue = deque()
    # 少数原始 GIF 在前几行/列自带扫描细线，按跨度识别并排除。
    top = 2
    left = 2
    for y in range(10):
        if sum(min(pixels[x, y]) < 180 for x in range(width)) > width // 4:
            top = y + 2
    for x in range(10):
        if sum(min(pixels[x, y]) < 180 for y in range(height)) > height // 4:
            left = x + 2
    for y in range(height):
        for x in range(left):
            mask[x, y] = 0
        for x in (width - 2, width - 1):
            mask[x, y] = 0
    for x in range(width):
        for y in range(top):
            mask[x, y] = 0
        for y in (height - 2, height - 1):
            mask[x, y] = 0
    for x in range(left, width - 2):
        queue.extend(((x, top), (x, height - 3)))
    for y in range(top, height - 2):
        queue.extend(((left, y), (width - 3, y)))
    while queue:
        x, y = queue.popleft()
        if not mask[x, y] or min(pixels[x, y]) < 225:
            continue
        mask[x, y] = 0
        if x > left: queue.append((x - 1, y))
        if x < width - 3: queue.append((x + 1, y))
        if y > top: queue.append((x, y - 1))
        if y < height - 3: queue.append((x, y + 1))
    alpha = alpha.filter(ImageFilter.MinFilter(3)).filter(ImageFilter.GaussianBlur(0.5))
    rgb.putalpha(alpha)
    return rgb


def pack_alpha(alpha):
    values = bytes((value + 42) // 85 * 85 for value in alpha.tobytes())
    result = bytearray()
    index = 0
    while index < len(values):
        end = index + 1
        while end < min(index + 64, len(values)) and values[end] == values[index]:
            end += 1
        result.append(((values[index] // 85) << 6) | (end - index - 1))
        index = end
    return result


def main():
    web = ROOT / "apps/web/public/avatar/stickers"
    device = ROOT / "firmware/boards/tuya-t5-ai/assets"
    web.mkdir(parents=True, exist_ok=True)
    device.mkdir(parents=True, exist_ok=True)
    payload = bytearray()
    clips = []
    max_frames = 0
    for index, name in enumerate(MANIFEST["names"]):
        source = ROOT / "assets/biaoqingbao" / f"{index + 1:02}_{name}.gif"
        with Image.open(source) as gif:
            frames = [
                cutout(frame).resize((320, 320), Image.Resampling.LANCZOS)
                for frame in ImageSequence.Iterator(gif)
            ]
            durations = [frame.info["duration"] for frame in ImageSequence.Iterator(gif)]
        assert len(set(durations)) == 1 and durations[0] > 0, source
        animated_path = web / f"{index}.tmp.webp"
        still_path = web / f"{index}-still.tmp.webp"
        frames[0].save(animated_path, save_all=True, append_images=frames[1:],
                       duration=durations, loop=0, quality=80, method=4)
        frames[0].save(still_path, quality=80, method=4)
        animated_path.replace(web / f"{index}.webp")
        still_path.replace(web / f"{index}-still.webp")
        offsets = []
        for frame in frames[::2]:
            offsets.append(len(payload))
            encoded = BytesIO()
            resized = frame.resize((SIZE, SIZE), Image.Resampling.LANCZOS)
            matte = Image.new("RGB", resized.size, "white")
            matte.paste(resized, mask=resized.getchannel("A"))
            matte.save(
                encoded, format="JPEG", quality=78, subsampling=2, optimize=True
            )
            jpeg = encoded.getvalue()
            payload.extend(len(jpeg).to_bytes(2, "little"))
            payload.extend(jpeg)
            payload.extend(pack_alpha(resized.getchannel("A")))
        max_frames = max(max_frames, len(offsets))
        clips.append(f"    {{{durations[0] * 2}, {len(offsets)}, {{ {', '.join(map(str, offsets))} }}}},")
    header = f"""/* 由 scripts/hardware/avatar-stickers.py 生成。 */
#define HS_STICKER_SIZE {SIZE}
static const struct {{
    unsigned frame_ms, count;
    uint32_t offsets[{max_frames}];
}} sticker_clips[] = {{
{chr(10).join(clips)}
}};
static const uint8_t sticker_by_state[] = {{ {', '.join(map(str, MANIFEST["byState"]))} }};
"""
    (device / "avatar-stickers.bin").write_bytes(payload)
    (device / "avatar-stickers.inc").write_text(header)
    print(f"T5 表情资源共 {len(payload)} 字节")


if __name__ == "__main__":
    main()
