# openbmclapi-dashboard

你说得对：如果直接监听和现有服务相同端口会冲突。

这个版本已改为**默认监听独立端口 `4001`**，用于仪表盘与统计 API，不占用你原本的 `4000` 业务端口。

## 核心结论

- 业务服务：继续 `127.0.0.1:4000`
- 统计面板服务：`127.0.0.1:4001`（可改）
- 地区统计：使用 **GeoIP**（推荐由 Nginx geoip2 写入日志中的国家码）

## 功能

- 累计请求数 / 累计带宽
- 当日（UTC+8）请求数 / 当日带宽
- 5 分钟粒度折线图（请求 + 带宽）
- 世界地图热力图（请求越多越红）
- 实时刷新（15 秒）

## 启动

```bash
npm install
DASHBOARD_PORT=4001 NGINX_LOG_PATH=/www/wwwlogs/openbmclapi.log npm start
```

环境变量：

- `DASHBOARD_PORT`：仪表盘服务端口（默认 `4001`）
- `NGINX_LOG_PATH`：Nginx 日志路径（默认 `/www/wwwlogs/openbmclapi.log`）
- `GEO_MODE`：地区模式标识（默认 `nginx_geoip`，仅用于返回元信息）

## Nginx 推荐配置（避免端口冲突 + GeoIP）

你当前 `location /` 保持不变，继续代理到 `4000`。

新增一个 location 给仪表盘：

```nginx
location /dashboard/ {
    proxy_pass http://127.0.0.1:4001/;
    proxy_set_header Host $host;
    proxy_set_header X-Real-IP $remote_addr;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
}
```

### GeoIP（geoip2）日志字段示例

如果你安装了 Nginx geoip2 模块，建议把国家码写入 access log，后端即可直接映射国家名：

```nginx
# 示例，路径按你的系统实际位置调整
geoip2 /usr/share/GeoIP/GeoLite2-Country.mmdb {
    auto_reload 5m;
    $geoip2_country_code source=$remote_addr country iso_code;
}

log_format openbmclapi_geo '$remote_addr - $remote_user [$time_local] '
                        '"$request" $status $body_bytes_sent '
                        '"$http_referer" "$http_user_agent" "$geoip2_country_code"';

access_log /www/wwwlogs/openbmclapi.log openbmclapi_geo;
```

> 若不加 GeoIP 字段，地图会显示 `Unknown`，因为默认 combined 日志不包含国家信息。

## API

前端读取 `/api/dashboard/stats`，示例：

```json
{
  "totals": { "requests": 38620241, "bandwidth": 7142992592419 },
  "today": { "requests": 1982774, "bandwidth": 329820192819, "dateBucket": "2026-02-12" },
  "trend": {
    "labels": ["10:00", "10:05", "10:10"],
    "requests": [1092, 1131, 1202],
    "bandwidth": [154191102, 162102112, 171002992]
  },
  "geo": [
    { "name": "China", "value": 934232 },
    { "name": "United States", "value": 368282 }
  ],
  "source": {
    "logPath": "/www/wwwlogs/openbmclapi.log",
    "geoMode": "nginx_geoip",
    "lastError": null
  }
}
```
