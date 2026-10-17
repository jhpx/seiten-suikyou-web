#!/usr/bin/env python3
"""
把本仓库（前端）导出一个可以直接推给静态托管（GitHub Pages / 对象存储 / nginx）的目录。

为什么需要这一步：前端零构建，「导出」不打包、不编译，就是复制文件 ——
唯一必须改的东西是接口地址：单独托管时页面和后端不同源，要把后端地址写进
env.js 的 API_BASE，前端 core.js 从那里 import（留空 = 同源）。
后端那边对应加 --cors-origin=<前端地址>，否则浏览器拦掉跨域请求。

本仓库根目录就是前端本身（index.html / *.js / *.css / assets/），导出即从中摘文件。

用法：
    python tools/export_pages.py --api-base https://gs.example.com
    python tools/export_pages.py --out dist/pages               # 不带后端地址，同源或稍后手改
    python tools/export_pages.py --no-assets                   # 跳过 101MB 素材，只导代码（调试用）
    python tools/export_pages.py --out dist/pages --force       # 目标已存在时先清空
"""
import argparse
import pathlib
import shutil
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
# 只认这三种扩展名：仓库根目录还有 README.md / tools/ 之类不该进发布目录的东西
CODE_EXTS = {".html", ".js", ".css"}
# 行首锚定（(?m)^）：env.js 头注释里有行可拷贝的示例 export const API_BASE = '...'，
# 不锚的话替换会命中注释里的示例而不是真正的导出行（静默不生效）
ENV_RE = r"(?m)^(export\s+const\s+API_BASE\s*=\s*['\"])[^'\"]*(['\"])"


def human (n: float) -> str:
    for unit in ("B", "KB", "MB", "GB"):
        if n < 1024 or unit == "GB":
            return f"{n:.0f} {unit}" if unit == "B" else f"{n:.1f} {unit}"
        n /= 1024
    return f"{n:.1f} GB"


def copy_code (out: pathlib.Path) -> int:
    """复制页面代码（.html/.js/.css），按扩展名过滤，跳过目录。"""
    n = 0
    for item in ROOT.iterdir():
        if item.is_file() and item.suffix.lower() in CODE_EXTS:
            target = out / item.name
            if not target.exists() or target.read_bytes() != item.read_bytes():
                shutil.copy2(item, target)
            n += 1
    return n


def copy_assets (out: pathlib.Path) -> int:
    """素材全量复制（约 101MB / 1900+ 个文件）。已存在就增量覆盖。"""
    shutil.copytree(ROOT / "assets", out / "assets", dirs_exist_ok=True)
    return sum(1 for _ in (out / "assets").rglob("*") if _.is_file())


def set_api_base (out: pathlib.Path, base: str) -> bool:
    """把 env.js 里 API_BASE 的值改成后端地址。找不到那行就报 False。"""
    import re
    env = out / "env.js"
    text = env.read_text(encoding="utf-8")
    new, n = re.subn(ENV_RE, lambda m: m.group(1) + base + m.group(2), text, count=1)
    if n != 1:
        return False
    env.write_text(new, encoding="utf-8")
    return True


def main () -> int:
    ap = argparse.ArgumentParser(description="导出可静态托管的前端目录")
    ap.add_argument("--out", default="dist/pages", help="输出目录（默认 dist/pages）")
    ap.add_argument("--api-base", default="", help="后端地址，如 https://gs.example.com（留空 = 同源）")
    ap.add_argument("--no-assets", action="store_true", help="不复制图片素材（只导代码）")
    ap.add_argument("--force", action="store_true", help="输出目录已存在时先清空")
    args = ap.parse_args()

    out = (ROOT / args.out) if not pathlib.Path(args.out).is_absolute() else pathlib.Path(args.out)
    if out.exists() and any(out.iterdir()):
        if not args.force:
            print(f"[ERR] 目标目录非空：{out}\n      确认要覆盖就加 --force")
            return 1
        shutil.rmtree(out)
    out.mkdir(parents=True, exist_ok=True)

    code = copy_code(out)
    assets = 0 if args.no_assets else copy_assets(out)
    if args.api_base:
        if not set_api_base(out, args.api_base):
            print("[ERR] env.js 里没找到 export const API_BASE，后端地址没写进去")
            return 1

    total = sum(f.stat().st_size for f in out.rglob("*") if f.is_file())
    print(f"已导出 → {out}")
    print(f"  页面代码 {code} 个文件 · 图片素材 {assets} 个文件 · 合计 {human(total)}")
    print(f"  接口地址 {args.api_base or '(留空 = 同源)'}")
    print("后端对应地要加：npm run server -- --cors-origin=<前端地址>")
    return 0


if __name__ == "__main__":
    sys.exit(main())
