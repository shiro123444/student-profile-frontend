# PyInstaller hook for kiro_proxy package
# This ensures all submodules are collected properly

from PyInstaller.utils.hooks import collect_submodules, collect_data_files

# Collect all submodules from kiro_proxy package
hiddenimports = collect_submodules('kiro_proxy')

# Collect all data files (i18n JSON files, docs, etc.)
datas = collect_data_files('kiro_proxy')
