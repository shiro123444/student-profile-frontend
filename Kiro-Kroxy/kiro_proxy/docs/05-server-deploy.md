# 服务器部署指南

本文档详细介绍如何在各种服务器环境中部署 Kiro Proxy。

## 目录

- [方式一：预编译二进制（推荐）](#方式一预编译二进制推荐)
- [方式二：从源码运行](#方式二从源码运行)
- [方式三：Docker 部署](#方式三docker-部署)
- [账号配置](#账号配置)
- [开机自启配置](#开机自启配置)
- [反向代理配置](#反向代理配置)
- [常见问题](#常见问题)

---

## 方式一：预编译二进制（推荐）

最简单的方式，不需要安装任何依赖。

### Linux (x86_64)

```bash
# 下载最新版本
wget https://github.com/petehsu/KiroProxy/releases/latest/download/KiroProxy-1.7.1-linux-x86_64

# 添加执行权限
chmod +x KiroProxy-1.7.1-linux-x86_64

# 运行
./KiroProxy-1.7.1-linux-x86_64

# 指定端口
./KiroProxy-1.7.1-linux-x86_64 8081
```

**使用 curl 下载：**

```bash
curl -LO https://github.com/petehsu/KiroProxy/releases/latest/download/KiroProxy-1.7.1-linux-x86_64
chmod +x KiroProxy-1.7.1-linux-x86_64
./KiroProxy-1.7.1-linux-x86_64
```

**Debian/Ubuntu 使用 deb 包：**

```bash
wget https://github.com/petehsu/KiroProxy/releases/latest/download/kiroproxy_1.7.1_amd64.deb
sudo dpkg -i kiroproxy_1.7.1_amd64.deb

# 运行
KiroProxy
```

**Fedora/RHEL/CentOS 使用 rpm 包：**

```bash
wget https://github.com/petehsu/KiroProxy/releases/latest/download/kiroproxy-1.7.1-1.x86_64.rpm
sudo rpm -i kiroproxy-1.7.1-1.x86_64.rpm

# 运行
KiroProxy
```

### macOS

```bash
# Intel Mac
curl -LO https://github.com/petehsu/KiroProxy/releases/latest/download/KiroProxy-1.7.1-macos-x86_64
chmod +x KiroProxy-1.7.1-macos-x86_64
./KiroProxy-1.7.1-macos-x86_64

# 如果提示无法验证开发者，运行：
xattr -d com.apple.quarantine KiroProxy-1.7.1-macos-x86_64
```

### Windows

```powershell
# PowerShell 下载
Invoke-WebRequest -Uri "https://github.com/petehsu/KiroProxy/releases/latest/download/KiroProxy-1.7.1-windows-x86_64.exe" -OutFile "KiroProxy.exe"

# 运行
.\KiroProxy.exe

# 指定端口
.\KiroProxy.exe 8081
```

---

## 方式二：从源码运行

需要 Python 3.9+ 和 Git。

### 安装 Git（如果没有）

**Ubuntu/Debian：**
```bash
sudo apt update
sudo apt install git -y
```

**CentOS/RHEL/Fedora：**
```bash
sudo yum install git -y
# 或
sudo dnf install git -y
```

**macOS：**
```bash
# 安装 Xcode Command Line Tools
xcode-select --install
# 或使用 Homebrew
brew install git
```

**Windows：**
从 https://git-scm.com/download/win 下载安装

### 安装 Python（如果没有）

**Ubuntu/Debian：**
```bash
sudo apt update
sudo apt install python3 python3-pip python3-venv -y
```

**CentOS/RHEL 8+：**
```bash
sudo dnf install python39 python39-pip -y
```

**Fedora：**
```bash
sudo dnf install python3 python3-pip -y
```

**macOS：**
```bash
brew install python@3.11
```

**Windows：**
从 https://www.python.org/downloads/ 下载安装，勾选 "Add to PATH"

### 克隆并运行

```bash
# 克隆项目
git clone https://github.com/petehsu/KiroProxy.git
cd KiroProxy

# 创建虚拟环境（推荐）
python3 -m venv venv
source venv/bin/activate  # Windows: venv\Scripts\activate

# 安装依赖
pip install -r requirements.txt

# 运行
python run.py

# 指定端口
python run.py 8081

# 或使用 CLI
python run.py serve -p 8081
```

### 更新到最新版本

```bash
cd KiroProxy
git pull origin main
pip install -r requirements.txt
```

---

## 方式三：Docker 部署

### 使用 Dockerfile

创建 `Dockerfile`：

```dockerfile
FROM python:3.11-slim

WORKDIR /app

# 安装依赖
COPY requirements.txt .
RUN pip install --no-cache-dir -r requirements.txt

# 复制代码
COPY . .

# 暴露端口
EXPOSE 8080

# 数据目录
VOLUME ["/root/.config/kiro-proxy"]

# 启动
CMD ["python", "run.py"]
```

构建并运行：

```bash
docker build -t kiro-proxy .
docker run -d -p 8080:8080 -v kiro-data:/root/.config/kiro-proxy --name kiro-proxy kiro-proxy
```

### Docker Compose

创建 `docker-compose.yml`：

```yaml
version: '3'
services:
  kiro-proxy:
    build: .
    ports:
      - "8080:8080"
    volumes:
      - kiro-data:/root/.config/kiro-proxy
    restart: unless-stopped

volumes:
  kiro-data:
```

运行：

```bash
docker-compose up -d
```

---

## 账号配置

服务器通常没有浏览器，有以下几种方式添加账号：

### 方式一：远程登录链接（推荐）

1. 在服务器上启动 KiroProxy
2. 在本地浏览器打开 `http://服务器IP:8080`
3. 点击「远程登录链接」按钮
4. 复制生成的链接，在本地浏览器打开
5. 完成 Google/GitHub 授权
6. 账号自动添加到服务器

### 方式二：导入导出

**本地电脑：**
```bash
# 运行 KiroProxy 并登录
python run.py

# 导出账号
python run.py accounts export -o accounts.json
```

**服务器：**
```bash
# 上传 accounts.json 到服务器后导入
python run.py accounts import accounts.json

# 或使用 curl
curl -X POST http://localhost:8080/api/accounts/import \
  -H "Content-Type: application/json" \
  -d @accounts.json
```

### 方式三：手动添加 Token

1. 在本地 Kiro IDE 登录
2. 找到 `~/.aws/sso/cache/` 目录下的 JSON 文件
3. 复制 `accessToken` 和 `refreshToken`

**服务器上：**
```bash
# 交互式添加
python run.py accounts add

# 或使用 API
curl -X POST http://localhost:8080/api/accounts/manual \
  -H "Content-Type: application/json" \
  -d '{
    "name": "我的账号",
    "access_token": "eyJ...",
    "refresh_token": "eyJ..."
  }'
```

### 方式四：扫描本地 Token

如果服务器上安装了 Kiro IDE 并已登录：

```bash
python run.py accounts scan --auto
```

---

## 开机自启配置

### Linux (systemd)

创建服务文件 `/etc/systemd/system/kiro-proxy.service`：

```ini
[Unit]
Description=Kiro API Proxy
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/kiro-proxy
ExecStart=/opt/kiro-proxy/KiroProxy
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
```

**使用预编译二进制：**
```bash
# 创建目录并下载
sudo mkdir -p /opt/kiro-proxy
sudo wget -O /opt/kiro-proxy/KiroProxy https://github.com/petehsu/KiroProxy/releases/latest/download/KiroProxy-1.7.1-linux-x86_64
sudo chmod +x /opt/kiro-proxy/KiroProxy

# 创建服务文件
sudo tee /etc/systemd/system/kiro-proxy.service << 'EOF'
[Unit]
Description=Kiro API Proxy
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/kiro-proxy
ExecStart=/opt/kiro-proxy/KiroProxy
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF

# 启用并启动
sudo systemctl daemon-reload
sudo systemctl enable kiro-proxy
sudo systemctl start kiro-proxy

# 查看状态
sudo systemctl status kiro-proxy

# 查看日志
sudo journalctl -u kiro-proxy -f
```

**使用源码运行：**
```bash
sudo tee /etc/systemd/system/kiro-proxy.service << 'EOF'
[Unit]
Description=Kiro API Proxy
After=network.target

[Service]
Type=simple
User=root
WorkingDirectory=/opt/KiroProxy
ExecStart=/opt/KiroProxy/venv/bin/python run.py
Restart=always
RestartSec=10

[Install]
WantedBy=multi-user.target
EOF
```

### Linux (使用 screen/tmux)

**screen：**
```bash
# 安装
sudo apt install screen  # Debian/Ubuntu
sudo yum install screen  # CentOS

# 创建会话并运行
screen -S kiro
./KiroProxy

# 按 Ctrl+A D 退出会话（程序继续运行）

# 重新连接
screen -r kiro
```

**tmux：**
```bash
# 安装
sudo apt install tmux  # Debian/Ubuntu
sudo yum install tmux  # CentOS

# 创建会话并运行
tmux new -s kiro
./KiroProxy

# 按 Ctrl+B D 退出会话

# 重新连接
tmux attach -t kiro
```

### Linux (使用 nohup)

```bash
# 后台运行
nohup ./KiroProxy > kiro.log 2>&1 &

# 查看日志
tail -f kiro.log

# 停止
pkill -f KiroProxy
```

### macOS (launchd)

创建 `~/Library/LaunchAgents/com.kiro.proxy.plist`：

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
    <key>Label</key>
    <string>com.kiro.proxy</string>
    <key>ProgramArguments</key>
    <array>
        <string>/usr/local/bin/KiroProxy</string>
    </array>
    <key>RunAtLoad</key>
    <true/>
    <key>KeepAlive</key>
    <true/>
    <key>StandardOutPath</key>
    <string>/tmp/kiro-proxy.log</string>
    <key>StandardErrorPath</key>
    <string>/tmp/kiro-proxy.err</string>
</dict>
</plist>
```

```bash
# 加载服务
launchctl load ~/Library/LaunchAgents/com.kiro.proxy.plist

# 启动
launchctl start com.kiro.proxy

# 停止
launchctl stop com.kiro.proxy

# 卸载
launchctl unload ~/Library/LaunchAgents/com.kiro.proxy.plist
```

### Windows (任务计划程序)

**方法一：使用 PowerShell 创建计划任务**

```powershell
# 创建计划任务（开机自启）
$action = New-ScheduledTaskAction -Execute "C:\KiroProxy\KiroProxy.exe"
$trigger = New-ScheduledTaskTrigger -AtStartup
$principal = New-ScheduledTaskPrincipal -UserId "SYSTEM" -LogonType ServiceAccount
Register-ScheduledTask -TaskName "KiroProxy" -Action $action -Trigger $trigger -Principal $principal

# 立即启动
Start-ScheduledTask -TaskName "KiroProxy"

# 停止
Stop-ScheduledTask -TaskName "KiroProxy"

# 删除
Unregister-ScheduledTask -TaskName "KiroProxy" -Confirm:$false
```

**方法二：使用 NSSM 创建 Windows 服务**

1. 下载 NSSM: https://nssm.cc/download
2. 解压并运行：

```cmd
nssm install KiroProxy C:\KiroProxy\KiroProxy.exe
nssm start KiroProxy

# 停止
nssm stop KiroProxy

# 删除
nssm remove KiroProxy confirm
```

**方法三：创建 VBS 启动脚本**

创建 `start-kiro.vbs`：

```vbscript
Set WshShell = CreateObject("WScript.Shell")
WshShell.Run "C:\KiroProxy\KiroProxy.exe", 0, False
```

将此文件放入启动文件夹：`shell:startup`

---

## 反向代理配置

### Nginx

```nginx
server {
    listen 80;
    server_name kiro.example.com;

    location / {
        proxy_pass http://127.0.0.1:8080;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection "upgrade";
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        
        # SSE 支持
        proxy_buffering off;
        proxy_cache off;
        proxy_read_timeout 86400;
    }
}
```

**启用 HTTPS（使用 Certbot）：**

```bash
sudo apt install certbot python3-certbot-nginx
sudo certbot --nginx -d kiro.example.com
```

### Caddy

```caddyfile
kiro.example.com {
    reverse_proxy localhost:8080
}
```

Caddy 会自动申请和续期 HTTPS 证书。

### Apache

```apache
<VirtualHost *:80>
    ServerName kiro.example.com
    
    ProxyPreserveHost On
    ProxyPass / http://127.0.0.1:8080/
    ProxyPassReverse / http://127.0.0.1:8080/
    
    # SSE 支持
    SetEnv proxy-sendchunked 1
</VirtualHost>
```

---

## 常见问题

### 端口被占用

```bash
# 查看端口占用
lsof -i :8080  # Linux/macOS
netstat -ano | findstr :8080  # Windows

# 使用其他端口
./KiroProxy 8081
```

### 防火墙配置

**Ubuntu/Debian (ufw)：**
```bash
sudo ufw allow 8080/tcp
```

**CentOS/RHEL (firewalld)：**
```bash
sudo firewall-cmd --permanent --add-port=8080/tcp
sudo firewall-cmd --reload
```

**Windows：**
```powershell
New-NetFirewallRule -DisplayName "KiroProxy" -Direction Inbound -Port 8080 -Protocol TCP -Action Allow
```

### 权限问题

```bash
# 如果遇到权限问题
chmod +x KiroProxy
sudo chown -R $USER:$USER /opt/kiro-proxy
```

### 查看日志

```bash
# systemd
sudo journalctl -u kiro-proxy -f

# 直接运行时
./KiroProxy 2>&1 | tee kiro.log
```

### 更新版本

**预编译二进制：**
```bash
# 停止服务
sudo systemctl stop kiro-proxy

# 下载新版本
sudo wget -O /opt/kiro-proxy/KiroProxy https://github.com/petehsu/KiroProxy/releases/latest/download/KiroProxy-1.7.1-linux-x86_64
sudo chmod +x /opt/kiro-proxy/KiroProxy

# 启动服务
sudo systemctl start kiro-proxy
```

**源码方式：**
```bash
cd /opt/KiroProxy
git pull origin main
pip install -r requirements.txt
sudo systemctl restart kiro-proxy
```
