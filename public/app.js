const $ = (selector) => document.querySelector(selector);

let matches = [];

async function api(path, options = {}) {
  const response = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options
  });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "请求失败");
  return data;
}

function optionLabel(value) {
  return { home: "主胜", draw: "平局", away: "客胜" }[value] || value;
}

async function loadAll() {
  const [matchData, rankData, predictionData] = await Promise.all([
    api("/api/matches"),
    api("/api/leaderboard"),
    api("/api/predictions?userId=demo-user")
  ]);
  matches = matchData.matches;
  renderStats(rankData.leaderboard);
  renderMatches();
  renderMatchSelect();
  renderLeaderboard(rankData.leaderboard);
  renderPredictions(predictionData.predictions);
}

function showSyncMessage(message, isError = false) {
  const box = $("#syncMessage");
  box.textContent = message;
  box.classList.add("show");
  box.style.color = isError ? "#ff8b8b" : "#24e18a";
  box.style.borderColor = isError ? "rgba(255, 109, 109, 0.2)" : "rgba(36, 225, 138, 0.18)";
  box.style.background = isError ? "rgba(255, 109, 109, 0.08)" : "rgba(36, 225, 138, 0.08)";
}

function renderStats(leaderboard) {
  $("#matchCount").textContent = matches.length;
  $("#liveCount").textContent = matches.filter((item) => item.status === "进行中").length;
  $("#doneCount").textContent = matches.filter((item) => item.status === "已完场").length;
  $("#rankCount").textContent = leaderboard.length;
}

function renderMatches() {
  $("#matches").innerHTML = matches.map((match) => `
    <article class="match-card" data-id="${match.id}">
      <div class="match-title">
        <span>${match.homeTeam.name} vs ${match.awayTeam.name}</span>
        <span>${match.score || match.time}</span>
      </div>
      <div class="match-meta">${match.stage} · ${match.day} · ${match.venue}</div>
      <div class="prob">
        <span>主胜 ${match.prediction.homeWin}%</span>
        <span>平 ${match.prediction.draw}%</span>
        <span>客胜 ${match.prediction.awayWin}%</span>
      </div>
      <div class="match-controls">
        <select class="status-input">
          ${["未开始", "进行中", "已完场"].map((status) => `<option ${match.status === status ? "selected" : ""}>${status}</option>`).join("")}
        </select>
        <input class="score-input" value="${match.score || ""}" placeholder="比分 2-1" />
        <button class="save-match">保存</button>
      </div>
    </article>
  `).join("");

  document.querySelectorAll(".save-match").forEach((button) => {
    button.addEventListener("click", async (event) => {
      const card = event.target.closest(".match-card");
      const id = card.dataset.id;
      const status = card.querySelector(".status-input").value;
      const score = card.querySelector(".score-input").value;
      await api(`/api/admin/matches/${id}`, {
        method: "PUT",
        body: JSON.stringify({ status, score })
      });
      await loadAll();
    });
  });
}

function renderMatchSelect() {
  $("#matchSelect").innerHTML = matches.map((match) => `
    <option value="${match.id}">${match.homeTeam.name} vs ${match.awayTeam.name}</option>
  `).join("");
}

function renderLeaderboard(items) {
  const list = items || [];
  $("#leaderboard").innerHTML = list.map((item) => `
    <div class="rank-row ${item.rank <= 3 ? 'top-rank' : ''}">
      <div class="rank-no">${item.rank}</div>
      <div class="rank-main">
        <strong>${item.name}</strong>
        <span>总积分 ${item.points} · 赛果积分 ${item.predictionPoints || 0} · 邀请积分 ${item.invitePoints || 0} · 命中率 ${item.hitRate}</span>
      </div>
      <div class="rank-score">${item.points}</div>
    </div>
  `).join("") || "<p class=\"empty-text\">暂无真实排行榜数据。用户完成观赛判断或邀请好友后会自动上榜。</p>";
}

function renderPredictions(items) {
  $("#predictions").innerHTML = items.map((item) => `
    <div class="prediction-row">
      <div class="prediction-main">
        <strong>${item.matchId} · ${optionLabel(item.result)} · ${item.score}</strong>
        <span>
          <i class="tag ${item.resultHit ? "" : "miss"}">${item.status === "settled" ? (item.resultHit ? "方向判断正确" : "方向判断未中") : "待更新"}</i>
          ${item.status === "settled" ? `<i class="tag ${item.scoreHit ? "" : "miss"}">${item.scoreHit ? "比分命中" : "比分未中"}</i>` : ""}
          ${item.actualScore ? `赛果 ${item.actualScore}` : ""}
        </span>
      </div>
      <div class="prediction-score">+${item.points || 0}</div>
    </div>
  `).join("") || "<p>暂无预测记录</p>";
}

$("#refreshBtn").addEventListener("click", loadAll);
$("#refreshRankBtn").addEventListener("click", loadAll);

$("#syncGoldenBtn").addEventListener("click", async () => {
  const button = $("#syncGoldenBtn");
  button.disabled = true;
  button.textContent = "同步中...";
  showSyncMessage("正在同步赛程和赛果，请稍等。");
  try {
    const result = await api("/api/admin/sync/golden", { method: "POST" });
    showSyncMessage(`赛程同步完成：抓取 ${result.fetched} 场，新增 ${result.created} 场，更新 ${result.updated} 场。`);
    await loadAll();
  } catch (error) {
    showSyncMessage(`${error.message} 请稍后重试，或检查金靴杯官网赛程接口。`, true);
  } finally {
    button.disabled = false;
    button.textContent = "同步赛程";
  }
});

$("#predictionForm").addEventListener("submit", async (event) => {
  event.preventDefault();
  await api("/api/predictions", {
    method: "POST",
    body: JSON.stringify({
      userId: "demo-user",
      nickname: $("#nicknameInput").value || "后台测试用户",
      matchId: $("#matchSelect").value,
      result: $("#resultSelect").value,
      score: $("#scoreInput").value
    })
  });
  await loadAll();
});

loadAll().catch((error) => {
  alert(error.message);
});
