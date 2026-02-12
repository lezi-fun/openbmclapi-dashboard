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
