import { getFsGrade } from "./analysis";

export async function exportToHtmlFile(
  title: string,
  data: any[],
  type: "portfolio" | "scanner" | "fundamental" | "hybrid" | "aiAlpha"
): Promise<string> {
  let rowsHtml = "";

  if (type === "portfolio") {
    for (const r of data) {
      const cleanSym = r.symbol.split(".")[0];
      const curPrice = r.current_price > 0 ? `$${r.current_price.toFixed(2)}` : "N/A";
      const fsGrade = r.fs_grade !== "N/A" ? r.fs_grade : "N/A";
      const fsScore = r.fs_grade !== "N/A" ? `${r.fs_score > 0 ? "+" : ""}${r.fs_score}` : "-";
      const techRating = r.suggestion !== "-" ? r.suggestion : "N/A";

      const gradeClass = getGradeClass(fsGrade);
      const techClass = getTechClass(techRating);

      rowsHtml += `
        <tr>
          <td><span style="font-weight: 600; color: #4d94ff;">${cleanSym}</span></td>
          <td>${r.name}</td>
          <td>${curPrice}</td>
          <td><span class="badge ${gradeClass}">${fsGrade} (評分:${fsScore})</span></td>
          <td><span class="badge ${techClass}">${techRating}</span></td>
        </tr>
      `;
    }
  } else if (type === "aiAlpha") {
    for (const r of data) {
      const cleanSym = r.symbol.replace(/\.(TW|TWO)$/, "");
      const winPct = r.winRatePct !== undefined ? `${r.winRatePct.toFixed(1)}%` : "-";
      const alphaPct = r.expectedAlphaPct !== undefined ? `${r.expectedAlphaPct >= 0 ? "+" : ""}${r.expectedAlphaPct.toFixed(1)}%` : "-";
      const drivers = r.positiveDrivers?.slice(0, 2).join("、") || r.riskDrivers?.slice(0, 2).join("、") || "-";

      rowsHtml += `
        <tr>
          <td><b>#${r.rank || "-"}</b></td>
          <td><span style="font-weight: 700; color: #38bdf8;">${cleanSym}</span></td>
          <td><b>${r.name}</b></td>
          <td><span class="badge" style="background:#7c3aed;color:#fff;font-weight:bold;">${r.convictionTier}</span></td>
          <td><span style="color:#38bdf8;font-weight:bold;">${winPct}</span></td>
          <td><span style="color:#4ade80;font-weight:bold;">${alphaPct}</span></td>
          <td style="font-size:0.8rem;color:#cbd5e1;">${drivers}</td>
        </tr>
      `;
    }
  } else if (type === "scanner") {
    for (const r of data) {
      const cleanSym = r.symbol.split(".")[0];
      const fundG = r.fundScore !== undefined ? getFsGrade(r.fundScore) : "N/A";
      const fundS = r.fundScore !== undefined ? `${r.fundScore > 0 ? "+" : ""}${r.fundScore}` : "-";
      const techRating = r.score;

      const gradeClass = getGradeClass(fundG);
      const techClass = getTechClass(techRating);

      rowsHtml += `
        <tr>
          <td><span style="font-weight: 600; color: #4d94ff;">${cleanSym}</span></td>
          <td>${r.name}</td>
          <td><span class="badge badge-mode-${r.mode}">${getModeLabel(r.mode)}</span></td>
          <td><span class="badge ${gradeClass}">${fundG} (評分:${fundS})</span></td>
          <td><span class="badge ${techClass}">${techRating}</span></td>
        </tr>
      `;
    }
  } else if (type === "fundamental") {
    for (const r of data) {
      const cleanSym = r.symbol.split(".")[0];
      const fundG = r.grade;
      const fundS = `${r.score > 0 ? "+" : ""}${r.score}`;

      const gradeClass = getGradeClass(fundG);

      rowsHtml += `
        <tr>
          <td><span style="font-weight: 600; color: #4d94ff;">${cleanSym}</span></td>
          <td>${r.name}</td>
          <td><span class="badge ${gradeClass}">${fundG} (評分:${fundS})</span></td>
          <td style="font-size: 0.8rem; color: rgba(255,255,255,0.7); max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;" title="${r.reasons.join("、")}">${r.reasons.join("、") || "-"}</td>
          <td style="font-size: 0.8rem; color: #ef9a9a;">${r.warnings.join(" | ") || "-"}</td>
        </tr>
      `;
    }
  } else if (type === "hybrid") {
    for (const r of data) {
      const cleanSym = r.symbol.split(".")[0];
      const fundG = r.fsGrade;
      const fundS = `${r.fsScore > 0 ? "+" : ""}${r.fsScore}`;
      const techRating = r.techRating;
      const hybridScore = (r.hybridScore !== null && r.hybridScore !== undefined && !isNaN(r.hybridScore)) ? `${r.hybridScore > 0 ? "+" : ""}${r.hybridScore.toFixed(1)}` : "N/A";

      const gradeClass = getGradeClass(fundG);
      const techClass = getTechClass(techRating);

      rowsHtml += `
        <tr>
          <td><span style="font-weight: 600; color: #4d94ff;">${cleanSym}</span></td>
          <td>${r.name}</td>
          <td><span class="badge ${gradeClass}">${fundG} (評分:${fundS})</span></td>
          <td><span class="badge ${techClass}">${techRating}</span></td>
          <td><span class="badge badge-hybrid">${hybridScore}分</span></td>
        </tr>
      `;
    }
  }

  let thHeaders = "";
  if (type === "aiAlpha") {
    thHeaders = `
      <th>排名</th>
      <th>股票代號</th>
      <th>名稱</th>
      <th>AI 評級</th>
      <th>20日勝率</th>
      <th>預估 Alpha</th>
      <th>核心驅動因子</th>
    `;
  } else if (type === "portfolio") {
    thHeaders = `
      <th>股票代號</th>
      <th>股名</th>
      <th>收盤現價</th>
      <th>基本面評級</th>
      <th>技術面評比</th>
    `;
  } else if (type === "scanner") {
    thHeaders = `
      <th>股票代號</th>
      <th>股名</th>
      <th>掃描模式</th>
      <th>基本面評級</th>
      <th>技術評分</th>
    `;
  } else if (type === "fundamental") {
    thHeaders = `
      <th>股票代號</th>
      <th>股名</th>
      <th>基本面評級</th>
      <th>符合項目</th>
      <th>警示項目</th>
    `;
  } else if (type === "hybrid") {
    thHeaders = `
      <th>股票代號</th>
      <th>股名</th>
      <th>基本面評級</th>
      <th>技術面評比</th>
      <th>綜合得分</th>
    `;
  }

  const htmlContent = `<!DOCTYPE html>
<html lang="zh-TW">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${title}</title>
  <style>
    body {
      background-color: #09090f;
      color: rgba(255, 255, 255, 0.9);
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Arial, "Noto Sans TC", sans-serif;
      margin: 0;
      padding: 40px 20px;
      display: flex;
      justify-content: center;
    }
    .container {
      width: 100%;
      max-width: 960px;
      background: rgba(20, 20, 32, 0.85);
      border: 1px solid rgba(255, 255, 255, 0.08);
      border-radius: 16px;
      padding: 28px;
      box-shadow: 0 10px 40px rgba(0, 0, 0, 0.5);
      backdrop-filter: blur(8px);
    }
    h1 {
      font-size: 1.7rem;
      margin-top: 0;
      color: #80b3ff;
      border-bottom: 2px solid rgba(255, 255, 255, 0.08);
      padding-bottom: 14px;
      margin-bottom: 8px;
    }
    .meta {
      font-size: 0.85rem;
      color: rgba(255, 255, 255, 0.45);
      margin-bottom: 24px;
    }
    table {
      width: 100%;
      border-collapse: collapse;
      margin-top: 10px;
      text-align: left;
    }
    th, td {
      padding: 14px 16px;
      border-bottom: 1px solid rgba(255, 255, 255, 0.06);
    }
    th {
      color: rgba(255, 255, 255, 0.55);
      font-weight: 600;
      background: rgba(255, 255, 255, 0.02);
    }
    tr:hover {
      background: rgba(255, 255, 255, 0.015);
    }
    .badge {
      display: inline-block;
      padding: 5px 10px;
      border-radius: 6px;
      font-size: 0.78rem;
      font-weight: 600;
    }
    
    /* Grades */
    .badge-s { background: rgba(206, 147, 216, 0.15); color: #ce93d8; border: 1px solid rgba(206, 147, 216, 0.35); }
    .badge-a { background: rgba(144, 202, 249, 0.15); color: #90caf9; border: 1px solid rgba(144, 202, 249, 0.35); }
    .badge-b { background: rgba(129, 199, 132, 0.15); color: #81c784; border: 1px solid rgba(129, 199, 132, 0.35); }
    .badge-c { background: rgba(255, 215, 64, 0.15); color: #ffd740; border: 1px solid rgba(255, 215, 64, 0.35); }
    .badge-d { background: rgba(255, 171, 64, 0.15); color: #ffab40; border: 1px solid rgba(255, 171, 64, 0.35); }
    .badge-f { background: rgba(255, 82, 82, 0.15); color: #ef9a9a; border: 1px solid rgba(255, 82, 82, 0.35); }
    .badge-na { background: rgba(255, 255, 255, 0.05); color: rgba(255,255,255,0.4); border: 1px solid rgba(255, 255, 255, 0.08); }

    /* Technical Rating */
    .badge-strong-buy { background: rgba(244, 67, 54, 0.2); color: #ef9a9a; border: 1px solid rgba(244, 67, 54, 0.4); }
    .badge-buy { background: rgba(244, 67, 54, 0.1); color: #ef9a9a; border: 1px solid rgba(244, 67, 54, 0.2); }
    .badge-hold { background: rgba(176, 190, 197, 0.1); color: #cfd8dc; border: 1px solid rgba(176, 190, 197, 0.2); }
    .badge-sell { background: rgba(76, 175, 80, 0.1); color: #a5d6a7; border: 1px solid rgba(76, 175, 80, 0.2); }
    .badge-strong-sell { background: rgba(76, 175, 80, 0.2); color: #a5d6a7; border: 1px solid rgba(76, 175, 80, 0.4); }
    .badge-tech-default { background: rgba(255, 255, 255, 0.06); color: rgba(255,255,255,0.7); }

    /* Modes */
    .badge-mode-buy { background: rgba(244, 67, 54, 0.15); color: #ef5350; padding: 3px 6px; border-radius: 4px; }
    .badge-mode-value { background: rgba(33, 150, 243, 0.15); color: #64b5f6; padding: 3px 6px; border-radius: 4px; }
    .badge-mode-landmine { background: rgba(255, 152, 0, 0.15); color: #ffb74d; padding: 3px 6px; border-radius: 4px; }
    .badge-mode-short { background: rgba(76, 175, 80, 0.15); color: #81c784; padding: 3px 6px; border-radius: 4px; }

    .badge-hybrid { background: rgba(255, 215, 64, 0.15); color: #ffd740; border: 1px solid rgba(255, 215, 64, 0.35); }
  </style>
</head>
<body>
  <div class="container">
    <h1>📊 ${title}</h1>
    <div class="meta">
      資料來源：阿山股市終端機 v2.0 &bull; 產生時間：${new Date().toLocaleString()}
    </div>
    <table>
      <thead>
        <tr>
          ${thHeaders}
        </tr>
      </thead>
      <tbody>
        ${rowsHtml}
      </tbody>
    </table>
  </div>
</body>
</html>`;

  return await htmlContent;
}

function getGradeClass(g: string): string {
  if (g.includes("S")) return "badge-s";
  if (g.includes("A")) return "badge-a";
  if (g.includes("B")) return "badge-b";
  if (g.includes("C")) return "badge-c";
  if (g.includes("D")) return "badge-d";
  if (g.includes("F")) return "badge-f";
  return "badge-na";
}

function getTechClass(t: string): string {
  if (t.includes("強力買進") || t.includes("Strong Buy")) return "badge-strong-buy";
  if (t.includes("偏多") || t.includes("買進") || t.includes("Bullish") || t.includes("+")) return "badge-buy";
  if (t.includes("中性") || t.includes("持有") || t.includes("Hold")) return "badge-hold";
  if (t.includes("強力賣出") || t.includes("建議賣出") || t.includes("Sell")) return "badge-strong-sell";
  if (t.includes("偏空") || t.includes("賣出") || t.includes("Bearish") || t.includes("-")) return "badge-sell";
  return "badge-tech-default";
}

function getModeLabel(m: string): string {
  if (m === "buy") return "📈 多頭掃描";
  if (m === "value") return "💎 價值尋寶";
  if (m === "landmine") return "⚠️ 地雷警示";
  if (m === "short") return "📉 放空機會";
  return m;
}
