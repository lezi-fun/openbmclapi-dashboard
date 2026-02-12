# openbmclapi-dashboard

你要的两件事：

1. **完整 Nginx 配置文件**（已提供在 `deploy/nginx-openbmclapi.conf`）
2. **程序后台运行**（已提供 `systemd` 服务文件 `deploy/openbmclapi-dashboard.service`）

---

## 端口说明（避免冲突）

- 业务服务：`127.0.0.1:4000`
- 仪表盘服务：`127.0.0.1:4001`（默认，可通过 `DASHBOARD_PORT` 修改）

仪表盘接口是 `/api/dashboard/stats`，Nginx 会把它转发到 4001。

---

## 你需要复制的完整 Nginx 配置

完整示例文件：

- `deploy/nginx-openbmclapi.conf`

要点：

- `location /` -> 主业务（4000）
- `location /dashboard/` -> 仪表盘页面（4001）
- `location = /api/dashboard/stats` -> 仪表盘 API（4001）
- `access_log ... openbmclapi_geo`：可选写入 `geoip2` 国家码；后端默认会在 Node 侧通过 `geoip-lite` 按 IP 做 GeoIP 解析

部署命令（宝塔/Nginx Linux 常见流程）：

```bash
cp /workspace/openbmclapi-dashboard/deploy/nginx-openbmclapi.conf /www/server/panel/vhost/nginx/openbmclapi.conf
nginx -t
systemctl reload nginx
```

> 如果你的 GeoLite2 路径不是 `/usr/share/GeoIP/GeoLite2-Country.mmdb`，请先改配置中的路径再重载。

---

## 后台运行（systemd）

我已经给你准备好 service 文件：

- `deploy/openbmclapi-dashboard.service`

安装并启动：

```bash
cp /workspace/openbmclapi-dashboard/deploy/openbmclapi-dashboard.service /etc/systemd/system/openbmclapi-dashboard.service
systemctl daemon-reload
systemctl enable --now openbmclapi-dashboard
systemctl status openbmclapi-dashboard
```

查看日志：

```bash
journalctl -u openbmclapi-dashboard -f
```

---

## 本项目功能

- 累计请求数 / 累计带宽
- 当日（UTC+8）请求数 / 当日带宽
- 5 分钟粒度折线图（请求 + 带宽）
- 世界地图热力图（请求越多越红）
- 实时刷新（15 秒）

---

## 本地启动（不走 systemd 时）

```bash
npm install
DASHBOARD_PORT=4001 NGINX_LOG_PATH=/www/wwwlogs/openbmclapi.log npm start
```

环境变量：

- `DASHBOARD_PORT`：仪表盘端口（默认 `4001`）
- `NGINX_LOG_PATH`：Nginx 日志路径（默认 `/www/wwwlogs/openbmclapi.log`）
- `GEO_MODE`：地区模式（默认 `node_geoip`，使用 `geoip-lite` 按 IP 解析；设为 `nginx_geoip` 时优先读取日志中的国家码）

---

## 在 Node 端使用 GeoIP 的完整方法（推荐）

下面这套配置不依赖 Nginx 的 `geoip2` 模块，直接由 Node 读取访问日志中的客户端 IP 并解析国家。

### 1) 安装依赖

在项目目录执行：

```bash
npm install
```

`package.json` 已包含 `geoip-lite`，安装后即可在 Node 端使用本地 GeoIP 数据库做国家解析。

> 如果你的服务器无法访问 npm 官方源，可切换镜像后重试：

```bash
npm config set registry https://registry.npmmirror.com
npm install
```

### 2) 确认 Nginx access_log 格式包含客户端 IP

Node 端 GeoIP 只要求日志里有 IP（通常 `$remote_addr`）。推荐使用标准 combined 格式，例如：

```nginx
log_format main '$remote_addr - $remote_user [$time_local] "$request" '
                '$status $body_bytes_sent "$http_referer" '
                '"$http_user_agent"';
access_log /www/wwwlogs/openbmclapi.log main;
```

如果你在 CDN/反代后面，请保证日志中记录的是真实客户端 IP（如通过 realip 模块处理后再写 `$remote_addr`）。

### 3) 设置环境变量，强制使用 Node 端 GeoIP

启动前设置：

```bash
GEO_MODE=node_geoip
NGINX_LOG_PATH=/www/wwwlogs/openbmclapi.log
DASHBOARD_PORT=4001
npm start
```

说明：

- `GEO_MODE=node_geoip`：始终按 IP 走 Node 侧 `geoip-lite` 解析国家。
- `NGINX_LOG_PATH`：必须指向实际 access_log 文件。
- `DASHBOARD_PORT`：仪表盘服务端口。

### 4) 使用 systemd 时的推荐写法

若你用的是仓库内的 `deploy/openbmclapi-dashboard.service`，可加环境变量覆盖：

```ini
[Service]
Environment=GEO_MODE=node_geoip
Environment=NGINX_LOG_PATH=/www/wwwlogs/openbmclapi.log
Environment=DASHBOARD_PORT=4001
```

保存后执行：

```bash
systemctl daemon-reload
systemctl restart openbmclapi-dashboard
systemctl status openbmclapi-dashboard
```

### 5) 验证是否生效

查看服务日志，应能看到：

```text
[dashboard] geo mode: node_geoip
```

并检查接口返回中的 `source.geoMode`：

```bash
curl -s http://127.0.0.1:4001/api/dashboard/stats
```

返回 JSON 中应包含：

```json
"source": {
  "geoMode": "node_geoip"
}
```

### 6) 常见问题

- **地图全部 Unknown**：通常是日志 IP 不是真实客户端 IP，或日志格式不符合常见 Nginx combined 结构。
- **服务启动报找不到 geoip-lite**：说明依赖未安装成功，重新执行 `npm install`。
- **数据没更新**：确认 `NGINX_LOG_PATH` 指向当前正在写入的日志文件，并检查文件权限。
