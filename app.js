const REFRESH_INTERVAL = 15_000;
const API_ENDPOINT = '/api/dashboard/stats';

const numberFormatter = new Intl.NumberFormat('zh-CN');
const dateFormatter = new Intl.DateTimeFormat('zh-CN', {
  hour12: false,
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
  second: '2-digit',
  timeZone: 'Asia/Shanghai'
});

const requestTrendChart = echarts.init(document.getElementById('requestTrend'));
const bandwidthTrendChart = echarts.init(document.getElementById('bandwidthTrend'));
const worldMapChart = echarts.init(document.getElementById('worldMap'));

function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB', 'PB'];
  const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  const value = bytes / 1024 ** exponent;
  return `${value.toFixed(value < 10 && exponent > 0 ? 2 : 1)} ${units[exponent]}`;
}

function mapApiPayload(payload) {
  return {
    totals: {
      requests: payload?.totals?.requests ?? 0,
      bandwidth: payload?.totals?.bandwidth ?? 0
    },
    today: {
      requests: payload?.today?.requests ?? 0,
      bandwidth: payload?.today?.bandwidth ?? 0,
      dateBucket: payload?.today?.dateBucket ?? ''
    },
    trend: {
      labels: payload?.trend?.labels ?? [],
      requests: payload?.trend?.requests ?? [],
      bandwidth: payload?.trend?.bandwidth ?? []
    },
    geo: payload?.geo ?? [],
    source: payload?.source ?? {}
  };
}

async function loadStats() {
  const response = await fetch(API_ENDPOINT, { cache: 'no-store' });
  if (!response.ok) {
    throw new Error(`HTTP ${response.status}`);
  }
  return mapApiPayload(await response.json());
}

function renderCards(data) {
  document.getElementById('totalRequests').textContent = numberFormatter.format(data.totals.requests);
  document.getElementById('totalBandwidth').textContent = formatBytes(data.totals.bandwidth);
  document.getElementById('todayRequests').textContent = numberFormatter.format(data.today.requests);
  document.getElementById('todayBandwidth').textContent = formatBytes(data.today.bandwidth);
  document.getElementById('lastUpdated').textContent = `Last update: ${dateFormatter.format(new Date())}`;
  const warning = document.getElementById('warning');
  warning.textContent = data.source.lastError
    ? `日志读取异常：${data.source.lastError}`
    : `数据源：${data.source.logPath || 'Nginx Access Log'} · ${data.source.geoMode || 'geoip'}`;
}

function renderRequestTrend(data) {
  requestTrendChart.setOption({
    grid: { left: 40, right: 16, top: 24, bottom: 28 },
    tooltip: { trigger: 'axis' },
    xAxis: {
      type: 'category',
      data: data.trend.labels,
      boundaryGap: false,
      axisLine: { lineStyle: { color: '#4e5c88' } },
      axisLabel: { color: '#93a0c8' }
    },
    yAxis: {
      type: 'value',
      axisLabel: {
        color: '#93a0c8',
        formatter: (value) => numberFormatter.format(value)
      },
      splitLine: { lineStyle: { color: 'rgba(147,160,200,.2)' } }
    },
    series: [
      {
        data: data.trend.requests,
        type: 'line',
        smooth: true,
        symbol: 'none',
        lineStyle: { width: 3, color: '#6f8bff' },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(111,139,255,0.45)' },
            { offset: 1, color: 'rgba(111,139,255,0)' }
          ])
        }
      }
    ]
  });
}

function renderBandwidthTrend(data) {
  bandwidthTrendChart.setOption({
    grid: { left: 40, right: 16, top: 24, bottom: 28 },
    tooltip: {
      trigger: 'axis',
      valueFormatter: (value) => formatBytes(value)
    },
    xAxis: {
      type: 'category',
      data: data.trend.labels,
      boundaryGap: false,
      axisLine: { lineStyle: { color: '#4e5c88' } },
      axisLabel: { color: '#93a0c8' }
    },
    yAxis: {
      type: 'value',
      axisLabel: {
        color: '#93a0c8',
        formatter: (value) => formatBytes(value)
      },
      splitLine: { lineStyle: { color: 'rgba(147,160,200,.2)' } }
    },
    series: [
      {
        data: data.trend.bandwidth,
        type: 'line',
        smooth: true,
        symbol: 'none',
        lineStyle: { width: 3, color: '#53d3ff' },
        areaStyle: {
          color: new echarts.graphic.LinearGradient(0, 0, 0, 1, [
            { offset: 0, color: 'rgba(83,211,255,0.45)' },
            { offset: 1, color: 'rgba(83,211,255,0)' }
          ])
        }
      }
    ]
  });
}

function renderWorldMap(data) {
  const maxGeo = Math.max(...data.geo.map((item) => item.value), 1);

  worldMapChart.setOption({
    tooltip: {
      trigger: 'item',
      formatter: ({ name, value }) => `${name}<br/>请求数：${numberFormatter.format(value || 0)}`
    },
    visualMap: {
      min: 0,
      max: maxGeo,
      left: 24,
      bottom: 8,
      text: ['高', '低'],
      inRange: {
        color: ['#203052', '#3f4f95', '#8f3f6d', '#ff465c']
      },
      textStyle: { color: '#ced8ff' }
    },
    series: [
      {
        type: 'map',
        map: 'world',
        roam: true,
        nameProperty: 'name',
        emphasis: {
          itemStyle: {
            areaColor: '#ff8f5a'
          }
        },
        itemStyle: {
          borderColor: 'rgba(165,188,255,0.4)',
          areaColor: '#1f2a47'
        },
        data: data.geo
      }
    ]
  });
}

function updateClock() {
  document.getElementById('utc8Clock').textContent = `${dateFormatter.format(new Date())} (UTC+8)`;
}

async function refreshDashboard() {
  try {
    const stats = await loadStats();
    renderCards(stats);
    renderRequestTrend(stats);
    renderBandwidthTrend(stats);
    renderWorldMap(stats);
  } catch (error) {
    document.getElementById('warning').textContent = `接口请求失败：${error.message}`;
  }
}

window.addEventListener('resize', () => {
  requestTrendChart.resize();
  bandwidthTrendChart.resize();
  worldMapChart.resize();
});

updateClock();
setInterval(updateClock, 1000);
refreshDashboard();
setInterval(refreshDashboard, REFRESH_INTERVAL);
