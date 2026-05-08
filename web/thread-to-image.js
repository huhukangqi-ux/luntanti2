/* 论坛体 → 预览 / 导出 PNG（html2canvas）。依赖全局 html2canvas。需 DOM：#tt-input #tt-render #tt-save-png #tt-capture-shell #tt-capture-root #tt-busy */
(function () {
  "use strict";

  function debounce(fn, ms) {
    var t;
    return function () {
      clearTimeout(t);
      var a = arguments;
      t = setTimeout(function () {
        fn.apply(null, a);
      }, ms);
    };
  }

  var inp = document.getElementById("tt-input");
  if (!inp) return;

  var ICON_SHARE =
    '<svg xmlns="http://www.w3.org/2000/svg" width="17" height="17" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8"/><polyline points="16 6 12 2 8 6"/><line x1="12" y1="2" x2="12" y2="15"/></svg>';
  var ICON_LIKE =
    '<svg xmlns="http://www.w3.org/2000/svg" width="19" height="19" viewBox="0 0 24 24" fill="none" stroke="#c4c4c4" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"><path d="M7 11V5a2 2 0 114 0v6M7 11H4v9h3m0-9h4.5L15 6h3l1 5v9h-8.5"/></svg>';

  function navShareHtml() {
    return '<span class="nav-share-row">' + ICON_SHARE + "分享</span>";
  }

  var BOTTOM_BAR =
    '<div class="tt-bottom-bar">' +
    '<div class="tt-bottom-input">说点什么...</div>' +
    '<div class="tt-bottom-ai">AI</div>' +
    "</div>";

  function esc(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/"/g, "&quot;");
  }

  function parseFloorTag(tag) {
    var m = String(tag).match(/【(\d+)L[｜|]([^】]*)】/);
    if (!m) return { n: 0, nick: "" };
    return { n: parseInt(m[1], 10), nick: (m[2] || "").trim() };
  }

  function splitFloorLine(line) {
    if (!/^【\d+L[｜|]/.test(line)) return null;
    var idx = line.indexOf("】");
    if (idx < 0) return null;
    return {
      tag: line.slice(0, idx + 1),
      rest: line.slice(idx + 1).trim(),
    };
  }

  function parseBlocks(text) {
    var lines = text.replace(/\r\n/g, "\n").split("\n");
    var blocks = [];
    var cur = null;
    for (var i = 0; i < lines.length; i++) {
      var line = lines[i];
      var sp = splitFloorLine(line);
      if (sp) {
        cur = { tag: sp.tag, lines: [] };
        if (sp.rest) cur.lines.push(sp.rest);
        blocks.push(cur);
      } else {
        if (!cur) {
          cur = { tag: "【前言】", lines: [] };
          blocks.push(cur);
        }
        cur.lines.push(line);
      }
    }
    return blocks;
  }

  function buildFloorOpMap(blocks, opNick) {
    var m = {};
    for (var i = 0; i < blocks.length; i++) {
      var bm = parseFloorTag(blocks[i].tag);
      if (bm.n <= 0) continue;
      m[bm.n] = !!(opNick && bm.nick === opNick);
    }
    return m;
  }

  function normalizeReplyLine(line) {
    var m = String(line || "").match(/^回复\s*(\d+)\s*楼[：:](.*)$/);
    if (m) return m[1] + "楼：" + m[2];
    return line;
  }

  function splitQuoteMain(raw, floorOpMap) {
    raw = raw.replace(/\r\n/g, "\n").trim();
    if (!raw) return { quote: null, main: "" };
    var lines = raw.split("\n");
    if (lines.length) lines[0] = normalizeReplyLine(lines[0]);
    var m = lines[0].match(/^(\d+)楼[：:](.*)$/);
    if (!m) return { quote: null, main: raw };
    var qf = parseInt(m[1], 10);
    return {
      quote: {
        floor: qf,
        text: lines[0],
        quotedIsOp: !!floorOpMap[qf],
      },
      main: lines.slice(1).join("\n").trim(),
    };
  }

  function buildReplyHtml(floorLabel, isOpReply, raw, floorOpMap) {
    var qm = splitQuoteMain(raw, floorOpMap);
    var h = [];
    h.push('<article class="tt-reply-item">');
    h.push('<div class="tt-reply-meta">');
    h.push('<span class="tt-floor-num">' + esc(floorLabel) + "</span>");
    if (isOpReply) h.push('<span class="tt-badge-op">楼主</span>');
    h.push("</div>");
    if (qm.quote) {
      h.push('<div class="tt-quote-box"><div class="tt-quote-inner">');
      if (qm.quote.quotedIsOp) {
        h.push('<span class="tt-badge-op-in-quote">楼主</span>');
      }
      h.push('<span class="tt-quote-text">' + esc(qm.quote.text) + "</span>");
      h.push("</div></div>");
    }
    var mainText = qm.quote ? qm.main : raw;
    if (mainText) {
      h.push('<div class="tt-reply-body">' + esc(mainText) + "</div>");
    }
    h.push('<div class="tt-reply-like">' + ICON_LIKE + "</div>");
    h.push("</article>");
    return h.join("");
  }

  function splitTitleBody(rawBody) {
    var t = rawBody.replace(/\r\n/g, "\n").trimEnd();
    if (!t) return { title: "", body: "" };
    var nl = t.indexOf("\n");
    if (nl < 0) return { title: "", body: t };
    return {
      title: t.slice(0, nl).trim(),
      body: t.slice(nl + 1).trim(),
    };
  }

  function renderCapture(text) {
    var root = document.getElementById("tt-capture-root");
    if (!root) return;
    var trimmed = text.trim();
    if (!trimmed) {
      root.innerHTML = '<div class="tt-q-section"><p style="color:#9ca3af;padding:16px;">暂无内容</p></div>';
      return;
    }

    var blocks = parseBlocks(trimmed);
    var hasOp = blocks.some(function (b) {
      return parseFloorTag(b.tag).n === 1 && /^【\d+L[｜|]/.test(b.tag);
    });

    if (blocks.length && !hasOp) {
      var fb = [];
      fb.push('<div class="tt-fake-nav">');
      fb.push('<span class="nav-placeholder">〈</span>');
      fb.push("<span></span>");
      fb.push(navShareHtml());
      fb.push("</div>");
      fb.push('<div class="tt-scroll-body">');
      fb.push('<section class="tt-q-section">');
      for (var fj = 0; fj < blocks.length; fj++) {
        var fbb = blocks[fj];
        var fbr = fbb.lines.join("\n").trimEnd();
        fb.push('<div class="tt-fallback-block">');
        fb.push('<div class="small-tag">' + esc(fbb.tag) + "</div>");
        fb.push('<div class="tt-reply-body">' + esc(fbr || " ") + "</div>");
        fb.push("</div>");
      }
      fb.push("</section>");
      fb.push("</div>");
      fb.push(BOTTOM_BAR);
      root.innerHTML = fb.join("");
      return;
    }

    var opNick0 = "";
    for (var zx = 0; zx < blocks.length; zx++) {
      var bzx = parseFloorTag(blocks[zx].tag);
      if (bzx.n === 1 && /^【\d+L[｜|]/.test(blocks[zx].tag)) {
        opNick0 = bzx.nick;
        break;
      }
    }
    var floorOpMap = buildFloorOpMap(blocks, opNick0);

    var parts = [];

    parts.push('<div class="tt-fake-nav">');
    parts.push('<span class="nav-placeholder">〈</span>');
    parts.push("<span></span>");
    parts.push(navShareHtml());
    parts.push("</div>");
    parts.push('<div class="tt-scroll-body">');

    var opName = "";
    var replyStarted = false;

    for (var i = 0; i < blocks.length; i++) {
      var b = blocks[i];
      var bm = parseFloorTag(b.tag);
      var raw = b.lines.join("\n").trimEnd();
      var isOp = bm.n === 1 && /^【\d+L[｜|]/.test(b.tag);

      if (isOp) {
        opName = bm.nick || opName;
        var split = splitTitleBody(raw);
        parts.push('<section class="tt-q-section">');
        parts.push('<div class="tt-op-row">');
        parts.push('<div class="tt-avatar"></div>');
        parts.push('<div class="tt-op-name">' + esc(opName || "楼主") + "</div>");
        parts.push("</div>");
        if (split.title) {
          parts.push('<h2 class="tt-op-title">' + esc(split.title) + "</h2>");
          parts.push('<div class="tt-op-body">' + esc(split.body || " ") + "</div>");
        } else {
          parts.push('<div class="tt-op-single">' + esc(raw || " ") + "</div>");
        }
        parts.push("</section>");
        continue;
      }

      if (!replyStarted) {
        parts.push('<div class="tt-reply-headline">回帖区</div>');
        parts.push('<div class="tt-reply-list">');
        replyStarted = true;
      }

      var floorLabel =
        bm.n > 0
          ? bm.n + "楼 · " + (bm.nick || "匿名")
          : String(b.tag || "");
      var isOpReply = opName && bm.nick === opName;
      parts.push(buildReplyHtml(floorLabel, isOpReply, raw, floorOpMap));
    }

    if (replyStarted) {
      parts.push("</div>");
    }

    parts.push("</div>");
    parts.push(BOTTOM_BAR);

    root.innerHTML = parts.join("");
  }

  var SAMPLE =
    "【1L｜剑奴001】\n老婆假装不认识我怎么办\n掌门大师姐的霜华剑丢了！！封山搜查中我只能匿名问一句有没有见过霜华——在线等。\n\n【31L｜修仙爆料姬】\n别瞎猜了行不行。\n\n【32L｜剑奴001】\n31楼：别瞎猜了行不行\n嗯…闭嘴 🤫\n\n【33L｜路过的鹅】\n32楼：嗯…闭嘴 🤫\n爸爸妈妈我来啦！！我不会剧透身份的。\n\n【34L｜修仙爆料姬】\n你们戏别太多。";

  var btnRender = document.getElementById("tt-render");
  var btnSave = document.getElementById("tt-save-png");
  var btnClear = document.getElementById("tt-clear");
  if (!btnRender || !btnSave) return;

  btnRender.addEventListener("click", function () {
    renderCapture(inp.value);
  });

  if (btnClear) {
    btnClear.addEventListener("click", function () {
      inp.value = "";
      renderCapture("");
      var busy = document.getElementById("tt-busy");
      if (busy) busy.textContent = "";
    });
  }

  inp.addEventListener(
    "input",
    debounce(function () {
      renderCapture(inp.value);
    }, 200)
  );

  function downloadCanvasAsSingleLongImage(sourceCanvas, baseName, done, onError) {
    try {
      var a = document.createElement("a");
      a.download = "forum-thread-" + (baseName || Date.now()) + "-long.png";
      a.href = sourceCanvas.toDataURL("image/png");
      a.click();
      done && done();
    } catch (e) {
      onError && onError(e);
    }
  }

  function downloadCanvasAsPhoneScreens(sourceCanvas, baseName, done, onError) {
    var RW = 9;
    var RH = 16;
    var W = sourceCanvas.width;
    var totalH = sourceCanvas.height;
    if (totalH <= 0 || W <= 0) {
      onError(new Error("画布尺寸无效"));
      return;
    }
    var pageH = Math.max(1, Math.floor((W * RH) / RW));
    var slices = [];
    for (var y = 0; y < totalH; y += pageH) {
      slices.push(Math.min(pageH, totalH - y));
    }

    var ts = typeof baseName === "string" && baseName ? baseName : String(Date.now());
    var pad = Math.max(2, String(slices.length).length);
    function zpad(n) {
      var s = String(n);
      while (s.length < pad) s = "0" + s;
      return s;
    }

    try {
      for (var i = 0; i < slices.length; i++) {
        (function (idx, sliceH) {
          var out = document.createElement("canvas");
          out.width = W;
          out.height = pageH;
          var ox = out.getContext("2d");
          ox.fillStyle = "#f3f4f6";
          ox.fillRect(0, 0, W, pageH);
          ox.drawImage(
            sourceCanvas,
            0,
            idx * pageH,
            W,
            sliceH,
            0,
            0,
            W,
            sliceH
          );
          var name = "forum-thread-" + ts + "-" + zpad(idx + 1) + ".png";
          var dataUrl = out.toDataURL("image/png");
          setTimeout(function () {
            try {
              var a = document.createElement("a");
              a.download = name;
              a.href = dataUrl;
              a.click();
              if (idx === slices.length - 1) {
                done(slices.length);
              }
            } catch (err) {
              onError(err);
            }
          }, idx * 400);
        })(i, slices[i]);
      }
    } catch (e) {
      onError(e);
    }
  }

  btnSave.addEventListener("click", function () {
    var shell = document.getElementById("tt-capture-shell");
    var busy = document.getElementById("tt-busy");
    if (typeof html2canvas === "undefined") {
      busy.textContent = "html2canvas 未加载，请检查网络。";
      return;
    }

    var choice = window.prompt("请选择下载方式：\n1 = 一张完整长图\n2 = 多张 9:16 短图", "1");
    if (choice == null) return;
    choice = String(choice).trim();
    if (choice !== "1" && choice !== "2") {
      busy.textContent = "已取消：请输入 1 或 2 选择下载方式。";
      return;
    }

    busy.textContent = "正在生成 PNG…";
    var ts = Date.now();
    html2canvas(shell, {
      scale: Math.min(2, window.devicePixelRatio || 2),
      useCORS: true,
      allowTaint: true,
      backgroundColor: "#f3f4f6",
      logging: false,
    })
      .then(function (canvas) {
        if (choice === "1") {
          downloadCanvasAsSingleLongImage(
            canvas,
            String(ts),
            function () {
              busy.textContent = "已保存 1 张完整长图。";
            },
            function (e) {
              busy.textContent = "导出失败：" + (e && e.message ? e.message : e);
            }
          );
          return;
        }

        downloadCanvasAsPhoneScreens(
          canvas,
          String(ts),
          function (n) {
            busy.textContent =
              "已保存 " + n + " 张（每张约手机竖屏 9:16）。若只出现一张，请在浏览器里允许多文件下载。";
          },
          function (e) {
            busy.textContent = "导出失败：" + (e && e.message ? e.message : e);
          }
        );
      })
      .catch(function (e) {
        busy.textContent =
          "失败（内容过长或跨域）：" +
          (e && e.message ? e.message : e) +
          " —— 可先缩短文本后再试";
      });
  });

  window.ShemeiThreadImage = { renderCapture: renderCapture };
  renderCapture("");
})();




