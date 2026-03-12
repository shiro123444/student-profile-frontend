# Kiro Proxy 后台服务安装指南

## 功能说明

将 Kiro Proxy 安装为系统服务，实现：
- ✅ 开机自动启动
- ✅ 后台运行（无窗口）
- ✅ 关闭终端不影响运行
- ✅ 支持 Windows 和 Linux

---

## Windows 安装

### 方式一：自动安装（推荐）

1. **以管理员身份运行 PowerShell 或 CMD**

2. **运行安装脚本**
   ```cmd
   python install_service.py
   ```

3. **按提示输入端口号**（默认 8080）

4. **完成！** 服务将在下次登录时自动启动

### 方式二：手动安装

1. **创建启动脚本** `start_kiro_proxy.vbs`：
   ```vbscript
   Set WshShell = CreateObject("WScript.Shell")
   WshShell.Run "python E:\shiro\KiroProxy\run.py --no-ui 8080", 0, False
   Set WshShell = Nothing
   ```
   > 注意：修改路径为你的实际路径

2. **创建任务计划**：
   - 打开"任务计划程序"（Win+R 输入 `taskschd.msc`）
   - 创建基本任务
   - 触发器：用户登录时
   - 操作：启动程序 `wscript.exe`
   - 参数：`"E:\shiro\KiroProxy\start_kiro_proxy.vbs"`
   - 勾选"使用最高权限运行"

### Windows 管理命令

```cmd
# 查看任务
schtasks /Query /TN KiroProxyService

# 立即运行
schtasks /Run /TN KiroProxyService

# 删除任务
schtasks /Delete /TN KiroProxyService /F

# 或使用卸载脚本
python uninstall_service.py
```

---

## Linux 安装

### 自动安装（推荐）

1. **使用 sudo 运行安装脚本**
   ```bash
   sudo python3 install_service.py
   ```

2. **按提示输入端口号**（默认 8080）

3. **完成！** 服务已安装并设置为开机自启

### 手动安装

1. **创建服务文件** `/etc/systemd/system/kiro-proxy.service`：
   ```ini
   [Unit]
   Description=Kiro API Proxy Service
   After=network.target

   [Service]
   Type=simple
   User=your_username
   WorkingDirectory=/path/to/KiroProxy
   ExecStart=/usr/bin/python3 /path/to/KiroProxy/run.py --no-ui 8080
   Restart=always
   RestartSec=10
   StandardOutput=journal
   StandardError=journal

   [Install]
   WantedBy=multi-user.target
   ```
   > 注意：修改 `User`、`WorkingDirectory` 和 `ExecStart` 为实际值

2. **启用服务**：
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl enable kiro-proxy.service
   sudo systemctl start kiro-proxy.service
   ```

### Linux 管理命令

```bash
# 启动服务
sudo systemctl start kiro-proxy

# 停止服务
sudo systemctl stop kiro-proxy

# 重启服务
sudo systemctl restart kiro-proxy

# 查看状态
sudo systemctl status kiro-proxy

# 查看实时日志
sudo journalctl -u kiro-proxy -f

# 禁用开机自启
sudo systemctl disable kiro-proxy

# 卸载服务
sudo python3 uninstall_service.py
```

---

## 验证服务运行

安装后，访问以下地址验证服务是否正常运行：

```
http://localhost:8080
```

或使用 API 测试：

```bash
# Windows (PowerShell)
Invoke-WebRequest http://localhost:8080/api/status

# Linux
curl http://localhost:8080/api/status
```

---

## 常见问题

### Q: 如何修改端口？

**Windows:**
1. 卸载服务：`python uninstall_service.py`
2. 重新安装并指定新端口：`python install_service.py`

**Linux:**
1. 编辑服务文件：`sudo nano /etc/systemd/system/kiro-proxy.service`
2. 修改 `ExecStart` 行的端口号
3. 重载并重启：
   ```bash
   sudo systemctl daemon-reload
   sudo systemctl restart kiro-proxy
   ```

### Q: 如何查看日志？

**Windows:**
- 日志输出到任务计划程序历史记录
- 或手动运行查看：`python run.py --no-ui 8080`

**Linux:**
```bash
# 查看最近日志
sudo journalctl -u kiro-proxy -n 100

# 实时查看日志
sudo journalctl -u kiro-proxy -f
```

### Q: 服务无法启动？

1. **检查端口是否被占用**：
   ```bash
   # Windows
   netstat -ano | findstr :8080
   
   # Linux
   sudo netstat -tlnp | grep :8080
   ```

2. **检查 Python 环境**：
   - 确保虚拟环境已激活或依赖已安装
   - 测试手动运行：`python run.py --no-ui 8080`

3. **检查权限**：
   - Windows: 确保以管理员身份安装
   - Linux: 确保使用 sudo 安装

### Q: 如何完全卸载？

**Windows:**
```cmd
python uninstall_service.py
```

**Linux:**
```bash
sudo python3 uninstall_service.py
```

---

## 高级配置

### 使用虚拟环境

如果使用虚拟环境，需要修改启动命令：

**Windows VBS 脚本:**
```vbscript
WshShell.Run "E:\shiro\KiroProxy\venv\Scripts\python.exe E:\shiro\KiroProxy\run.py --no-ui 8080", 0, False
```

**Linux systemd:**
```ini
ExecStart=/path/to/KiroProxy/venv/bin/python /path/to/KiroProxy/run.py --no-ui 8080
```

### 环境变量

在服务文件中添加环境变量：

**Linux systemd:**
```ini
[Service]
Environment="PYTHONUNBUFFERED=1"
Environment="CUSTOM_VAR=value"
```

---

## 支持

如有问题，请查看：
- 项目 README: `README.md`
- 日志输出
- GitHub Issues
