"""从共享主题定义生成有界固件常量；不包含外部资源或脚本。"""
import json
from pathlib import Path
root = Path(__file__).resolve().parents[2]
themes = json.loads((root / 'packages/avatar/themes.json').read_text())
assert len(themes) == 4
header = '/* 由 packages/avatar/themes.json 生成，请同步运行 scripts/hardware/avatar-themes.py。 */\n#pragma once\ntypedef struct { unsigned body,ink,accent; int radius,eye_width,eye_height; } hs_avatar_theme_t;\nstatic const hs_avatar_theme_t avatar_themes[]={\n'
for theme in themes:
    header += ' {0x%s,0x%s,0x%s,%d,%d,%d},\n' % tuple(theme[k] for k in ('body','ink','accent','radius','eyeWidth','eyeHeight'))
header += '};\n'
(root / 'firmware/boards/tuya-t5-ai/include/hs_avatar_themes.h').write_text(header)
