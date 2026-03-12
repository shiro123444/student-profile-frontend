# -*- mode: python ; coding: utf-8 -*-
# KiroProxy PyInstaller spec file
# This provides complete control over module collection

import sys
from pathlib import Path

block_cipher = None

# Get the source directory
src_path = Path('.').resolve()

# Explicitly list all Python modules to include
all_modules = [
    'kiro_proxy',
    'kiro_proxy.main',
    'kiro_proxy.config',
    'kiro_proxy.converters',
    'kiro_proxy.launcher',
    'kiro_proxy.cli',
    'kiro_proxy.web',
    'kiro_proxy.web.webui',
    'kiro_proxy.web.i18n',
    'kiro_proxy.core',
    'kiro_proxy.core.account',
    'kiro_proxy.core.state',
    'kiro_proxy.core.persistence',
    'kiro_proxy.core.scheduler',
    'kiro_proxy.core.stats',
    'kiro_proxy.core.retry',
    'kiro_proxy.core.browser',
    'kiro_proxy.core.flow_monitor',
    'kiro_proxy.core.usage',
    'kiro_proxy.handlers',
    'kiro_proxy.handlers.anthropic',
    'kiro_proxy.handlers.openai',
    'kiro_proxy.handlers.responses',
    'kiro_proxy.handlers.gemini',
    'kiro_proxy.handlers.admin',
    'kiro_proxy.credential',
    'kiro_proxy.credential.types',
    'kiro_proxy.credential.fingerprint',
    'kiro_proxy.credential.quota',
    'kiro_proxy.credential.refresher',
    'kiro_proxy.auth',
    'kiro_proxy.auth.device_flow',
]

# Data files to include
datas = [
    ('assets', 'assets'),
    ('kiro_proxy/docs', 'kiro_proxy/docs'),
    ('kiro_proxy/web/i18n', 'kiro_proxy/web/i18n'),
    ('kiro_proxy/web/webui.py', 'kiro_proxy/web'),
]

# Hidden imports for dependencies
hiddenimports = [
    'uvicorn.logging',
    'uvicorn.protocols.http',
    'uvicorn.protocols.http.auto',
    'uvicorn.protocols.http.h11_impl',
    'uvicorn.protocols.websockets',
    'uvicorn.protocols.websockets.auto',
    'uvicorn.lifespan',
    'uvicorn.lifespan.on',
    'httpx',
    'httpx._transports',
    'httpx._transports.default',
    'anyio',
    'anyio._backends',
    'anyio._backends._asyncio',
] + all_modules

a = Analysis(
    ['run.py'],
    pathex=[str(src_path)],
    binaries=[],
    datas=datas,
    hiddenimports=hiddenimports,
    hookspath=['hooks'],
    hooksconfig={},
    runtime_hooks=[],
    excludes=[],
    win_no_prefer_redirects=False,
    win_private_assemblies=False,
    cipher=block_cipher,
    noarchive=False,
)

pyz = PYZ(a.pure, a.zipped_data, cipher=block_cipher)

exe = EXE(
    pyz,
    a.scripts,
    a.binaries,
    a.zipfiles,
    a.datas,
    [],
    name='KiroProxy',
    debug=False,
    bootloader_ignore_signals=False,
    strip=False,
    upx=True,
    upx_exclude=[],
    runtime_tmpdir=None,
    console=True,
    disable_windowed_traceback=False,
    argv_emulation=False,
    target_arch=None,
    codesign_identity=None,
    entitlements_file=None,
    icon='assets/icon.ico' if sys.platform == 'win32' else None,
)
