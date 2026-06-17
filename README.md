# 金靴杯后台管理与 API 第一版

这是金靴杯世界杯小程序的后台/API 原型，用于维护赛程、比分、AI预测、用户预测积分和排行榜。

## 启动

```bash
npm start
```

默认地址：

```text
http://localhost:8787
```

打开后台页面：

```text
http://localhost:8787
```

## 已有功能

- 比赛列表接口
- 首页实时赛况接口
- 比赛详情接口
- 球队列表接口
- 球员列表接口
- 用户提交预测
- 已完场比赛自动更新积分
- 排行榜接口
- 后台页面更新比赛状态和比分
- 从百度体育页面同步世界杯赛程和赛果
- 从 CCTV 世界杯页面同步世界杯赛程和赛果
- 从金靴杯官网同步世界杯赛程和赛果

## 预测积分规则

- 命中胜平负：50 分
- 命中准确比分：100 分
- 比赛状态为 `已完场` 且有比分时自动更新积分

第一版只做预测、积分、赛果更新和排行榜，不展示奖励或空投内容。

## 主要接口

```text
GET  /api/home
GET  /api/matches
GET  /api/matches/:id
GET  /api/teams
GET  /api/players
GET  /api/predictions?userId=demo-user
POST /api/predictions
GET  /api/leaderboard
PUT  /api/admin/matches/:id
POST /api/admin/sync/baidu
POST /api/admin/sync/cctv
POST /api/admin/sync/golden
```

提交预测示例：

```json
{
  "userId": "demo-user",
  "nickname": "我的预测",
  "matchId": "m2",
  "result": "home",
  "score": "2-1"
}
```

更新比赛示例：

```json
{
  "status": "已完场",
  "score": "2-1"
}
```

## 数据文件

当前数据保存在：

```text
data/db.json
```

正式上线时建议替换为 MySQL 或 PostgreSQL。

## 后续接小程序

小程序后续把 `utils/data.js` 的本地数据替换为这些接口即可：

- 首页读取 `/api/home`
- 赛程读取 `/api/matches`
- 比赛详情读取 `/api/matches/:id`
- 提交预测调用 `/api/predictions`
- 我的积分读取 `/api/predictions?userId=用户ID`
- 排行榜读取 `/api/leaderboard`

## 同步百度体育赛程

后台页面顶部有三个同步按钮：

```text
同步金靴杯官网赛程
同步 CCTV 赛程
同步百度赛程
```

金靴杯官网同步请求：

```text
POST /api/admin/sync/golden
```

金靴杯官网同步来源：

```text
https://www.goldenbootflap.xyz/schedule
```

CCTV 同步请求：

```text
POST /api/admin/sync/cctv
```

CCTV 当前同步来源：

```text
https://worldcup.cctv.com/2026/schedule/index.shtml
```

百度同步请求：

```text
POST /api/admin/sync/baidu
```

当前同步来源：

```text
https://tiyu.baidu.com/al/match?match=世界杯&tab=赛程
```

同步内容包括：

- 比赛日期
- 比赛时间
- 阶段
- 主队和客队
- 比分
- 比赛状态

注意：网页结构可能变化，正式上线建议保留后台人工审核入口，避免第三方页面改版导致错误数据直接进入小程序。

如果后台提示没有解析到比赛，通常不是操作问题，而是百度页面改成了动态数据、脚本数据或触发了反爬返回。此时需要更新解析规则，或改接更稳定的体育数据接口。

如果官网同步仍然失败，通常说明官网赛程数据来自独立 API。把该 API 地址发给我后，可以直接改成同步 API 数据，会比解析页面稳定。
