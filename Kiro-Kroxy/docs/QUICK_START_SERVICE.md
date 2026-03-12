# Kiro Proxy 后台服务 - 快速开始

## 一键安装（推荐）

### Windows

1. **以管理员身份打开 PowerShell 或 CMD**
   - 按 `Win + X`，选择 "Windows PowerShell (管理员)"
   - 或右键开始菜单 → "终端(管理员)"

2. **切换到项目目录**
   ```cmd
   cd E:\shiro\KiroProxy
   ```

3. **运行安装脚本**
   ```cmd
   python install_service.py
   ```

4. **按提示输入端口号**（直接回车使用默认 8080）

5. **完成！** 服务已安装，下次登录时自动启动

### Linux

```bash
cd /path/to/KiroProxy
sudo python3 install_service.py
```

---

## 检查服务状态

```bash
python check_service.py
```

输出示例：
```
✅ 任务计划已安装
✅ 启动脚本存在
   使用虚拟环境 Python ✓
✅ 服务运行正常
   访问地址: http://localhost:8081
```

---

## 常用命令

### Windows

```cmd
# 立即启动服务
schtasks /Run /TN KiroProxyService

# 查看任务状态
schtasks /Query /TN KiroProxyService

# 检查端口是否在监听
netstat -ano | findstr "0.0.0.0:8081"

# 卸载服务
python uninstall_service.py
```

### Linux

```bash
# 启动服务
sudo systemctl start kiro-proxy

# 停止服务
sudo systemctl stop kiro-proxy

# 重启服务
sudo systemctl restart kiro-proxy

# 查看状态
sudo systemctl status kiro-proxy

# 查看日志
sudo journalctl -u kiro-proxy -f

# 卸载服务
sudo python3 uninstall_service.py
```

---

## 功能特性

✅ **开机自动启动** - 无需手动运行  
✅ **后台运行** - 无窗口，不占用终端  
✅ **虚拟环境支持** - 自动检测并使用 venv  
✅ **依赖检查** - 安装前自动验证依赖  
✅ **跨平台** - Windows 和 Linux 统一体验  

---

## 故障排查

### 服务无法启动

1. **检查依赖是否安装**
   ```bash
   # 如果使用虚拟环境
   venv\Scripts\activate  # Windows
   source venv/bin/activate  # Linux
   
   # 安装依赖
   pip install -r requirements.txt
   ```

2. **检查端口是否被占用**
   ```bash
   # Windows
   netstat -ano | findstr :8080
   
   # Linux
   sudo netstat -tlnp | grep :8080
   ```

3. **手动测试运行**
   ```bash
   python run.py --no-ui 8080
   ```

### 服务已安装但无法访问

1. **检查服务是否运行**
   ```bash
   python check_service.py
   ```

2. **手动启动服务**
   ```bash
   # Windows
   schtasks /Run /TN KiroProxyService
   
   # Linux
   sudo systemctl start kiro-proxy
   ```

3. **查看日志**
   ```bash
   # Linux
   sudo journalctl -u kiro-proxy -n 50
   ```

### 虚拟环境问题

如果安装时未检测到虚拟环境，但你确实使用了 venv：

1. **卸载服务**
   ```bash
   python uninstall_service.py
   ```

2. **确保虚拟环境存在**
   ```bash
   # 检查路径
   # Windows: venv\Scripts\python.exe
   # Linux: venv/bin/python
   ```

3. **重新安装**
   ```bash
   python install_service.py
   ```

---

## 更多帮助

详细文档请查看：
- [SERVICE_GUIDE.md](SERVICE_GUIDE.md) - 完整服务管理指南
- [README.md](README.md) - 项目主文档
