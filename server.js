const http = require("http");
const fs = require("fs");
const path = require("path");
const url = require("url");

const PORT = Number(process.env.PORT || 8787);
const ROOT = __dirname;
const DB_PATH = path.join(ROOT, "data", "db.json");
const PUBLIC_DIR = path.join(ROOT, "public");
const BAIDU_WORLD_CUP_URL = "https://tiyu.baidu.com/al/match?match=%E4%B8%96%E7%95%8C%E6%9D%AF&tab=%E8%B5%9B%E7%A8%8B";
const CCTV_WORLD_CUP_URL = "https://worldcup.cctv.com/2026/schedule/index.shtml";
const GOLDEN_BOOT_SCHEDULE_URL = "https://www.goldenbootflap.xyz/schedule";
const GOLDEN_BOOT_SCHEDULE_API = "https://www.goldenbootflap.xyz/api/baidu-schedule";

function readDb() {
  return JSON.parse(fs.readFileSync(DB_PATH, "utf8"));
}

function writeDb(db) {
  fs.writeFileSync(DB_PATH, JSON.stringify(db, null, 2), "utf8");
}

function hashText(text) {
  let hash = 0;
  for (let index = 0; index < text.length; index += 1) {
    hash = (hash * 31 + text.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

function decodeHtml(text) {
  return String(text || "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;/g, "'")
    .replace(/&quot;/g, "\"");
}

function decodeUnicodeEscapes(text) {
  return String(text || "").replace(/\\u([0-9a-fA-F]{4})/g, (_, hex) => {
    return String.fromCharCode(parseInt(hex, 16));
  });
}

function sendJson(res, data, status = 200) {
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET,POST,PUT,OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type"
  });
  res.end(JSON.stringify(data));
}

function sendText(res, text, status = 200, contentType = "text/plain; charset=utf-8") {
  res.writeHead(status, { "Content-Type": contentType });
  res.end(text);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let body = "";
    req.on("data", (chunk) => {
      body += chunk;
      if (body.length > 1024 * 1024) {
        reject(new Error("请求体过大"));
        req.destroy();
      }
    });
    req.on("end", () => {
      if (!body) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(body));
      } catch (error) {
        reject(new Error("JSON 格式错误"));
      }
    });
  });
}

function getTeam(db, id) {
  return db.teams.find((item) => item.id === id);
}

function ensureTeam(db, name) {
  let team = db.teams.find((item) => item.name === name);
  if (team) return team;
  const flagClass = flagClassForTeam(name);
  team = {
    id: `T_${hashText(name).toUpperCase()}`,
    name,
    group: "",
    flagClass,
    rank: 0,
    form: "暂无数据",
    attack: 70,
    defense: 70,
    qualifyRate: 0,
    summary: "自动同步球队，等待后台补充资料。"
  };
  db.teams.push(team);
  return team;
}

function flagClassForTeam(name) {
  const map = {
    "阿根廷": "arg",
    "法国": "fra",
    "巴西": "bra",
    "英格兰": "eng",
    "西班牙": "esp",
    "葡萄牙": "por",
    "德国": "ger",
    "荷兰": "ned",
    "墨西哥": "mex",
    "南非": "rsa",
    "韩国": "kor",
    "捷克": "cze",
    "加拿大": "can",
    "波黑": "bih",
    "美国": "usa",
    "巴拉圭": "par",
    "卡塔尔": "qat",
    "瑞士": "sui",
    "摩洛哥": "mar",
    "海地": "hai",
    "苏格兰": "sco",
    "澳大利亚": "aus",
    "土耳其": "tur",
    "库拉索": "cuw",
    "日本": "jpn",
    "科特迪瓦": "civ",
    "厄瓜多尔": "ecu",
    "瑞典": "swe",
    "突尼斯": "tun",
    "佛得角": "cpv",
    "比利时": "bel",
    "埃及": "egy",
    "沙特阿拉伯": "ksa",
    "乌拉圭": "uru",
    "伊朗": "irn",
    "新西兰": "nzl",
    "塞内加尔": "sen",
    "伊拉克": "irq",
    "挪威": "nor",
    "阿尔及利亚": "alg",
    "奥地利": "aut",
    "约旦": "jor",
    "刚果民主共和国": "cod",
    "克罗地亚": "cro",
    "加纳": "gha",
    "巴拿马": "pan",
    "乌兹别克斯坦": "uzb",
    "哥伦比亚": "col"
  };
  return map[name] || "";
}

function isLivePlayer(player) {
  return Boolean(player && (player.launchStatus === "Live" || player.status === "Live" || player.tokenAddress));
}

function getTeamLivePlayers(db, teamId) {
  return (db.players || [])
    .filter((player) => player.teamId === teamId && isLivePlayer(player))
    .sort((a, b) => Number(b.impact || 0) - Number(a.impact || 0));
}

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function normalizeProbabilityParts(homeRaw, drawRaw, awayRaw) {
  const total = Math.max(1, homeRaw + drawRaw + awayRaw);
  let homeWin = Math.round((homeRaw / total) * 100);
  let draw = Math.round((drawRaw / total) * 100);
  let awayWin = 100 - homeWin - draw;
  if (awayWin < 0) {
    awayWin = 0;
    draw = 100 - homeWin;
  }
  return { homeWin, draw, awayWin };
}

function buildAiPrediction(db, match, homeTeam, awayTeam, keyPlayers) {
  const existing = match.prediction || {};
  const homeAttack = Number(homeTeam?.attack || 75);
  const awayAttack = Number(awayTeam?.attack || 75);
  const homeDefense = Number(homeTeam?.defense || 75);
  const awayDefense = Number(awayTeam?.defense || 75);
  const homeImpact = keyPlayers.filter((p) => p.teamId === match.home).reduce((sum, p) => sum + Number(p.impact || 0), 0);
  const awayImpact = keyPlayers.filter((p) => p.teamId === match.away).reduce((sum, p) => sum + Number(p.impact || 0), 0);
  const homePower = homeAttack * 0.58 + homeDefense * 0.27 + homeImpact * 0.08 + 3;
  const awayPower = awayAttack * 0.58 + awayDefense * 0.27 + awayImpact * 0.08;
  const gap = homePower - awayPower;
  const drawRaw = clamp(30 - Math.abs(gap) * 0.55, 18, 32);
  const homeRaw = clamp(35 + gap * 0.95, 15, 68);
  const awayRaw = clamp(35 - gap * 0.95, 15, 68);
  const probs = normalizeProbabilityParts(homeRaw, drawRaw, awayRaw);
  const homeGoals = clamp(Math.round((homeAttack / Math.max(55, awayDefense)) * 1.35 + (homeImpact > 0 ? 0.35 : 0)), 0, 4);
  const awayGoals = clamp(Math.round((awayAttack / Math.max(55, homeDefense)) * 1.25 + (awayImpact > 0 ? 0.35 : 0)), 0, 4);
  const featured = keyPlayers.slice(0, 4).map((p) => `${p.name || p.playerCnName || p.englishName}（${getTeam(db, p.teamId)?.name || ""}）`).join("、");
  const homeNames = keyPlayers.filter((p) => p.teamId === match.home).map((p) => p.name || p.playerCnName || p.englishName);
  const awayNames = keyPlayers.filter((p) => p.teamId === match.away).map((p) => p.name || p.playerCnName || p.englishName);
  const favorite = probs.homeWin === Math.max(probs.homeWin, probs.awayWin, probs.draw)
    ? homeTeam?.name
    : probs.awayWin === Math.max(probs.homeWin, probs.awayWin, probs.draw)
      ? awayTeam?.name
      : "平局";
  const upset = Math.abs(probs.homeWin - probs.awayWin) <= 8 ? "高波动" : Math.abs(probs.homeWin - probs.awayWin) <= 16 ? "中等波动" : "低波动";
  const goals = homeGoals + awayGoals >= 3 ? "进球数偏高" : homeGoals + awayGoals <= 1 ? "小比分倾向" : "进球数中性";
  const keyText = featured
    ? `本场关键球员关注：${featured}。${homeTeam?.name || "主队"}${homeNames.length ? `有${homeNames.join("、")}参与进攻/防守核心` : "暂无已上线球员币核心"}；${awayTeam?.name || "客队"}${awayNames.length ? `有${awayNames.join("、")}提供关键变量` : "暂无已上线球员币核心"}。`
    : "双方暂未匹配到已上线球员币，预测主要依据球队攻防评分、赛程阶段与实时赛果状态。";
  const text = `${homeTeam?.name || "主队"} vs ${awayTeam?.name || "客队"}：模型倾向${favorite}方向。${keyText} 综合攻防评分、已上线球员影响力和主客场基准，当前胜率为主胜 ${probs.homeWin}% / 平局 ${probs.draw}% / 客胜 ${probs.awayWin}%。`;
  return {
    ...existing,
    ...probs,
    score: existing.score && match.status === "已完场" ? existing.score : `${homeGoals}-${awayGoals}`,
    goals,
    upset,
    keyPlayers: keyPlayers.map((p) => p.id),
    text,
    model: "GBC data-driven match model v1",
    updatedAt: new Date().toISOString()
  };
}

function getPlayer(db, id) {
  return db.players.find((item) => item.id === id);
}

function enrichMatch(db, match) {
  if (!match) return null;
  const homeTeam = getTeam(db, match.home);
  const awayTeam = getTeam(db, match.away);
  const existingKeyPlayerIds = ((match.prediction && match.prediction.keyPlayers) || []);
  const liveKeyPlayers = [
    ...existingKeyPlayerIds.map((id) => getPlayer(db, id)).filter(Boolean),
    ...getTeamLivePlayers(db, match.home),
    ...getTeamLivePlayers(db, match.away)
  ];
  const dedupedPlayers = Array.from(new Map(liveKeyPlayers.map((player) => [player.id, player])).values())
    .filter((player) => player && player.image)
    .sort((a, b) => Number(b.impact || 0) - Number(a.impact || 0));
  const prediction = buildAiPrediction(db, match, homeTeam, awayTeam, dedupedPlayers);
  const keyPlayers = dedupedPlayers.map((player) => ({
    ...player,
    team: getTeam(db, player.teamId),
    predictionText: `${player.name || player.playerCnName || player.englishName}是${getTeam(db, player.teamId)?.name || "该队"}已上线/重点球员，本场影响力 ${player.impact || 0}。${player.summary || "重点关注其在关键回合中的表现。"}`
  }));
  return {
    ...match,
    prediction,
    homeTeam,
    awayTeam,
    keyPlayers,
    aiTendency: getAiTendency({ ...match, prediction }, homeTeam, awayTeam)
  };
}

function isPlaceholderTeamName(name) {
  return /^[A-L][123]$/.test(name || "")
    || /[A-L][123]\//.test(name || "")
    || /\/[A-L][123]/.test(name || "")
    || /第\d+场/.test(name || "");
}

function isDisplayableMatch(db, match) {
  if (!match || !match.day || !match.time || !match.home || !match.away) return false;
  const home = getTeam(db, match.home);
  const away = getTeam(db, match.away);
  if (!home || !away || !home.name || !away.name) return false;
  if (isPlaceholderTeamName(home.name) || isPlaceholderTeamName(away.name)) return false;
  return true;
}

function getAiTendency(match, homeTeam, awayTeam) {
  const { homeWin, draw, awayWin } = match.prediction;
  const max = Math.max(homeWin, draw, awayWin);
  if (max === homeWin) return `${homeTeam.name}不败倾向`;
  if (max === awayWin) return `${awayTeam.name}不败倾向`;
  return "平局防守倾向";
}

function parseScore(score) {
  const normalized = String(score || "").replace(/\s/g, "").replace("：", ":").replace("－", "-");
  const parts = normalized.split(/[-:]/).map(Number);
  if (parts.length !== 2 || parts.some(Number.isNaN)) return null;
  return { home: parts[0], away: parts[1], normalized: `${parts[0]}-${parts[1]}` };
}

function resultFromScore(score) {
  const parsed = parseScore(score);
  if (!parsed) return "";
  if (parsed.home > parsed.away) return "home";
  if (parsed.home < parsed.away) return "away";
  return "draw";
}

function resultLabel(result) {
  return { home: "主胜", draw: "平局", away: "客胜" }[result] || "未知";
}

function settlePrediction(db, prediction) {
  const match = db.matches.find((item) => item.id === prediction.matchId);
  if (!match || match.status !== "已完场" || !match.score) {
    return {
      ...prediction,
      status: "pending",
      resultLabel: resultLabel(prediction.result),
      points: 0
    };
  }

  const actualScore = parseScore(match.score);
  const predictedScore = parseScore(prediction.score);
  const actualResult = resultFromScore(match.score);
  const resultHit = prediction.result === actualResult;
  const scoreHit = actualScore && predictedScore && actualScore.normalized === predictedScore.normalized;
  const points = (resultHit ? db.settings.points.resultHit : 0) + (scoreHit ? db.settings.points.scoreHit : 0);

  return {
    ...prediction,
    status: "settled",
    resultLabel: resultLabel(prediction.result),
    actualResult,
    actualScore: actualScore ? actualScore.normalized : match.score,
    resultHit,
    scoreHit,
    points
  };
}

function getUserDisplayName(user) {
  if (!user) return "微信用户";
  return user.nickname || user.nickName || user.name || `用户${String(user.userId || user.openid || "").slice(-6)}`;
}

async function exchangeWechatCode(code) {
  const appid = process.env.WECHAT_APPID;
  const secret = process.env.WECHAT_SECRET;
  if (!appid || !secret) {
    return {
      openid: `dev_${hashText(code || "anonymous")}`,
      session_key: "dev-session",
      isDev: true
    };
  }
  if (!code) throw new Error("缺少微信登录 code");
  const endpoint = `https://api.weixin.qq.com/sns/jscode2session?appid=${encodeURIComponent(appid)}&secret=${encodeURIComponent(secret)}&js_code=${encodeURIComponent(code)}&grant_type=authorization_code`;
  const response = await fetch(endpoint);
  if (!response.ok) throw new Error(`微信登录接口异常：${response.status}`);
  const data = await response.json();
  if (data.errcode) throw new Error(`微信登录失败：${data.errmsg || data.errcode}`);
  if (!data.openid) throw new Error("微信登录未返回 openid");
  return data;
}

function upsertUser(db, session, profile = {}) {
  if (!db.users) db.users = [];
  const openid = session.openid;
  const existingIndex = db.users.findIndex((item) => item.openid === openid);
  const now = new Date().toISOString();
  const existing = existingIndex >= 0 ? db.users[existingIndex] : null;
  const user = {
    ...(existing || {}),
    userId: existing?.userId || `u_${hashText(openid)}`,
    openid,
    unionid: session.unionid || existing?.unionid || "",
    nickname: profile.nickName || profile.nickname || existing?.nickname || "微信用户",
    avatarUrl: profile.avatarUrl || existing?.avatarUrl || "",
    city: profile.city || existing?.city || "",
    province: profile.province || existing?.province || "",
    country: profile.country || existing?.country || "",
    lastLoginAt: now,
    createdAt: existing?.createdAt || now,
    source: session.isDev ? "dev-login" : "wechat-login"
  };
  if (existingIndex >= 0) db.users[existingIndex] = user;
  else db.users.push(user);
  return user;
}

function publicUser(user) {
  if (!user) return null;
  const inviteCode = user.userId;
  return {
    userId: user.userId,
    inviteCode,
    nickname: user.nickname,
    avatarUrl: user.avatarUrl,
    lastLoginAt: user.lastLoginAt,
    createdAt: user.createdAt
  };
}

function ensureInviteStore(db) {
  if (!db.invites) db.invites = [];
  if (!db.settings) db.settings = {};
  if (!db.settings.points) db.settings.points = { resultHit: 50, scoreHit: 100 };
  if (!db.settings.points.inviteBonus) db.settings.points.inviteBonus = 20;
}

function getInviteStats(db, userId) {
  ensureInviteStore(db);
  const sent = db.invites.filter((item) => item.inviterId === userId && item.status === "valid");
  const received = db.invites.find((item) => item.invitedUserId === userId && item.status === "valid") || null;
  return {
    inviteBonus: db.settings.points.inviteBonus,
    validInviteCount: sent.length,
    invitePoints: sent.reduce((sum, item) => sum + Number(item.points || 0), 0),
    invitedBy: received ? received.inviterId : ""
  };
}

function processInvite(db, inviterId, invitedUserId) {
  ensureInviteStore(db);
  if (!inviterId || !invitedUserId) return { applied: false, reason: "empty" };
  if (inviterId === invitedUserId) return { applied: false, reason: "self" };
  const inviter = (db.users || []).find((item) => item.userId === inviterId);
  const invited = (db.users || []).find((item) => item.userId === invitedUserId);
  if (!inviter || !invited) return { applied: false, reason: "user-not-found" };
  const alreadyInvited = db.invites.find((item) => item.invitedUserId === invitedUserId && item.status === "valid");
  if (alreadyInvited) return { applied: false, reason: "already-invited" };
  const duplicatePair = db.invites.find((item) => item.inviterId === inviterId && item.invitedUserId === invitedUserId);
  if (duplicatePair) return { applied: false, reason: "duplicate" };
  const now = new Date().toISOString();
  const invite = {
    id: `inv_${Date.now()}_${hashText(`${inviterId}_${invitedUserId}`)}`,
    inviterId,
    invitedUserId,
    points: db.settings.points.inviteBonus,
    status: "valid",
    createdAt: now
  };
  db.invites.push(invite);
  return { applied: true, invite };
}

function publicUserWithStats(db, user) {
  const base = publicUser(user);
  if (!base) return null;
  return {
    ...base,
    inviteStats: getInviteStats(db, user.userId)
  };
}

function readUserIdFromReq(req, query) {
  return query.userId || req.headers["x-gbc-user-id"] || "demo-user";
}

function buildLeaderboard(db) {
  ensureInviteStore(db);
  const byUser = new Map();
  (db.users || []).forEach((user) => {
    byUser.set(user.userId, {
      userId: user.userId,
      name: getUserDisplayName(user),
      avatarUrl: user.avatarUrl || "",
      points: 0,
      predictionPoints: 0,
      invitePoints: getInviteStats(db, user.userId).invitePoints,
      inviteCount: getInviteStats(db, user.userId).validInviteCount,
      settled: 0,
      hits: 0
    });
  });
  db.predictions.map((item) => settlePrediction(db, item)).forEach((item) => {
    const user = (db.users || []).find((entry) => entry.userId === item.userId);
    const current = byUser.get(item.userId) || {
      userId: item.userId,
      name: item.nickname || getUserDisplayName(user),
      avatarUrl: user?.avatarUrl || "",
      points: 0,
      predictionPoints: 0,
      invitePoints: getInviteStats(db, item.userId).invitePoints,
      inviteCount: getInviteStats(db, item.userId).validInviteCount,
      settled: 0,
      hits: 0
    };
    current.predictionPoints += item.points || 0;
    if (item.status === "settled") current.settled += 1;
    if (item.resultHit) current.hits += 1;
    byUser.set(item.userId, current);
  });

  return Array.from(byUser.values())
    .map((item) => ({
      ...item,
      points: (item.predictionPoints || 0) + (item.invitePoints || 0)
    }))
    .filter((item) => item.points > 0 || item.settled > 0 || item.inviteCount > 0)
    .sort((a, b) => b.points - a.points || b.hits - a.hits || String(a.name).localeCompare(String(b.name)))
    .map((item, index) => ({
      rank: index + 1,
      userId: item.userId,
      name: item.name,
      avatarUrl: item.avatarUrl,
      points: item.points,
      predictionPoints: item.predictionPoints,
      invitePoints: item.invitePoints,
      inviteCount: item.inviteCount,
      hitRate: item.settled ? `${Math.round((item.hits / item.settled) * 100)}%` : "0%",
      hits: item.hits,
      settled: item.settled
    }));
}

function parseBaiduScheduleHtml(html) {
  const normalizedText = decodeUnicodeEscapes(decodeHtml(html))
    .replace(/<style[\s\S]*?<\/style>/gi, "\n")
    .replace(/<[^>]+>/g, "\n")
    .replace(/[{}[\]",:]/g, " ")
    .replace(/\s+/g, " ");

  const lines = normalizedText
    .split(/\n+/)
    .map((line) => line.replace(/\s+/g, " ").trim())
    .filter(Boolean);

  const matches = [];
  let currentDay = "";
  const dateRegex = /(\d{2})-(\d{2})\/([\u4e00-\u9fa5A-Za-z0-9]+)/;
  const matchLineRegex = /(\d{2}:\d{2})\s+([\u4e00-\u9fa5A-Za-z0-9]+组(?:第\d+轮)?|[\u4e00-\u9fa5A-Za-z0-9]+赛(?:第\d+轮)?|[\u4e00-\u9fa5A-Za-z0-9]+)\s+([\u4e00-\u9fa5A-Za-z·（）()]+)\s+([-\d]+)\s+([\u4e00-\u9fa5A-Za-z·（）()]+)\s+([-\d]+)\s+(已结束|已完场|完场|未开赛|进行中|中场|延期|取消)/;
  const matchRegex = /(\d{2}:\d{2})\s+([\u4e00-\u9fa5A-Za-z0-9]+组(?:第\d+轮)?|[\u4e00-\u9fa5A-Za-z0-9]+赛(?:第\d+轮)?|[\u4e00-\u9fa5A-Za-z0-9]+)\s+([\u4e00-\u9fa5A-Za-z·（）()]+)\s+([-\d]+)\s+([\u4e00-\u9fa5A-Za-z·（）()]+)\s+([-\d]+)\s+(已结束|已完场|完场|未开赛|进行中|中场|延期|取消)/g;

  lines.forEach((line) => {
    const dateMatch = line.match(dateRegex);
    if (dateMatch) {
      currentDay = `${dateMatch[1]}月${dateMatch[2]}日 ${dateMatch[3]}`;
      return;
    }

    const item = line.match(matchLineRegex);
    if (!item || !currentDay) return;

    const [, time, stage, homeName, homeScore, awayName, awayScore, rawStatus] = item;
    const status = ["已结束", "已完场", "完场"].includes(rawStatus)
      ? "已完场"
      : rawStatus;
    const score = homeScore === "-" || awayScore === "" || awayScore === "-"
      ? ""
      : `${homeScore}-${awayScore}`;

    matches.push({
      time,
      day: currentDay,
      stage,
      homeName,
      awayName,
      status,
      score,
      source: "baidu",
      sourceKey: `${currentDay}-${time}-${homeName}-${awayName}`
    });
  });

  if (matches.length) return matches;

  const fullText = normalizedText.replace(/\s+/g, " ");
  const dateMatches = [];
  let dateItem;
  const dateGlobalRegex = /(\d{2})-(\d{2})\/([\u4e00-\u9fa5A-Za-z0-9]+)/g;
  while ((dateItem = dateGlobalRegex.exec(fullText))) {
    dateMatches.push({
      index: dateItem.index,
      day: `${dateItem[1]}月${dateItem[2]}日 ${dateItem[3]}`
    });
  }

  const parsed = [];
  let matchItem;
  while ((matchItem = matchRegex.exec(fullText))) {
    const nearestDate = dateMatches
      .filter((item) => item.index <= matchItem.index)
      .pop();
    if (!nearestDate) continue;
    const [, time, stage, homeName, homeScore, awayName, awayScore, rawStatus] = matchItem;
    const status = ["已结束", "已完场", "完场"].includes(rawStatus)
      ? "已完场"
      : rawStatus;
    const score = homeScore === "-" || awayScore === "-" ? "" : `${homeScore}-${awayScore}`;
    parsed.push({
      time,
      day: nearestDate.day,
      stage,
      homeName,
      awayName,
      status,
      score,
      source: "baidu",
      sourceKey: `${nearestDate.day}-${time}-${homeName}-${awayName}`
    });
  }

  return parsed;
}

async function fetchBaiduSchedule() {
  const response = await fetch(BAIDU_WORLD_CUP_URL, {
    headers: {
      "User-Agent": "Mozilla/5.0 GoldenBootCupBot/1.0",
      "Accept-Language": "zh-CN,zh;q=0.9"
    }
  });
  if (!response.ok) {
    throw new Error(`百度体育返回异常：${response.status}`);
  }
  const html = await response.text();
  return parseBaiduScheduleHtml(html);
}

function parseCctvScheduleHtml(html) {
  const text = decodeUnicodeEscapes(decodeHtml(html))
    .replace(/<style[\s\S]*?<\/style>/gi, "\n")
    .replace(/<[^>]+>/g, "\n")
    .replace(/[{}[\]",:]/g, " ")
    .replace(/\s+/g, " ");

  const dateMarks = [];
  const dateRegex = /(2026[-/.年]\d{1,2}[-/.月]\d{1,2}日?|\d{1,2}月\d{1,2}日|\d{2}[-/]\d{2})/g;
  let dateItem;
  while ((dateItem = dateRegex.exec(text))) {
    dateMarks.push({ index: dateItem.index, raw: dateItem[1] });
  }

  function normalizeDay(raw) {
    const value = String(raw || "");
    const monthDay = value.match(/(\d{1,2})月(\d{1,2})日?/);
    if (monthDay) return `${monthDay[1].padStart(2, "0")}月${monthDay[2].padStart(2, "0")}日`;
    const slashDay = value.match(/(?:2026[-/.年])?(\d{1,2})[-/.月](\d{1,2})/);
    if (slashDay) return `${slashDay[1].padStart(2, "0")}月${slashDay[2].padStart(2, "0")}日`;
    return value;
  }

  const matchRegex = /(\d{1,2}:\d{2})\s+([\u4e00-\u9fa5A-Za-z0-9]+(?:组|赛|决赛|名赛|轮)?)\s+([\u4e00-\u9fa5A-Za-z·（）()]+)\s+([-\d]+|VS|vs|对)\s+([\u4e00-\u9fa5A-Za-z·（）()]+)(?:\s+([-\d]+))?(?:\s+(未开始|未开赛|进行中|已结束|已完场|完场|中场|延期|取消))?/g;
  const matches = [];
  let item;
  while ((item = matchRegex.exec(text))) {
    const nearestDate = dateMarks.filter((mark) => mark.index <= item.index).pop();
    const [, time, stage, homeName, middle, awayName, maybeAwayScore, rawStatus] = item;
    let score = "";
    let status = rawStatus || "未开始";
    if (/^\d+$/.test(middle) && /^\d+$/.test(maybeAwayScore || "")) {
      score = `${middle}-${maybeAwayScore}`;
      status = status || "已完场";
    }
    if (["已结束", "已完场", "完场"].includes(status)) status = "已完场";
    if (status === "未开赛") status = "未开始";

    matches.push({
      time: time.padStart(5, "0"),
      day: nearestDate ? normalizeDay(nearestDate.raw) : "",
      stage,
      homeName,
      awayName,
      status,
      score,
      source: "cctv",
      sourceKey: `${nearestDate ? normalizeDay(nearestDate.raw) : ""}-${time}-${homeName}-${awayName}`
    });
  }

  return matches.filter((match, index, list) => {
    return match.homeName !== match.awayName
      && list.findIndex((item) => item.sourceKey === match.sourceKey) === index;
  });
}

function parseScheduleText(rawText, source = "manual") {
  const text = decodeUnicodeEscapes(decodeHtml(rawText))
    .replace(/[|,，]/g, " ")
    .replace(/\s+/g, " ");

  const matches = [];
  const dateMarks = [];
  const dateRegex = /(\d{1,2}月\d{1,2}日|\d{2}[-/]\d{2})/g;
  let dateItem;
  while ((dateItem = dateRegex.exec(text))) {
    dateMarks.push({ index: dateItem.index, raw: dateItem[1] });
  }

  function normalizeDay(raw) {
    const monthDay = String(raw || "").match(/(\d{1,2})月(\d{1,2})日?/);
    if (monthDay) return `${monthDay[1].padStart(2, "0")}月${monthDay[2].padStart(2, "0")}日`;
    const slashDay = String(raw || "").match(/(\d{1,2})[-/](\d{1,2})/);
    if (slashDay) return `${slashDay[1].padStart(2, "0")}月${slashDay[2].padStart(2, "0")}日`;
    return raw;
  }

  const patterns = [
    /(\d{1,2}:\d{2})\s+([\u4e00-\u9fa5A-Za-z0-9]+(?:组|赛|决赛|名赛|轮)?)\s+([\u4e00-\u9fa5A-Za-z·（）()]+)\s+(\d+)\s*[-:比]\s*(\d+)\s+([\u4e00-\u9fa5A-Za-z·（）()]+)(?:\s+(已结束|已完场|完场|未开始|未开赛|进行中|中场|延期|取消))?/g,
    /(\d{1,2}:\d{2})\s+([\u4e00-\u9fa5A-Za-z0-9]+(?:组|赛|决赛|名赛|轮)?)\s+([\u4e00-\u9fa5A-Za-z·（）()]+)\s+(\d+)\s+(\d+)\s+([\u4e00-\u9fa5A-Za-z·（）()]+)(?:\s+(已结束|已完场|完场|未开始|未开赛|进行中|中场|延期|取消))?/g,
    /(\d{1,2}:\d{2})\s+([\u4e00-\u9fa5A-Za-z0-9]+(?:组|赛|决赛|名赛|轮)?)\s+([\u4e00-\u9fa5A-Za-z·（）()]+)\s+(?:VS|vs|对|-)\s+([\u4e00-\u9fa5A-Za-z·（）()]+)(?:\s+(未开始|未开赛|进行中|中场|延期|取消))?/g
  ];

  patterns.forEach((regex, patternIndex) => {
    let item;
    while ((item = regex.exec(text))) {
      const nearestDate = dateMarks.filter((mark) => mark.index <= item.index).pop();
      let time;
      let stage;
      let homeName;
      let awayName;
      let score = "";
      let status = "未开始";
      if (patternIndex === 0 || patternIndex === 1) {
        time = item[1];
        stage = item[2];
        homeName = item[3];
        awayName = item[6];
        score = `${item[4]}-${item[5]}`;
        status = item[7] || "已完场";
      } else {
        time = item[1];
        stage = item[2];
        homeName = item[3];
        awayName = item[4];
        status = item[5] || "未开始";
      }
      if (["已结束", "已完场", "完场"].includes(status)) status = "已完场";
      if (status === "未开赛") status = "未开始";
      const day = nearestDate ? normalizeDay(nearestDate.raw) : "";
      matches.push({
        time: time.padStart(5, "0"),
        day,
        stage,
        homeName,
        awayName,
        status,
        score,
        source,
        sourceKey: `${source}-${day}-${time}-${homeName}-${awayName}`
      });
    }
  });

  return matches.filter((match, index, list) => {
    return match.homeName !== match.awayName
      && list.findIndex((item) => item.sourceKey === match.sourceKey) === index;
  });
}

function valueByKeys(object, keys) {
  const normalized = Object.keys(object || {});
  for (const key of normalized) {
    const lower = key.toLowerCase();
    if (keys.some((name) => lower === name || lower.includes(name))) {
      return object[key];
    }
  }
  return "";
}

function displayName(value) {
  if (!value) return "";
  if (typeof value === "string") return value.trim();
  if (typeof value === "object") {
    return String(value.name || value.cnName || value.zhName || value.title || value.teamName || "").trim();
  }
  return String(value).trim();
}

function collectScheduleObjects(value, output = []) {
  if (!value || typeof value !== "object") return output;
  if (Array.isArray(value)) {
    value.forEach((item) => collectScheduleObjects(item, output));
    return output;
  }

  const home = displayName(valueByKeys(value, ["home", "hometeam", "teama", "host", "主队"]));
  const away = displayName(valueByKeys(value, ["away", "awayteam", "teamb", "guest", "客队"]));
  const time = displayName(valueByKeys(value, ["time", "matchtime", "starttime", "开赛"]));
  const date = displayName(valueByKeys(value, ["date", "day", "matchdate", "比赛日"]));
  const stage = displayName(valueByKeys(value, ["stage", "round", "group", "phase", "轮次", "阶段"])) || "世界杯";
  const statusRaw = displayName(valueByKeys(value, ["status", "state", "matchstatus", "状态"]));
  const scoreRaw = displayName(valueByKeys(value, ["score", "比分"]));
  const homeScore = displayName(valueByKeys(value, ["homescore", "scorehome", "主队比分"]));
  const awayScore = displayName(valueByKeys(value, ["awayscore", "scoreaway", "客队比分"]));

  if (home && away && (time || date || scoreRaw || homeScore || awayScore)) {
    let score = scoreRaw;
    if (!score && homeScore !== "" && awayScore !== "") score = `${homeScore}-${awayScore}`;
    let status = statusRaw || "未开始";
    if (["已结束", "已完场", "完场"].includes(status)) status = "已完场";
    if (status === "未开赛") status = "未开始";
    output.push({
      time: time.match(/\d{1,2}:\d{2}/) ? time.match(/\d{1,2}:\d{2}/)[0].padStart(5, "0") : "",
      day: date,
      stage,
      homeName: home,
      awayName: away,
      status,
      score,
      source: "golden",
      sourceKey: `golden-${date}-${time}-${home}-${away}`
    });
  }

  Object.keys(value).forEach((key) => collectScheduleObjects(value[key], output));
  return output;
}

function parseGoldenBootScheduleHtml(html) {
  const decoded = decodeUnicodeEscapes(decodeHtml(html));
  const parsed = [];
  const jsonScripts = [...decoded.matchAll(/<script[^>]*(?:application\/json|__NEXT_DATA__)[^>]*>([\s\S]*?)<\/script>/gi)];

  jsonScripts.forEach((match) => {
    try {
      const json = JSON.parse(match[1].trim());
      parsed.push(...collectScheduleObjects(json));
    } catch (error) {
      // Ignore non-JSON scripts.
    }
  });

  parsed.push(...parseScheduleText(decoded, "golden"));

  return parsed.filter((match, index, list) => {
    return match.homeName && match.awayName
      && match.homeName !== match.awayName
      && list.findIndex((item) => item.sourceKey === match.sourceKey) === index;
  });
}

async function fetchGoldenBootSchedule() {
  const response = await fetch(GOLDEN_BOOT_SCHEDULE_URL, {
    headers: {
      "User-Agent": "Mozilla/5.0 GoldenBootCupBot/1.0",
      "Accept-Language": "zh-CN,zh;q=0.9"
    }
  });
  if (!response.ok) {
    throw new Error(`金靴杯官网返回异常：${response.status}`);
  }
  const html = await response.text();
  return parseGoldenBootScheduleHtml(html);
}

async function fetchCctvSchedule() {
  const response = await fetch(CCTV_WORLD_CUP_URL, {
    headers: {
      "User-Agent": "Mozilla/5.0 GoldenBootCupBot/1.0",
      "Accept-Language": "zh-CN,zh;q=0.9"
    }
  });
  if (!response.ok) {
    throw new Error(`CCTV 返回异常：${response.status}`);
  }
  const html = await response.text();
  return parseCctvScheduleHtml(html);
}

function normalizeChineseStatus(statusRaw) {
  const status = String(statusRaw || "");
  if (["finished", "已结束", "已完场", "完场"].includes(status)) return "已完场";
  if (["live", "进行中", "中场"].includes(status)) return "进行中";
  if (["cancelled", "取消"].includes(status)) return "取消";
  if (["postponed", "延期"].includes(status)) return "延期";
  return "未开始";
}

function formatChinaDay(dateValue, fallbackText = "") {
  const rawDate = String(dateValue || "").slice(0, 10);
  const dateMatch = rawDate.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!dateMatch) return fallbackText || rawDate;
  const date = new Date(`${rawDate}T00:00:00+08:00`);
  const weekNames = ["周日", "周一", "周二", "周三", "周四", "周五", "周六"];
  return `${Number(dateMatch[2])}月${Number(dateMatch[3])}日 ${weekNames[date.getDay()]}`;
}

function normalizeStageName(match) {
  const stage = String(match.stage || "");
  const group = String(match.group || "");
  if (stage && group && !stage.includes(group)) return `${stage} ${group}`;
  return stage || group || "世界杯";
}

function normalizeGoldenBootApiMatch(match) {
  const scoreA = Number(match.scoreA || 0);
  const scoreB = Number(match.scoreB || 0);
  const status = normalizeChineseStatus(match.status || match.statusText);
  const score = status === "已完场" || status === "进行中" ? `${scoreA}-${scoreB}` : "";
  const date = String(match.date || "").slice(0, 10);
  const time = String(match.time || "").slice(0, 5);
  const homeName = match.teamA || match.homeName || "";
  const awayName = match.teamB || match.awayName || "";

  return {
    time,
    day: formatChinaDay(date, match.dateText || ""),
    date,
    stage: normalizeStageName(match),
    homeName,
    awayName,
    status,
    score,
    source: "golden",
    sourceKey: `golden-api-${match.id || `${date}-${time}-${homeName}-${awayName}`}`,
    raw: match
  };
}

async function fetchGoldenBootApiSchedule() {
  const response = await fetch(GOLDEN_BOOT_SCHEDULE_API, {
    headers: {
      "User-Agent": "Mozilla/5.0 GoldenBootCupBot/1.0",
      "Accept": "application/json"
    }
  });
  if (!response.ok) {
    throw new Error(`金靴杯官网赛程 API 返回异常：${response.status}`);
  }
  const data = await response.json();
  return (data.matches || [])
    .map(normalizeGoldenBootApiMatch)
    .filter((match) => match.homeName && match.awayName && match.date && match.time);
}

function upsertSyncedMatches(db, syncedMatches) {
  let created = 0;
  let updated = 0;
  syncedMatches.forEach((item) => {
    const home = ensureTeam(db, item.homeName);
    const away = ensureTeam(db, item.awayName);
    const source = item.source || "baidu";
    const idPrefix = source === "cctv" ? "cctv" : source === "golden" ? "gb" : "bd";
    const id = `${idPrefix}_${hashText(item.sourceKey)}`;
    const existingIndex = db.matches.findIndex((match) => match.id === id || match.sourceKey === item.sourceKey);
    const existing = existingIndex >= 0 ? db.matches[existingIndex] : null;
    const baseMatch = {
      ...(existing || {}),
      id: existing ? existing.id : id,
      source,
      sourceKey: item.sourceKey,
      date: item.date || existing?.date || "",
      day: item.day,
      time: item.time,
      stage: item.stage,
      home: home.id,
      away: away.id,
      status: item.status,
      venue: existing ? existing.venue : "",
      score: item.score,
      prediction: existing && existing.prediction ? existing.prediction : {
        homeWin: 34,
        draw: 32,
        awayWin: 34,
        score: "",
        goals: "待生成",
        upset: "待评估",
        keyPlayers: [],
        text: "赛程已自动同步，AI预测等待后台生成。"
      }
    };
    baseMatch.prediction = buildAiPrediction(db, baseMatch, home, away, [
      ...getTeamLivePlayers(db, home.id),
      ...getTeamLivePlayers(db, away.id)
    ]);
    if (existingIndex >= 0) {
      db.matches[existingIndex] = baseMatch;
      updated += 1;
    } else {
      db.matches.push(baseMatch);
      created += 1;
    }
  });
  return { created, updated };
}

function serveStatic(req, res, pathname) {
  const filePath = pathname === "/" ? path.join(PUBLIC_DIR, "index.html") : path.join(PUBLIC_DIR, pathname);
  const normalized = path.normalize(filePath);
  if (!normalized.startsWith(PUBLIC_DIR)) {
    sendText(res, "Forbidden", 403);
    return;
  }
  if (!fs.existsSync(normalized) || fs.statSync(normalized).isDirectory()) {
    sendText(res, "Not found", 404);
    return;
  }
  const ext = path.extname(normalized).toLowerCase();
  const types = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8"
  };
  sendText(res, fs.readFileSync(normalized), 200, types[ext] || "application/octet-stream");
}

async function syncGoldenBootScheduleIntoDb(db, options = {}) {
  const ttlMs = Number(options.ttlMs ?? 5 * 60 * 1000);
  const now = Date.now();
  const lastSyncAt = db.settings?.lastGoldenScheduleSyncAt ? Date.parse(db.settings.lastGoldenScheduleSyncAt) : 0;
  if (!options.force && lastSyncAt && now - lastSyncAt < ttlMs) {
    return { skipped: true, reason: "fresh", fetched: 0, created: 0, updated: 0 };
  }

  const syncedMatches = await fetchGoldenBootApiSchedule();
  if (!syncedMatches.length) {
    throw new Error("没有从金靴杯官网赛程 API 读取到比赛。");
  }

  const result = upsertSyncedMatches(db, syncedMatches);
  db.settings.lastGoldenScheduleSyncAt = new Date().toISOString();
  db.settings.lastGoldenScheduleSource = GOLDEN_BOOT_SCHEDULE_API;
  delete db.settings.lastGoldenScheduleSyncError;
  writeDb(db);
  return { source: GOLDEN_BOOT_SCHEDULE_API, fetched: syncedMatches.length, ...result };
}

async function handleApi(req, res, pathname, query) {
  const db = readDb();

  if (req.method === "GET" && pathname === "/api/health") {
    sendJson(res, { ok: true, app: db.settings.appName });
    return;
  }

  if (req.method === "GET" && pathname === "/api/home") {
    const displayableMatches = db.matches.filter((item) => isDisplayableMatch(db, item));
    const liveMatch = displayableMatches.find((item) => item.status === "进行中") || displayableMatches[0];
    sendJson(res, {
      liveMatch: enrichMatch(db, liveMatch),
      todayMatches: displayableMatches.slice(0, 5).map((item) => enrichMatch(db, item)),
      leaderboard: buildLeaderboard(db).slice(0, 5)
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/auth/wechat-login") {
    const body = await readBody(req);
    const session = await exchangeWechatCode(body.code || "");
    const user = upsertUser(db, session, body.profile || {});
    const inviteCode = String(body.inviteCode || body.inviterId || "").trim();
    const inviteResult = inviteCode ? processInvite(db, inviteCode, user.userId) : { applied: false, reason: "empty" };
    writeDb(db);
    sendJson(res, { user: publicUserWithStats(db, user), inviteResult, devMode: Boolean(session.isDev) });
    return;
  }

  if (req.method === "POST" && pathname === "/api/users/me") {
    const body = await readBody(req);
    const userId = body.userId || req.headers["x-gbc-user-id"];
    const index = (db.users || []).findIndex((item) => item.userId === userId);
    if (index < 0) {
      sendJson(res, { error: "用户不存在，请先登录" }, 404);
      return;
    }
    const profile = body.profile || {};
    db.users[index] = {
      ...db.users[index],
      nickname: profile.nickname || profile.nickName || db.users[index].nickname,
      avatarUrl: profile.avatarUrl || db.users[index].avatarUrl,
      updatedAt: new Date().toISOString()
    };
    writeDb(db);
    sendJson(res, { user: publicUserWithStats(db, db.users[index]) });
    return;
  }

  if (req.method === "GET" && pathname === "/api/admin/users") {
    const users = (db.users || []).map((user) => ({
      ...publicUserWithStats(db, user),
      predictionCount: (db.predictions || []).filter((item) => item.userId === user.userId).length,
      totalPoints: (db.predictions || [])
        .filter((item) => item.userId === user.userId)
        .map((item) => settlePrediction(db, item))
        .reduce((sum, item) => sum + (item.points || 0), 0)
    }));
    sendJson(res, { users });
    return;
  }

  if (req.method === "GET" && pathname === "/api/matches") {
    try {
      await syncGoldenBootScheduleIntoDb(db);
    } catch (error) {
      db.settings.lastGoldenScheduleSyncError = error.message || "自动同步赛程失败";
      writeDb(db);
    }

    const stage = query.stage || "";
    const status = query.status || "";
    const matches = db.matches
      .filter((item) => isDisplayableMatch(db, item))
      .filter((item) => !stage || stage === "全部" || item.stage.includes(stage))
      .filter((item) => !status || status === "全部" || item.status === status)
      .map((item) => enrichMatch(db, item));
    sendJson(res, { matches });
    return;
  }

  if (req.method === "GET" && pathname.startsWith("/api/matches/")) {
    const id = pathname.split("/").pop();
    const match = enrichMatch(db, db.matches.find((item) => item.id === id));
    if (!match) {
      sendJson(res, { error: "比赛不存在" }, 404);
      return;
    }
    sendJson(res, { match });
    return;
  }

  if (req.method === "GET" && pathname === "/api/teams") {
    sendJson(res, { teams: db.teams });
    return;
  }

  if (req.method === "GET" && pathname === "/api/players") {
    sendJson(res, { players: db.players.map((item) => ({ ...item, team: getTeam(db, item.teamId) })) });
    return;
  }

  if (req.method === "GET" && pathname === "/api/ai-dashboard") {
    try {
      await syncGoldenBootScheduleIntoDb(db);
    } catch (error) {
      db.settings.lastGoldenScheduleSyncError = error.message || "自动同步赛程失败";
      writeDb(db);
    }
    const matches = db.matches
      .filter((item) => isDisplayableMatch(db, item))
      .map((item) => enrichMatch(db, item))
      .sort((a, b) => String(a.date || a.day || "").localeCompare(String(b.date || b.day || "")) || String(a.time || "").localeCompare(String(b.time || "")));
    const focusMatches = matches.filter((match) => match.status === "进行中" || match.status === "未开始").slice(0, 12);
    const headline = focusMatches.find((match) => match.keyPlayers && match.keyPlayers.length) || focusMatches[0] || matches[0] || null;
    const topPlayers = (db.players || [])
      .filter(isLivePlayer)
      .slice()
      .sort((a, b) => Number(b.impact || 0) - Number(a.impact || 0))
      .slice(0, 8)
      .map((player) => ({ ...player, team: getTeam(db, player.teamId) }));
    sendJson(res, {
      fetchedAt: new Date().toISOString(),
      daily: headline ? {
        title: `最值得关注：${headline.homeTeam.name} vs ${headline.awayTeam.name}`,
        text: headline.prediction.text,
        tags: [headline.prediction.upset, headline.prediction.goals, headline.aiTendency].filter(Boolean)
      } : {
        title: "等待实时赛程",
        text: "后台会自动同步赛程、赛果，并结合已上线球员生成AI预测。",
        tags: ["实时赛程", "AI预测", "关键球员"]
      },
      matches: focusMatches,
      topPlayers
    });
    return;
  }

  if (req.method === "GET" && pathname === "/api/predictions") {
    const userId = readUserIdFromReq(req, query);
    const predictions = db.predictions
      .filter((item) => item.userId === userId)
      .map((item) => settlePrediction(db, item));
    sendJson(res, { predictions });
    return;
  }

  if (req.method === "POST" && pathname === "/api/predictions") {
    const body = await readBody(req);
    const match = db.matches.find((item) => item.id === body.matchId);
    if (!match) {
      sendJson(res, { error: "比赛不存在" }, 400);
      return;
    }
    if (!["home", "draw", "away"].includes(body.result)) {
      sendJson(res, { error: "请选择胜平负" }, 400);
      return;
    }
    if (!parseScore(body.score)) {
      sendJson(res, { error: "比分格式应类似 2-1" }, 400);
      return;
    }
    const userId = body.userId || req.headers["x-gbc-user-id"] || "demo-user";
    const user = (db.users || []).find((item) => item.userId === userId);
    const existingIndex = db.predictions.findIndex((item) => item.userId === userId && item.matchId === body.matchId);
    const prediction = {
      id: existingIndex >= 0 ? db.predictions[existingIndex].id : `p_${Date.now()}`,
      userId,
      nickname: body.nickname || getUserDisplayName(user),
      matchId: body.matchId,
      result: body.result,
      score: parseScore(body.score).normalized,
      createdAt: new Date().toISOString()
    };
    if (existingIndex >= 0) db.predictions[existingIndex] = prediction;
    else db.predictions.push(prediction);
    writeDb(db);
    sendJson(res, { prediction: settlePrediction(db, prediction) });
    return;
  }

  if (req.method === "GET" && pathname === "/api/leaderboard") {
    const userId = readUserIdFromReq(req, query);
    const leaderboard = buildLeaderboard(db).map((item) => ({
      ...item,
      isMe: Boolean(userId && item.userId === userId)
    }));
    sendJson(res, { leaderboard });
    return;
  }

  if (req.method === "GET" && pathname === "/api/invites/me") {
    const userId = readUserIdFromReq(req, query);
    const user = (db.users || []).find((item) => item.userId === userId);
    if (!user) {
      sendJson(res, { error: "用户不存在，请先登录" }, 404);
      return;
    }
    sendJson(res, { inviteStats: getInviteStats(db, userId), inviteCode: userId });
    return;
  }

  if (req.method === "POST" && pathname === "/api/admin/sync/baidu") {
    const syncedMatches = await fetchBaiduSchedule();
    if (!syncedMatches.length) {
      sendJson(res, {
        error: "没有从百度页面解析到比赛。可能是页面结构变化、接口反爬或网络返回了空壳页面。",
        source: BAIDU_WORLD_CUP_URL
      }, 422);
      return;
    }
    const result = upsertSyncedMatches(db, syncedMatches);
    writeDb(db);
    sendJson(res, {
      source: BAIDU_WORLD_CUP_URL,
      fetched: syncedMatches.length,
      ...result
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/admin/sync/cctv") {
    const syncedMatches = await fetchCctvSchedule();
    if (!syncedMatches.length) {
      sendJson(res, {
        error: "没有从 CCTV 页面解析到比赛。可能是页面改成动态接口、网络返回空壳页面，或结构与当前解析规则不一致。",
        source: CCTV_WORLD_CUP_URL
      }, 422);
      return;
    }
    const result = upsertSyncedMatches(db, syncedMatches);
    writeDb(db);
    sendJson(res, {
      source: CCTV_WORLD_CUP_URL,
      fetched: syncedMatches.length,
      ...result
    });
    return;
  }

  if (req.method === "POST" && pathname === "/api/admin/sync/golden") {
    const result = await syncGoldenBootScheduleIntoDb(db, { force: true });
    sendJson(res, result);
    return;
  }

  if (req.method === "GET" && pathname === "/api/admin/sync/golden") {
    const result = await syncGoldenBootScheduleIntoDb(db, { force: true });
    sendJson(res, result);
    return;
  }

  if (req.method === "PUT" && pathname.startsWith("/api/admin/matches/")) {
    const id = pathname.split("/").pop();
    const body = await readBody(req);
    const index = db.matches.findIndex((item) => item.id === id);
    if (index < 0) {
      sendJson(res, { error: "比赛不存在" }, 404);
      return;
    }
    db.matches[index] = {
      ...db.matches[index],
      ...body,
      prediction: {
        ...db.matches[index].prediction,
        ...(body.prediction || {})
      }
    };
    writeDb(db);
    sendJson(res, { match: enrichMatch(db, db.matches[index]) });
    return;
  }

  sendJson(res, { error: "接口不存在" }, 404);
}

const server = http.createServer(async (req, res) => {
  const parsed = url.parse(req.url, true);
  const pathname = decodeURIComponent(parsed.pathname);

  if (req.method === "OPTIONS") {
    sendJson(res, { ok: true });
    return;
  }

  try {
    if (pathname.startsWith("/api/")) {
      await handleApi(req, res, pathname, parsed.query);
      return;
    }
    serveStatic(req, res, pathname);
  } catch (error) {
    sendJson(res, { error: error.message || "服务器错误" }, 500);
  }
});

server.listen(PORT, () => {
  console.log(`Golden Boot Cup admin API running at http://localhost:${PORT}`);
});
