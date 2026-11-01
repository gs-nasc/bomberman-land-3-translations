"""Bundle the engine for the app: src-tauri/binaries/glifo-patcher-<target>[.exe] (Tauri finds a sidecar
by the Rust target triple in its name) plus its runtime folder src-tauri/binaries/glifo-engine/, which
tauri.conf.json installs next to it.
One folder, not --onefile: a one-file build runs as a launcher plus a child process, so cancelling
(which kills the process the app started) would leave the child working, and every run unpacks
itself to a temporary folder that a killed run never removes.

Usage, from the repository root: python desktop/engine/build.py
Needs PyInstaller and Pillow in that Python (pip install pyinstaller pillow). Fonts placed in
desktop/engine/fonts/ (NotoSans-Bold.ttf, NotoSansCJK-Black.ttc) are bundled with it.
"""
import os
import platform
import shutil
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
ROOT = os.path.normpath(os.path.join(HERE, '..', '..'))
BIN_DIR = os.path.join(HERE, '..', 'src-tauri', 'binaries')
WORK = os.path.join(HERE, 'build')


def target_triple():
    try:
        out = subprocess.run(['rustc', '-vV'], capture_output=True, text=True, check=True).stdout
        return next(l.split(': ', 1)[1] for l in out.splitlines() if l.startswith('host: '))
    except (OSError, subprocess.CalledProcessError, StopIteration):
        arch = {'amd64': 'x86_64', 'x86_64': 'x86_64', 'arm64': 'aarch64', 'aarch64': 'aarch64'}[platform.machine().lower()]
        return {'win32': f'{arch}-pc-windows-msvc', 'darwin': f'{arch}-apple-darwin'}.get(sys.platform, f'{arch}-unknown-linux-gnu')


def main():
    sep = ';' if os.name == 'nt' else ':'
    args = [sys.executable, '-m', 'PyInstaller', '--noconfirm', '--clean', '--onedir', '--contents-directory', 'glifo-engine', '--console',
            '--name', 'glifo-patcher', '--distpath', os.path.join(WORK, 'dist'), '--workpath', os.path.join(WORK, 'work'),
            '--specpath', WORK, '--paths', os.path.join(ROOT, 'tools'), '--paths', HERE,
            '--collect-submodules', 'patchers', '--exclude-module', 'capstone', '--exclude-module', 'tkinter']
    fonts = os.path.join(HERE, 'fonts')
    if os.path.isdir(fonts) and os.listdir(fonts):
        args += ['--add-data', f'{fonts}{sep}fonts']
    else:
        print('aviso: desktop/engine/fonts/ vazia; o app vai usar as fontes do sistema')
    subprocess.run(args + [os.path.join(HERE, 'glifo_patcher.py')], check=True)
    exe = '.exe' if os.name == 'nt' else ''
    os.makedirs(BIN_DIR, exist_ok=True)
    dst = os.path.join(BIN_DIR, f'glifo-patcher-{target_triple()}{exe}')
    dist = os.path.join(WORK, 'dist', 'glifo-patcher')
    shutil.copyfile(os.path.join(dist, f'glifo-patcher{exe}'), dst)
    shutil.rmtree(os.path.join(BIN_DIR, 'glifo-engine'), ignore_errors=True)
    shutil.copytree(os.path.join(dist, 'glifo-engine'), os.path.join(BIN_DIR, 'glifo-engine'))
    print(f'-> {os.path.normpath(dst)}')


if __name__ == '__main__':
    main()
