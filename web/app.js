(function () {
  "use strict";

  /** 对话走 server/，系统提示含 skill.md + method.md */
  var ENABLE_API = true;

  var CONFIG = {
    STORAGE_KEY: "shemei_skill_bridge_v1",
    CHAT_SESSION_KEY: "shemei_api_chat_v1",
    DEBOUNCE_DELAY: 150,
    TOAST_DURATION: 2400,
    MAX_PREVIEW_LENGTH: 140,
    TITLE_MAX_LENGTH: 48,
    MAX_UPLOAD_BYTES: 2 * 1024 * 1024,
  };

  /** 与页面不同源时，在 index.html 里先于 app.js 设置 window.SHEMEI_API_BASE（无尾斜杠） */
  function getApiBase() {
    if (typeof window === "undefined") return "";
    var raw = window.SHEMEI_API_BASE;
    if (raw == null || !String(raw).trim()) return "";
    return String(raw).trim().replace(/\/+$/, "");
  }

  function apiUrl(path) {
    var p = path.charAt(0) === "/" ? path : "/" + path;
    return getApiBase() + p;
  }

  var composeRawText = "";
  var composeFileName = "";

  var SAMPLE_INSPIRE_BODY =
    "普通人第一次加班到凌晨三点，突然发现办公室茶水间的镜子不会反光——倒映出来的是第二天的自己。\n" +
    "他不知道这是预知还是诅咒，只能匿名发帖求助：有没有人见过「明天的自己」？";

  var DOM = {};

  function cacheDOM() {
    DOM.toast = document.getElementById("toast");
    DOM.preview = document.getElementById("prompt-preview");
    DOM.apiStatus = document.getElementById("api-status");
    DOM.apiChatLog = document.getElementById("api-chat-log");
    DOM.apiError = document.getElementById("api-error");
    DOM.apiUserInput = document.getElementById("api-user-input");
    DOM.libraryList = document.getElementById("library-list");
    DOM.libImportFile = document.getElementById("lib-import-file");
    DOM.composeFile = document.getElementById("compose-file");
    DOM.composeDropzone = document.getElementById("compose-dropzone");
    DOM.composeFileName = document.getElementById("compose-file-name");
    DOM.btnStartCreate = document.getElementById("btn-start-create");
    DOM.forgeApiStatus = document.getElementById("forge-api-status");
    DOM.forgeInspireInput = document.getElementById("forge-inspire-input");
    DOM.btnSaveNovel = document.getElementById("tt-save-novel");
    DOM.vaultWorksCard = document.getElementById("vault-works-card");

    DOM.buttons = {
      copy: document.getElementById("btn-copy"),
      save: document.getElementById("btn-save"),
      apiConfirm: document.getElementById("btn-api-confirm"),
      apiSend: document.getElementById("btn-api-send"),
      apiClear: document.getElementById("btn-api-clear"),
      apiCopyLast: document.getElementById("btn-api-copy-last"),
      libExport: document.getElementById("btn-lib-export"),
      libImport: document.getElementById("btn-lib-import"),
    };
  }

  function $(sel, root) {
    return (root || document).querySelector(sel);
  }

  function $all(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  function debounce(fn, delay) {
    var timer = null;
    return function () {
      var context = this,
        args = arguments;
      clearTimeout(timer);
      timer = setTimeout(function () {
        fn.apply(context, args);
      }, delay);
    };
  }

  function escHtml(s) {
    return String(s)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function slugTitle(text) {
    var first = text.split(/\n/)[0].trim();
    return first.slice(0, CONFIG.TITLE_MAX_LENGTH) || "未命名灵感";
  }

  function generateId() {
    if (typeof crypto !== "undefined" && crypto.randomUUID) {
      return crypto.randomUUID();
    }
    return Date.now().toString(36) + Math.random().toString(36).substr(2, 9);
  }

  var toastTimer = null;

  function showToast(msg, duration) {
    duration = duration || CONFIG.TOAST_DURATION;
    var t = DOM.toast;
    if (!t) return;

    t.textContent = msg;
    t.classList.add("is-on");

    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () {
      t.classList.remove("is-on");
    }, duration);
  }

  function copyText(text) {
    if (!text) {
      showToast("没有可复制内容");
      return Promise.reject(new Error("Empty text"));
    }

    if (navigator.clipboard && navigator.clipboard.writeText) {
      return navigator.clipboard.writeText(text).then(
        function () {
          showToast("已复制到剪贴板");
        },
        function () {
          return fallbackCopy(text);
        }
      );
    }
    return fallbackCopy(text);
  }

  function fallbackCopy(text) {
    return new Promise(function (resolve, reject) {
      var ta = document.createElement("textarea");
      ta.value = text;
      ta.style.cssText = "position:fixed;top:-9999px;left:-9999px;opacity:0;";
      ta.setAttribute("aria-hidden", "true");

      document.body.appendChild(ta);
      ta.select();
      ta.setSelectionRange(0, 99999);

      try {
        var ok = document.execCommand("copy");
        document.body.removeChild(ta);
        if (ok) {
          showToast("已复制到剪贴板");
          resolve();
        } else {
          showToast("复制失败，请手动全选预览区");
          reject(new Error("execCommand failed"));
        }
      } catch (e) {
        document.body.removeChild(ta);
        showToast("复制失败: " + (e.message || "未知错误"));
        reject(e);
      }
    });
  }

  function buildPrompt() {
    var muse = (composeRawText || "").trim();
    var lines = [];

    lines.push("请按本项目 skill.md → method.md 执行全流程（Step1 确认后再 Step2/3/4；可声明不要 Step4）。");
    lines.push("");
    lines.push("—— 素材（来自上传文件）——");
    lines.push(muse || "（请先上传 .txt 或 .md）");
    return lines.join("\n");
  }

  /**
   * 发给 /api/chat 的首条 user：系统提示已含完整 skill+method，此处只带一句闸门与素材，
   * 避免整段「请按 skill…」在对话里重复出现，被误当成「只是把文案复制进聊天框」。
   */
  function buildChatSeedBody() {
    var muse = (composeRawText || "").trim();
    var lines = [];

    lines.push(
      "系统侧已注入 skill.md 与 method.md。请直接按 method「Step1：灵感补全」输出完整 Markdown（须含「## 灵感补全稿」及模板各节），文末按 method 邀请我确认或修改；在我确认前不要进入 Step2。"
    );
    lines.push("");
    lines.push("—— 素材 ——");
    lines.push(muse || "（无）");
    return lines.join("\n");
  }

  function previewUpdate() {
    if (DOM.preview) {
      DOM.preview.textContent = buildPrompt();
    }
  }

  function setComposeFileLabel() {
    var el = DOM.composeFileName;
    if (!el) return;
    el.classList.remove("fp-compose-file-name--error");
    if (composeFileName) {
      el.hidden = false;
      var raw = composeRawText || "";
      var approx = raw.replace(/\s/g, "").length;
      el.textContent =
        "已加载：" +
        composeFileName +
        (approx ? "（约 " + approx + " 字）" : "") +
        " → 请点击右侧「开始创作」发起对话";
    } else {
      el.hidden = true;
      el.textContent = "";
    }
  }

  function syncForgeInspireField() {
    var ta = DOM.forgeInspireInput;
    if (!ta) return;
    var v = composeRawText || "";
    if (ta.value !== v) ta.value = v;
  }

  function applyComposeText(text, name) {
    composeRawText = text == null ? "" : String(text);
    composeFileName = name || "";
    setComposeFileLabel();
    syncForgeInspireField();
    previewUpdate();
  }

  var debouncedInspireSync = debounce(function () {
    previewUpdate();
  }, CONFIG.DEBOUNCE_DELAY);

  function inferRouteAPhase(assistantText) {
    var t = assistantText || "";
    if (/【\s*\d+L[｜|]/.test(t)) {
      return { id: 3, label: "Step3 论坛体正文" };
    }
    if (/Step4|人性化去痕|人性化润色|减少\s*AI\s*感/.test(t)) {
      return { id: 4, label: "Step4 人味润色" };
    }
    if (/论坛体发展大纲|分段节奏/.test(t)) {
      return { id: 2, label: "Step2 大纲" };
    }
    if (/灵感补全稿|##\s*灵感补全|Step1[：:]\s*灵感|阶段\s*B/.test(t)) {
      return { id: 1, label: "Step1 灵感" };
    }
    return { id: 0, label: "对话中" };
  }

  function inferRouteAUserIntent(userText, assistantText) {
    var u = userText || "";
    var a = assistantText || "";
    if (/Step\s*1|step\s*1|灵感补全|系统侧已注入|method「Step1|——\s*素材/.test(u)) {
      return { id: 1, label: "Step1 灵感" };
    }
    if (/Step\s*4|step\s*4|人性化|去痕|AI\s*感|润色/.test(u)) {
      return { id: 4, label: "Step4 人味润色" };
    }
    if (/Step\s*3|step\s*3|正文|论坛体正文|进入\s*3|进\s*3|继续\s*\d*[\s-]*(楼|L)?/.test(u)) {
      return { id: 3, label: "Step3 论坛体正文" };
    }
    if (/Step\s*2|step\s*2|大纲|分段|进入\s*2|进\s*2/.test(u)) {
      return { id: 2, label: "Step2 大纲" };
    }
    if (/确认|可以|继续|开始/.test(u) && /灵感补全稿|##\s*灵感补全|Step1|灵感/.test(a)) {
      return { id: 2, label: "Step2 大纲" };
    }
    return null;
  }

  function inferPendingConfirmation(assistantText) {
    var t = assistantText || "";
    return /请确认|请你确认|待你确认|以上方向|确认后再|回复「确认」|可回复「确认」|确认大纲|指出要改|修改后再|或直接回复|欢迎修改|是否满意|如需继续|请\s*指正/.test(
      t
    );
  }

  function updateForgeRouteAUI() {
    var badge = document.getElementById("forge-step-badge");
    var btnC = document.getElementById("btn-quick-confirm");
    var btnS = document.getElementById("btn-quick-skip-step4");
    var btnF = document.getElementById("btn-quick-focus-reply");
    if (!badge) return;

    var last = API.getLastAssistantMessage();
    var lastUser = API.getLastUserMessage ? API.getLastUserMessage() : "";
    var lastRole =
      API.messages.length > 0 ? API.messages[API.messages.length - 1].role : "";
    var hasAssistantTurn = lastRole === "assistant" && last;

    if (!API.messages.length) {
      badge.textContent = "路线 A · 待定";
      badge.className = "forge-step-pill" + (API.isLoading ? " forge-step-pill--loading" : "");
    } else {
      var intentPhase =
        (API.isLoading || lastRole === "user") && inferRouteAUserIntent(lastUser, last);
      var ph = intentPhase || inferRouteAPhase(last);
      var pending = hasAssistantTurn && inferPendingConfirmation(last);
      badge.textContent = ph.label + (pending ? " · 待确认" : "");
      badge.className = "forge-step-pill" + (pending ? " forge-step-pill--pending" : "") + (API.isLoading ? " forge-step-pill--loading" : "");
    }

    var busy = Boolean(API.isLoading);
    var canQuick = hasAssistantTurn && !busy;

    if (btnC) btnC.disabled = !canQuick;
    if (btnF) btnF.disabled = !API.messages.length || busy;

    var canSkip4 = false;
    if (hasAssistantTurn && !busy) {
      var ph2 = inferRouteAPhase(last);
      canSkip4 = ph2.id >= 3 || /Step4|人性化/.test(last || "");
    }
    if (btnS) btnS.disabled = !canSkip4;
  }

  async function sendQuickUserMessage(text) {
    if (!text || API.isLoading) return;
    API.addUserMessage(text);
    await API.postChat();
  }

  function decodeBytesSmart(buf) {
    var u8 = buf instanceof ArrayBuffer ? new Uint8Array(buf) : new Uint8Array(buf.buffer || buf);
    var start = 0;
    if (u8.length >= 3 && u8[0] === 0xef && u8[1] === 0xbb && u8[2] === 0xbf) {
      start = 3;
    }
    var slice = u8.subarray(start);
    var utf8 = new TextDecoder("utf-8", { fatal: false }).decode(slice);
    var rep = (utf8.match(/\uFFFD/g) || []).length;
    var han = (utf8.match(/[\u4e00-\u9fff]/g) || []).length;

    function tryGbk() {
      try {
        if (typeof TextDecoder === "undefined") return null;
        return new TextDecoder("gbk").decode(slice);
      } catch (_e) {
        return null;
      }
    }

    if (rep >= 3) {
      var gbk = tryGbk();
      if (gbk) {
        var repG = (gbk.match(/\uFFFD/g) || []).length;
        var hanG = (gbk.match(/[\u4e00-\u9fff]/g) || []).length;
        if (repG < rep || hanG > han + 3) return gbk;
      }
    }

    if (slice.length > 30 && han < 3 && rep < 4) {
      var gbk2 = tryGbk();
      if (gbk2) {
        var han2 = (gbk2.match(/[\u4e00-\u9fff]/g) || []).length;
        if (han2 > han + 8) return gbk2;
      }
    }

    return utf8;
  }

  function readFileAsSmartText(file, onOk, onErr) {
    if (file.size > CONFIG.MAX_UPLOAD_BYTES) {
      showToast("文件过大（最大 2MB）");
      onErr && onErr();
      return;
    }
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var text = decodeBytesSmart(reader.result);
        onOk(text);
      } catch (_e) {
        showToast("文件解码失败");
        onErr && onErr();
      }
    };
    reader.onerror = function () {
      showToast("读取文件失败");
      onErr && onErr();
    };
    reader.readAsArrayBuffer(file);
  }

  function handleComposeFile(file) {
    if (!file) return;
    var nameOk = /\.(txt|md|markdown)$/i.test(file.name || "");
    var type = file.type || "";
    var ok =
      /^text\//.test(type) ||
      nameOk ||
      type === "application/json" ||
      (type === "application/octet-stream" && nameOk) ||
      (type === "" && nameOk);
    if (!ok) {
      showToast("仅支持 .txt / .md 文本文件");
      var el = DOM.composeFileName;
      if (el) {
        el.hidden = false;
        el.classList.add("fp-compose-file-name--error");
        el.textContent = "无法载入：请选 .txt 或 .md（当前：" + (file.name || "未命名") + "）";
      }
      return;
    }
    readFileAsSmartText(
      file,
      function (text) {
        applyComposeText(text, file.name);
        showToast("已载入 " + file.name + " · 请点击「开始创作」发起对话", 3600);
        if (DOM.forgeInspireInput) {
          try {
            DOM.forgeInspireInput.focus({ preventScroll: false });
          } catch (_e) {
            DOM.forgeInspireInput.focus();
          }
        }
      },
      function () {}
    );
  }

  function bindComposeUpload() {
    var dz = DOM.composeDropzone;
    var fin = DOM.composeFile;
    if (!dz || !fin) return;

    dz.addEventListener("click", function () {
      fin.click();
    });

    dz.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        fin.click();
      }
    });

    fin.addEventListener("change", function () {
      var f = fin.files && fin.files[0];
      fin.value = "";
      if (f) handleComposeFile(f);
    });

    ["dragenter", "dragover"].forEach(function (ev) {
      dz.addEventListener(ev, function (e) {
        e.preventDefault();
        e.stopPropagation();
        dz.classList.add("is-drag");
      });
    });

    ["dragleave", "drop"].forEach(function (ev) {
      dz.addEventListener(ev, function (e) {
        e.preventDefault();
        e.stopPropagation();
        dz.classList.remove("is-drag");
      });
    });

    dz.addEventListener("drop", function (e) {
      var f = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0];
      if (f) handleComposeFile(f);
    });
  }

  var Storage = {
    loadLibrary: function () {
      try {
        var raw = localStorage.getItem(CONFIG.STORAGE_KEY);
        if (!raw) return [];
        var data = JSON.parse(raw);
        return Array.isArray(data) ? data : [];
      } catch (e) {
        console.warn("读取灵感库失败:", e);
        return [];
      }
    },

    saveLibrary: function (items) {
      try {
        localStorage.setItem(CONFIG.STORAGE_KEY, JSON.stringify(items));
        return true;
      } catch (e) {
        console.error("保存灵感库失败:", e);
        showToast("保存失败，存储可能已满");
        return false;
      }
    },

    loadApiSession: function () {
      try {
        var raw = sessionStorage.getItem(CONFIG.CHAT_SESSION_KEY);
        if (!raw) return [];
        var data = JSON.parse(raw);
        return Array.isArray(data) ? data : [];
      } catch (e) {
        console.warn("读取 API 会话失败:", e);
        return [];
      }
    },

    saveApiSession: function (messages) {
      try {
        sessionStorage.setItem(CONFIG.CHAT_SESSION_KEY, JSON.stringify(messages));
      } catch (e) {
        console.warn("保存 API 会话失败:", e);
      }
    },

    clearApiSession: function () {
      try {
        sessionStorage.removeItem(CONFIG.CHAT_SESSION_KEY);
      } catch (e) {
        console.warn("清除 API 会话失败:", e);
      }
    },
  };

  var Library = {
    createItem: function (body, titleSource) {
      var now = Date.now();
      return {
        id: generateId(),
        t: now,
        iso: new Date(now).toISOString(),
        title: slugTitle(titleSource),
        preview: titleSource.replace(/\s+/g, " ").slice(0, CONFIG.MAX_PREVIEW_LENGTH),
        body: body,
      };
    },

    validateImportItem: function (x) {
      return x && typeof x === "object" && typeof x.id === "string" && typeof x.body === "string";
    },

    normalizeImportItem: function (x) {
      var t = typeof x.t === "number" ? x.t : Date.now();
      var body = x.body;
      var title = typeof x.title === "string" ? x.title : slugTitle(body);
      return {
        id: x.id,
        t: t,
        iso: typeof x.iso === "string" ? x.iso : new Date(t).toISOString(),
        title: title,
        preview:
          typeof x.preview === "string" ? x.preview : body.replace(/\s+/g, " ").slice(0, CONFIG.MAX_PREVIEW_LENGTH),
        body: body,
      };
    },

    mergeImports: function (incoming) {
      if (!Array.isArray(incoming)) return Storage.loadLibrary();

      var map = {};
      Storage.loadLibrary().forEach(function (x) {
        if (x && x.id) map[x.id] = x;
      });

      incoming.forEach(function (x) {
        if (Library.validateImportItem(x)) {
          map[x.id] = Library.normalizeImportItem(x);
        }
      });

      return Object.keys(map).map(function (k) {
        return map[k];
      });
    },

    downloadJson: function (filename, obj) {
      try {
        var blob = new Blob([JSON.stringify(obj, null, 2)], {
          type: "application/json;charset=utf-8",
        });
        var url = URL.createObjectURL(blob);
        var a = document.createElement("a");
        a.href = url;
        a.download = filename;
        a.rel = "noopener noreferrer";
        a.style.display = "none";
        document.body.appendChild(a);
        a.click();
        setTimeout(function () {
          document.body.removeChild(a);
          URL.revokeObjectURL(url);
        }, 100);
      } catch (e) {
        console.error("下载失败:", e);
        showToast("导出失败: " + (e.message || "未知错误"));
      }
    },
  };

  function floorMaxFromBody(body) {
    if (!body) return null;
    var max = 0;
    String(body).replace(/【(\d+)L[｜|]/g, function (_, n) {
      var v = parseInt(n, 10);
      if (v > max) max = v;
      return "";
    });
    return max > 0 ? max : null;
  }

  function formatCharsShort(n) {
    n = Math.round(n);
    if (n >= 100000) return (n / 10000).toFixed(1) + "万";
    if (n >= 10000) return (n / 1000).toFixed(1) + "K";
    if (n >= 1000) return (n / 1000).toFixed(1) + "K";
    return String(n);
  }

  function isForumStyleBody(body) {
    return body && /【\s*\d+L[｜|]/.test(String(body));
  }

  function updateVaultStats(items) {
    items = items || Storage.loadLibrary();
    var total = 0;
    var works = 0;
    var drafts = 0;
    items.forEach(function (x) {
      var b = x.body ? String(x.body) : "";
      if (b) total += b.length;
      if (!b.trim()) return;
      if (isForumStyleBody(b)) works += 1;
      else drafts += 1;
    });
    var elW = document.getElementById("vault-stat-works");
    var elD = document.getElementById("vault-stat-drafts");
    var elC = document.getElementById("vault-stat-chars");
    if (elW) elW.textContent = String(works);
    if (elD) elD.textContent = String(drafts);
    if (elC) elC.textContent = formatCharsShort(total || 0);
  }

  var vaultViewMode = "all";

  function renderLibrary(mode) {
    if (mode) vaultViewMode = mode;
    var list = DOM.libraryList;
    if (!list) return;

    var allItems = Storage.loadLibrary().sort(function (a, b) {
      return (b.t || 0) - (a.t || 0);
    });
    var items = vaultViewMode === "works" ? allItems.filter(function (x) { return isForumStyleBody(x.body || ""); }) : allItems;

    updateVaultStats(allItems);

    if (!items.length) {
      list.innerHTML = vaultViewMode === "works" ? '<div class="vault-empty">还没有归档已完成作品。回到 The Forge，在长图工具中粘贴论坛体正文并点「储存小说」。</div>' : "";
      return;
    }

    list.innerHTML = items
      .map(function (item) {
        var body = item.body || "";
        var date = new Date(item.t || Date.now()).toISOString().slice(0, 10);
        var wc = String(body).replace(/\s/g, "").length || String(body).length;
        var fm = floorMaxFromBody(body);
        var floorLabel = fm ? fm + " 层" : "—";
        return (
          '<article class="vault-card" data-id="' +
          escHtml(item.id) +
          '">' +
          '<div class="vault-card-top">' +
          '<h3 class="vault-card-title">' +
          escHtml(item.title) +
          "</h3>" +
          '<div class="vault-card-tool">' +
          '<button type="button" class="vault-icon-btn" data-action="copy" title="复制">复制</button>' +
          '<button type="button" class="vault-icon-btn vault-icon-btn--danger btn-del" data-action="delete" title="删除">删除</button>' +
          "</div>" +
          "</div>" +
          '<div class="vault-card-meta">' +
          "<span>📝 " +
          formatCharsShort(wc) +
          " 字</span>" +
          "<span>楼层 " +
          floorLabel +
          "</span>" +
          "<span>🕐 " +
          escHtml(date) +
          "</span>" +
          "</div>" +

          "</article>"
        );
      })
      .join("");
  }

  function closeVaultPreview() {
    var modal = document.getElementById("vault-preview-modal");
    if (!modal) return;
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
  }

  function previewLibraryItem(id) {
    var found = Storage.loadLibrary().find(function (x) {
      return x.id === id;
    });
    if (!found || !found.body) {
      showToast("找不到该条目");
      return;
    }

    var modal = document.getElementById("vault-preview-modal");
    var root = document.getElementById("vault-preview-root");
    if (!modal || !root) return;

    var mainRoot = document.getElementById("tt-capture-root");
    var prevParent = mainRoot ? mainRoot.parentNode : null;
    var prevNext = mainRoot ? mainRoot.nextSibling : null;
    var tempRoot = document.createElement("div");
    tempRoot.id = "tt-capture-root";
    root.innerHTML = "";
    root.appendChild(tempRoot);

    if (mainRoot && prevParent) mainRoot.id = "tt-capture-root-live";
    if (window.ShemeiThreadImage && window.ShemeiThreadImage.renderCapture) {
      window.ShemeiThreadImage.renderCapture(found.body);
    } else {
      tempRoot.textContent = found.body;
    }
    tempRoot.removeAttribute("id");
    if (mainRoot && prevParent) {
      mainRoot.id = "tt-capture-root";
      if (prevNext) prevParent.insertBefore(mainRoot, prevNext);
      else prevParent.appendChild(mainRoot);
    }

    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
  }
  function handleLibraryClick(e) {
    var item = e.target.closest(".vault-card") || e.target.closest(".library-item");
    if (!item) return;

    var id = item.getAttribute("data-id");
    if (!id) return;

    var btn = e.target.closest("button[data-action]");
    if (!btn) {
      previewLibraryItem(id);
      return;
    }

    var action = btn.getAttribute("data-action");

    e.preventDefault();
    e.stopPropagation();

    if (action === "delete") {
      var next = Storage.loadLibrary().filter(function (x) {
        return x.id !== id;
      });
      Storage.saveLibrary(next);
      renderLibrary();
      showToast("已删除");
    } else if (action === "copy") {
      var found = Storage.loadLibrary().find(function (x) {
        return x.id === id;
      });
      if (found && found.body) copyText(found.body);
      else showToast("找不到该条目");
    }
  }

  function handleSaveNovel() {
    var input = document.getElementById("tt-input");
    var body = input ? input.value.trim() : "";
    if (!body) {
      showToast("请先粘贴论坛体正文");
      if (input) input.focus();
      return;
    }
    if (!isForumStyleBody(body)) {
      showToast("未识别到【1L｜昵称】楼层格式，请先整理为论坛体正文");
      if (input) input.focus();
      return;
    }

    var items = Storage.loadLibrary();
    items.push(Library.createItem(body, body));
    if (Storage.saveLibrary(items)) {
      updateVaultStats(items);
      showToast("已归档到 Vault · 已完成作品");
    }
  }

  function handleSaveToLibrary() {
    var body = buildPrompt();
    var muse = (composeRawText || "").trim();

    if (!muse) {
      showToast("请先上传文本素材");
      if (DOM.forgeInspireInput) DOM.forgeInspireInput.focus();
      return;
    }

    var items = Storage.loadLibrary();
    var titleSrc = composeFileName ? composeFileName + "\n" + muse : muse;
    items.push(Library.createItem(body, titleSrc));

    if (Storage.saveLibrary(items)) {
      showToast("已保存到本地");
    }
  }

  var API = {
    messages: [],
    isLoading: false,

    setLoading: function (on) {
      API.isLoading = Boolean(on);
      ["btn-start-create", "btn-api-confirm", "btn-api-send", "btn-api-clear", "btn-api-copy-last"].forEach(function (id) {
        var b = document.getElementById(id);
        if (b) b.disabled = on;
      });
      updateForgeRouteAUI();
    },

    setError: function (text) {
      var el = DOM.apiError;
      if (!el) return;
      if (!text) {
        el.hidden = true;
        el.textContent = "";
      } else {
        el.hidden = false;
        el.textContent = text;
      }
    },

    renderChat: function () {
      var log = DOM.apiChatLog;
      if (!log) return;

      if (!API.messages.length) {
        log.innerHTML =
          '<div class="forge-chat-empty hint" style="padding:0.75rem 1rem;">暂无消息。请先上传灵感，再点<strong>开始创作</strong>：首条只会带上素材与一句启动说明（完整 skill/method 已在服务端系统提示里），助手应从 Step1 起回复。</div>';
        return;
      }

      log.innerHTML = API.messages
        .map(function (m) {
          var cls = m.role === "user" ? "user" : "assistant";
          var lab = m.role === "user" ? "你" : "助手";
          return (
            '<div class="chat-bubble ' +
            cls +
            '"><div class="role">' +
            lab +
            "</div>" +
            escHtml(m.content) +
            "</div>"
          );
        })
        .join("");
      log.scrollTop = log.scrollHeight;
      updateForgeRouteAUI();
    },

    loadSession: function () {
      API.messages = Storage.loadApiSession();
    },

    saveSession: function () {
      Storage.saveApiSession(API.messages);
    },

    clearSession: function () {
      API.messages = [];
      Storage.clearApiSession();
      API.setError("");
    },

    addUserMessage: function (content) {
      API.messages.push({ role: "user", content: content });
      API.saveSession();
      API.renderChat();
    },

    addAssistantMessage: function (content) {
      API.messages.push({ role: "assistant", content: content });
      API.saveSession();
      API.renderChat();
    },

    updateLastAssistantMessage: function (content) {
      for (var i = API.messages.length - 1; i >= 0; i--) {
        if (API.messages[i].role === "assistant") {
          API.messages[i].content = content;
          API.saveSession();
          API.renderChat();
          return true;
        }
      }
      return false;
    },

    getLastAssistantMessage: function () {
      for (var i = API.messages.length - 1; i >= 0; i--) {
        if (API.messages[i].role === "assistant") {
          return API.messages[i].content;
        }
      }
      return null;
    },

    getLastUserMessage: function () {
      for (var i = API.messages.length - 1; i >= 0; i--) {
        if (API.messages[i].role === "user") {
          return API.messages[i].content;
        }
      }
      return "";
    },

    fetchHealth: async function () {
      var box = DOM.forgeApiStatus || DOM.apiStatus;
      if (!box) return;

      function setLine(cls, msg) {
        box.className = "forge-api-status muted-pill " + (cls || "");
        box.textContent = msg;
      }

      if (window.location.protocol === "file:") {
        setLine("api-warn", "请通过 server 打开的 http 地址访问（file:// 无法请求 API）");
        return;
      }

      try {
        var r = await fetch(apiUrl("/api/health"), { method: "GET" });
        var j = await r.json().catch(function () {
          return {};
        });

        if (r.ok && j.apiKeyConfigured) {
          setLine("api-ok", "API 就绪");
        } else if (r.ok) {
          setLine("api-warn", "服务已连通，未配置 LLM_API_KEY（见 server/.env）");
        } else {
          setLine("api-warn", "健康检查异常");
        }
      } catch (_e) {
        setLine(
          "api-warn",
          "无法连接 API（" + (getApiBase() || "当前站点") + "/api/health）· 请确认后端已启动且地址正确"
        );
      }
    },

    postChat: async function () {
      API.setLoading(true);
      API.setError("");

      try {
        var r = await fetch(apiUrl("/api/chat"), {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ messages: API.messages }),
        });

        if (!r.ok) {
          var j = await r.json().catch(function () {
            return {};
          });
          API.setError((j.error || "请求失败") + (j.snippet ? "\n" + j.snippet : ""));
          return false;
        }

        var contentType = r.headers.get("content-type") || "";
        if (contentType.indexOf("application/json") >= 0) {
          var j2 = await r.json().catch(function () {
            return {};
          });
          if (!j2.message || typeof j2.message.content !== "string") {
            API.setError("响应格式异常");
            return false;
          }
          API.addAssistantMessage(j2.message.content);
          showToast("已收到助手回复");
          return true;
        }

        if (!r.body || !window.TextDecoder) {
          var text = await r.text();
          API.addAssistantMessage(text);
          showToast("已收到助手回复");
          return true;
        }

        API.addAssistantMessage("");
        var reader = r.body.getReader();
        var decoder = new TextDecoder("utf-8");
        var content = "";

        while (true) {
          var part = await reader.read();
          if (part.done) break;
          content += decoder
            .decode(part.value, { stream: true })
            .replace(/\u200b/g, "")
            .replace(/\n?<!--KEEPALIVE:[\s\S]*?-->\n?/g, "");
          API.updateLastAssistantMessage(content);
        }
        content += decoder
          .decode()
          .replace(/\u200b/g, "")
          .replace(/\n?<!--KEEPALIVE:[\s\S]*?-->\n?/g, "");
        API.updateLastAssistantMessage(content);
        showToast("已收到助手回复");
        return true;
      } catch (e) {
        API.setError(e.message || String(e));
        return false;
      } finally {
        API.setLoading(false);
      }
    },
  };

  async function startForgeWorkflow() {
    var muse = (composeRawText || "").trim();
    if (!muse) {
      showToast("请先填写灵感");
      if (DOM.composeDropzone) DOM.composeDropzone.focus();
      return;
    }

    API.clearSession();
    API.renderChat();
    API.addUserMessage(buildChatSeedBody());

    var ok = await API.postChat();
    if (ok) {
      showToast("已发起首轮对话");
      requestAnimationFrame(function () {
        var panel = document.getElementById("forge-chat-panel");
        if (panel) panel.scrollIntoView({ behavior: "smooth", block: "nearest" });
      });
    }
  }

  async function handleApiSend() {
    if (!DOM.apiUserInput) return;
    var text = DOM.apiUserInput.value.trim();
    if (!text) {
      showToast("请先输入内容");
      DOM.apiUserInput.focus();
      return;
    }

    API.addUserMessage(text);
    DOM.apiUserInput.value = "";
    await API.postChat();
  }

  function handleApiClear() {
    API.clearSession();
    API.renderChat();
    showToast("已清空会话");
  }

  function handleApiCopyLast() {
    var last = API.getLastAssistantMessage();
    if (last) copyText(last);
    else showToast("没有助手回复可复制");
  }

  function handleExport() {
    var items = Storage.loadLibrary();
    if (items.length === 0) {
      showToast("灵感库为空");
      return;
    }

    var name =
      "shemei-inspirations-" +
      new Date().toISOString().slice(0, 19).replace(/[:T]/g, "-") +
      ".json";
    Library.downloadJson(name, items);
    showToast("已导出 " + items.length + " 条");
  }

  function handleImportClick() {
    if (DOM.libImportFile) {
      DOM.libImportFile.value = "";
      DOM.libImportFile.click();
    }
  }

  function handleImportFile(e) {
    var f = e.target.files && e.target.files[0];
    if (!f) return;

    if (!f.name.endsWith(".json") && f.type !== "application/json") {
      showToast("请选择 JSON 文件");
      return;
    }

    if (f.size > 5 * 1024 * 1024) {
      showToast("文件过大，最大支持 5MB");
      return;
    }

    var reader = new FileReader();
    reader.onload = function () {
      try {
        var data = JSON.parse(reader.result);
        var arr = Array.isArray(data) ? data : data.items || [];
        var merged = Library.mergeImports(arr);
        Storage.saveLibrary(merged);
        renderLibrary();
        showToast("导入完成，共 " + merged.length + " 条");
      } catch (err) {
        console.error("导入失败:", err);
        showToast("JSON 解析失败");
      }
    };

    reader.onerror = function () {
      showToast("文件读取失败");
    };

    reader.readAsText(f, "utf-8");
  }

  var Router = {
    current: "compose",

    parseHash: function () {
      var raw = (window.location.hash || "#compose").replace(/^#/, "") || "compose";
      if (raw === "compose-export-image") {
        return { page: "compose", anchor: "compose-export-image", raw: raw };
      }
      if (raw === "compose-help") {
        return { page: "compose", anchor: "compose-help", raw: raw };
      }
      if (["compose", "library", "explore"].indexOf(raw) >= 0) {
        return { page: raw, anchor: null, raw: raw };
      }
      return { page: "compose", anchor: null, raw: raw };
    },

    set: function () {
      if (!document.getElementById("page-compose")) return;

      var parsed = Router.parseHash();
      var h = parsed.page;
      Router.current = h;

      if (
        parsed.raw !== "compose-export-image" &&
        parsed.raw !== "compose-help" &&
        ["compose", "library", "explore"].indexOf(parsed.raw) < 0
      ) {
        history.replaceState(null, "", "#compose");
      }

      $all(".nav-pill[href^='#']").forEach(function (a) {
        var href = a.getAttribute("href") || "";
        var matches =
          (h === "compose" && !parsed.anchor && href === "#compose") ||
          (h !== "compose" && href.replace("#", "").split("?")[0] === h);
        a.setAttribute("aria-current", matches ? "page" : "false");
      });

      $all(".studio-help-link[href='#compose-export-image']").forEach(function (a) {
        var active = h === "compose" && parsed.anchor === "compose-export-image";
        a.setAttribute("aria-current", active ? "page" : "false");
      });

      $all(".studio-help-link[href='#compose-help']").forEach(function (a) {
        var active = h === "compose" && parsed.anchor === "compose-help";
        a.setAttribute("aria-current", active ? "page" : "false");
      });

      $all(".page").forEach(function (p) {
        p.classList.toggle("is-active", p.id === "page-" + h);
      });

      if (h === "library") {
        renderLibrary();
      }

      if (h === "compose" && parsed.anchor === "compose-export-image") {
        requestAnimationFrame(function () {
          var el = document.getElementById("compose-export-image");
          if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
        });
      }

      if (h === "compose" && parsed.anchor === "compose-help") {
        requestAnimationFrame(function () {
          var el = document.getElementById("compose-help");
          if (el) el.scrollIntoView({ behavior: "smooth", block: "center" });
        });
      }
    },
  };

  function bindEvents() {
    bindComposeUpload();

    if (DOM.buttons.copy) {
      DOM.buttons.copy.addEventListener("click", function () {
        copyText(buildPrompt());
      });
    }

    if (DOM.buttons.save) {
      DOM.buttons.save.addEventListener("click", handleSaveToLibrary);
    }

    if (DOM.btnSaveNovel) {
      DOM.btnSaveNovel.addEventListener("click", handleSaveNovel);
    }

    if (DOM.vaultWorksCard) {
      DOM.vaultWorksCard.addEventListener("click", function () {
        renderLibrary("works");
        var el = document.getElementById("library-list");
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }

    if (DOM.btnStartCreate) {
      DOM.btnStartCreate.addEventListener("click", function () {
        startForgeWorkflow();
      });
    }

    if (ENABLE_API && DOM.buttons.apiConfirm) {
      DOM.buttons.apiConfirm.addEventListener("click", function () {
        sendQuickUserMessage("确认");
      });
    }

    if (ENABLE_API && DOM.buttons.apiSend) {
      DOM.buttons.apiSend.addEventListener("click", handleApiSend);
    }

    if (ENABLE_API && DOM.buttons.apiClear) {
      DOM.buttons.apiClear.addEventListener("click", handleApiClear);
    }

    if (ENABLE_API && DOM.buttons.apiCopyLast) {
      DOM.buttons.apiCopyLast.addEventListener("click", handleApiCopyLast);
    }

    if (DOM.buttons.libExport) {
      DOM.buttons.libExport.addEventListener("click", handleExport);
    }

    if (DOM.buttons.libImport) {
      DOM.buttons.libImport.addEventListener("click", handleImportClick);
    }

    if (DOM.libImportFile) {
      DOM.libImportFile.addEventListener("change", handleImportFile);
    }

    if (DOM.libraryList) {
      DOM.libraryList.addEventListener("click", handleLibraryClick);
    }

    document.addEventListener("click", function (e) {
      if (e.target.closest("[data-vault-preview-close]")) closeVaultPreview();
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape") closeVaultPreview();
    });

    var btnQc = document.getElementById("btn-quick-confirm");
    if (btnQc) {
      btnQc.addEventListener("click", function () {
        sendQuickUserMessage("确认");
      });
    }
    var btnQs = document.getElementById("btn-quick-skip-step4");
    if (btnQs) {
      btnQs.addEventListener("click", function () {
        sendQuickUserMessage("请跳过 Step4 人性化润色，以当前论坛体正文为终稿。");
      });
    }
    var btnQf = document.getElementById("btn-quick-focus-reply");
    if (btnQf) {
      btnQf.addEventListener("click", function () {
        if (DOM.apiUserInput) {
          DOM.apiUserInput.focus();
          showToast("在下方输入修改意见后点「发送」");
        }
      });
    }

    if (DOM.forgeInspireInput) {
      DOM.forgeInspireInput.addEventListener("input", function () {
        composeRawText = DOM.forgeInspireInput.value;
        composeFileName = "";
        setComposeFileLabel();
        debouncedInspireSync();
      });
    }

    var btnVaultScroll = document.getElementById("btn-vault-scroll-drafts");
    if (btnVaultScroll) {
      btnVaultScroll.addEventListener("click", function () {
        var el = document.getElementById("library-list");
        if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }

    var nexusFilters = document.querySelector(".nexus-filters");
    if (nexusFilters) {
      nexusFilters.addEventListener("click", function (e) {
        var chip = e.target.closest(".nexus-filter-chip");
        if (!chip || chip.tagName !== "BUTTON") return;
        var cat = chip.getAttribute("data-nexus-cat") || "all";
        $all(".nexus-filter-chip", nexusFilters).forEach(function (c) {
          c.classList.toggle("is-active", c === chip);
        });
        $all(".nexus-grid [data-nexus-match]").forEach(function (tile) {
          var raw = tile.getAttribute("data-nexus-match");
          var tags = raw ? String(raw).split(/[\s,，]+/).filter(Boolean) : [];
          var show =
            cat === "all" || (tags.length && tags.indexOf(cat) >= 0);
          if (cat !== "all" && !tags.length) show = false;
          tile.hidden = !show;
        });
      });
    }

    window.addEventListener("hashchange", Router.set);

    document.addEventListener("fp-route", function (ev) {
      var r = ev.detail && ev.detail.route;
      if (r === "vault") renderLibrary();
    });

    document.addEventListener("keydown", function (e) {
      var isK = e.key === "k" || e.key === "K";
      if (!isK || !(e.metaKey || e.ctrlKey)) return;
      var tag = (e.target && e.target.tagName) || "";
      if (tag === "INPUT" || tag === "TEXTAREA" || e.target.isContentEditable) return;
      e.preventDefault();
      if (DOM.composeFile) DOM.composeFile.click();
    });

    var sampleEl = document.getElementById("forge-sample-inspire");
    if (sampleEl) {
      sampleEl.addEventListener("click", function () {
        applyComposeText(SAMPLE_INSPIRE_BODY, "灵感示例.txt");
        showToast("已填入灵感示例");
      });
    }

    if (ENABLE_API && DOM.apiUserInput) {
      DOM.apiUserInput.addEventListener("keydown", function (e) {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          handleApiSend();
        }
      });
    }
  }

  function init() {
    cacheDOM();
    bindEvents();

    if (document.getElementById("page-compose")) {
      if (!window.location.hash || window.location.hash === "#") {
        history.replaceState(null, "", "#compose");
      }
      Router.set();
    }
    setComposeFileLabel();
    syncForgeInspireField();
    previewUpdate();

    API.loadSession();
    API.renderChat();
    updateForgeRouteAUI();
    API.fetchHealth();

    if (DOM.libraryList) {
      renderLibrary();
    }
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    init();
  }
})();



