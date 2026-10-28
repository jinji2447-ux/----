(function () {
  'use strict';

  var STORAGE_KEY = 'quiz-app-v1';
  var app = document.getElementById('app');
  var letter = ['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H'];
  var TYPE_LABELS = { single: '单选题', multiple: '多选题', judge: '判断题', blank: '填空题', short: '简答题', note: '考点' };
  var TYPE_GROUPS = {
    choice: { label: '选择题', types: ['single', 'multiple'] },
    judge: { label: '判断题', types: ['judge'] },
    blank: { label: '填空题', types: ['blank'] },
    short: { label: '简答题', types: ['short'] }
  };
  var TYPE_GROUP_ORDER = ['choice', 'judge', 'blank', 'short'];
  var SETTINGS_BTN = '<button class="settings-btn" id="settings-btn" title="设置">⚙</button>';

  /* ================= 数据工具 ================= */
  function findBoard(boardId) {
    for (var i = 0; i < QUESTION_BANKS.length; i++) {
      if (QUESTION_BANKS[i].id === boardId) return QUESTION_BANKS[i];
    }
    return null;
  }
  function findBank(boardId, bankId) {
    var board = findBoard(boardId);
    if (!board) return null;
    for (var i = 0; i < board.banks.length; i++) {
      if (board.banks[i].id === bankId) return board.banks[i];
    }
    return null;
  }
  function groupOf(type) {
    for (var i = 0; i < TYPE_GROUP_ORDER.length; i++) {
      if (TYPE_GROUPS[TYPE_GROUP_ORDER[i]].types.indexOf(type) !== -1) return TYPE_GROUP_ORDER[i];
    }
    return 'choice';
  }

  /* ================= 本地状态 ================= */
  function loadState() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        var s = JSON.parse(raw);
        if (!s.ai) s.ai = {};
        return s;
      }
    } catch (e) {}
    return { progress: {}, wrongSet: {}, ai: {} };
  }
  var state = loadState();

  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) {}
  }
  function progress(bankId) {
    if (!state.progress[bankId]) {
      state.progress[bankId] = { index: 0, answers: {}, results: {} };
    }
    return state.progress[bankId];
  }
  function wrongSet(bankId) {
    if (!state.wrongSet[bankId]) state.wrongSet[bankId] = [];
    return state.wrongSet[bankId];
  }
  function setWrong(bankId, idx, on) {
    var ws = wrongSet(bankId);
    var i = ws.indexOf(idx);
    if (on && i === -1) ws.push(idx);
    if (!on && i !== -1) ws.splice(i, 1);
    ws.sort(function (a, b) { return a - b; });
  }
  function isWrong(bankId, idx) {
    return wrongSet(bankId).indexOf(idx) !== -1;
  }
  function countDone(bankId) {
    var p = state.progress[bankId];
    return p ? Object.keys(p.results).length : 0;
  }

  /* ================= 判题 ================= */
  function norm(s) { return String(s == null ? '' : s).trim(); }
  function sortedCopy(a) { return a.slice().sort(); }
  function arraysEqual(a, b) {
    if (a.length !== b.length) return false;
    for (var i = 0; i < a.length; i++) if (a[i] !== b[i]) return false;
    return true;
  }
  function isCorrect(q, ans) {
    switch (q.type) {
      case 'single': return ans === q.answer;
      case 'multiple': return arraysEqual(sortedCopy(ans || []), sortedCopy(q.answer || []));
      case 'judge': return ans === q.answer;
      default: return false;
    }
  }
  function blankCount(q) {
    if (Array.isArray(q.answer)) return q.answer.length;
    var m = q.stem.match(/_+/g);
    return m ? m.length : 1;
  }
  function formatAnswer(q) {
    switch (q.type) {
      case 'single': return letter[q.answer] + '. ' + q.options[q.answer];
      case 'multiple': return q.answer.map(function (i) { return letter[i]; }).join('、');
      case 'judge': return q.answer ? '正确' : '错误';
      case 'blank': return Array.isArray(q.answer) ? q.answer.join('；') : q.answer;
      case 'short': return q.answer;
      default: return '';
    }
  }
  function escapeHtml(s) {
    return String(s == null ? '' : s)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;');
  }

  /* ================= 本地判分（填空/简答：与答案完全一致才算对） ================= */
  function normText(s) {
    return String(s == null ? '' : s).toLowerCase().replace(/[^0-9a-z一-龥]/g, '');
  }
  // 忽略大小写、空格与标点后，须与答案完全一致
  function sameAnswer(a, b) {
    return normText(a) === normText(b);
  }
  function blankCorrect(q, ans) {
    var exp = Array.isArray(q.answer) ? q.answer : [q.answer];
    var got = Array.isArray(ans) ? ans : [ans];
    if (exp.length !== got.length) return false;
    return exp.every(function (e, i) { return sameAnswer(e, got[i]); });
  }
  function shortCorrect(ref, user) {
    return sameAnswer(user, ref);
  }

  /* ================= 设置 & 云端 AI（解析 / 审阅） ================= */
  var SETTINGS_KEY = 'quiz-settings-v1';
  function loadSettings() { try { return JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {}; } catch (e) { return {}; } }
  function saveSettings(s) { try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(s)); } catch (e) {} }

  // 服务商预设：type = anthropic（Anthropic 接口）或 openai（OpenAI 兼容，DeepSeek/OpenAI/Qwen/Kimi 等）
  var PROVIDERS = {
    anthropic: { label: 'Anthropic（Claude）', baseUrl: 'https://api.anthropic.com', model: 'claude-opus-5-5', type: 'anthropic' },
    deepseek: { label: 'DeepSeek', baseUrl: 'https://api.deepseek.com', model: 'deepseek-v4-pro', type: 'openai' },
    openai: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o', type: 'openai' },
    custom: { label: '自定义（OpenAI 兼容）', baseUrl: '', model: '', type: 'openai' }
  };
  function providerOf(s) { return PROVIDERS[s.provider] || PROVIDERS.custom; }

  function callAI(messages) {
    var s = loadSettings();
    if (!s.apiKey) return Promise.reject(new Error('尚未配置 API Key，请点击左上角「⚙ 设置」填写。'));
    if (s.model === 'deepseek-v4-pro[1m]') s.model = 'deepseek-v4-pro'; // 兼容旧配置的模型名
    var p = providerOf(s);
    return p.type === 'anthropic' ? callAnthropic(s, p, messages) : callOpenAICompatible(s, p, messages);
  }

  function callAnthropic(s, p, messages) {
    var base = (s.baseUrl || p.baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '');
    var url = base + (base.indexOf('/v1/messages') !== -1 ? '' : '/v1/messages');
    return fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': s.apiKey,
        'anthropic-version': '2023-06-01',
        'anthropic-dangerous-direct-browser-access': 'true'
      },
      body: JSON.stringify({ model: s.model || p.model, max_tokens: 1024, messages: messages })
    }).then(function (resp) {
      return resp.json().then(function (data) {
        if (!resp.ok) throw new Error((data.error && data.error.message) || ('API 错误（HTTP ' + resp.status + '）'));
        return (data.content || []).filter(function (b) { return b.type === 'text'; }).map(function (b) { return b.text; }).join('');
      });
    });
  }

  function callOpenAICompatible(s, p, messages) {
    var base = (s.baseUrl || p.baseUrl || '').replace(/\/+$/, '');
    var url = base.indexOf('/chat/completions') !== -1 ? base : (base + '/chat/completions');
    return fetch(url, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + s.apiKey },
      body: JSON.stringify({ model: s.model || p.model, messages: messages, max_tokens: 1024, stream: false })
    }).then(function (resp) {
      return resp.json().then(function (data) {
        if (!resp.ok) throw new Error((data.error && data.error.message) || ('API 错误（HTTP ' + resp.status + '）'));
        var c = data.choices && data.choices[0];
        return (c && c.message && c.message.content) || '';
      });
    });
  }

  // AI 解析结果缓存（按 题库:题号 存，答过一次后不再重复调用，节省 token）
  function aiKey(bankId, qi) { return bankId + ':' + qi; }
  function getAIExplain(bankId, qi) { return state.ai && state.ai[aiKey(bankId, qi)]; }
  function setAIExplain(bankId, qi, text) {
    if (!state.ai) state.ai = {};
    state.ai[aiKey(bankId, qi)] = text;
    saveState();
  }

  function questionToPrompt(q) {
    var s = '题型：' + TYPE_LABELS[q.type] + '\n题干：' + q.stem + '\n';
    if (q.type === 'single' || q.type === 'multiple') {
      s += '选项：\n' + q.options.map(function (o, i) { return letter[i] + '. ' + o; }).join('\n') + '\n';
    }
    s += '正确答案：' + formatAnswer(q);
    return s;
  }
  function aiExplain(q) {
    return callAI([{ role: 'user', content: '你是通信/网络技术讲师。请用简洁中文解析这道题的答案，说明为什么正确（2~3 句，直接讲结论和依据，不要复述题目）。\n\n' + questionToPrompt(q) }]);
  }
  function aiReview(q, userAnswer) {
    var ua = Array.isArray(userAnswer) ? userAnswer.join('；') : String(userAnswer == null ? '' : userAnswer);
    var ref = q.answer == null ? '（本题未提供标准答案，请依据你的知识判断）' : formatAnswer(q);
    return callAI([{ role: 'user', content: '你是判卷老师。判断学生作答是否正确。只输出两行：第一行写「正确」或「错误」，第二行写一句简短理由。\n\n题目：' + q.stem + '\n参考答案：' + ref + '\n学生作答：' + ua }]);
  }
  function parseVerdict(text) {
    var first = text.split('\n')[0].replace(/[：:。.\s]/g, '');
    if (/错误|不正确|✗|×|不对/.test(first)) return false;
    if (/正确|✓|√|对/.test(first)) return true;
    return null;
  }

  function openSettings() {
    var s = loadSettings();
    var p = providerOf(s);
    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML =
      '<div class="modal">' +
        '<h3>⚙ 设置</h3>' +
        '<p class="modal-sub">配置云端大模型（AI 解析答案、审阅简答/填空）。Key 仅保存在本机浏览器。</p>' +
        '<div class="settings-field"><label>服务商</label>' +
          '<select id="set-provider">' +
            '<option value="anthropic"' + (s.provider === 'anthropic' ? ' selected' : '') + '>Anthropic（Claude）</option>' +
            '<option value="deepseek"' + (s.provider === 'deepseek' ? ' selected' : '') + '>DeepSeek</option>' +
            '<option value="openai"' + (s.provider === 'openai' ? ' selected' : '') + '>OpenAI</option>' +
            '<option value="custom"' + (s.provider === 'custom' ? ' selected' : '') + '>自定义（OpenAI 兼容）</option>' +
          '</select></div>' +
        '<div class="settings-field"><label>API Key</label>' +
          '<input type="password" id="set-key" placeholder="sk-..." value="' + escapeHtml(s.apiKey || '') + '"></div>' +
        '<div class="settings-field"><label>模型</label>' +
          '<input type="text" id="set-model" value="' + escapeHtml(s.model || p.model || '') + '"></div>' +
        '<div class="settings-field"><label>接口地址（Base URL）</label>' +
          '<input type="text" id="set-baseurl" value="' + escapeHtml(s.baseUrl || p.baseUrl || '') + '"></div>' +
        '<div class="modal-actions">' +
          '<button class="btn" data-act="close">关闭</button>' +
          '<button class="btn" data-act="clear">清除 Key</button>' +
          '<button class="btn btn-primary" data-act="save">保存</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);

    document.getElementById('set-provider').addEventListener('change', function () {
      var pr = PROVIDERS[this.value];
      if (pr) {
        document.getElementById('set-model').value = pr.model || '';
        document.getElementById('set-baseurl').value = pr.baseUrl || '';
      }
    });

    overlay.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-act]');
      if (!btn) return;
      var act = btn.dataset.act;
      if (act === 'close') { document.body.removeChild(overlay); return; }
      if (act === 'clear') { saveSettings({}); document.body.removeChild(overlay); return; }
      if (act === 'save') {
        saveSettings({
          provider: document.getElementById('set-provider').value,
          apiKey: document.getElementById('set-key').value.trim(),
          model: document.getElementById('set-model').value.trim(),
          baseUrl: document.getElementById('set-baseurl').value.trim()
        });
        document.body.removeChild(overlay);
      }
    });
  }

  /* ================= 路由 ================= */
  function parseHash() {
    return location.hash.replace(/^#\/?/, '').split('/').filter(Boolean);
  }
  function render() {
    var parts = parseHash();
    if (parts[0] === 'board' && parts[1]) {
      var b = findBoard(parts[1]);
      if (b) return renderBoard(b);
    }
    if (parts[0] === 'practice' && parts[1] && parts[2]) {
      var b2 = findBoard(parts[1]);
      var bank = findBank(parts[1], parts[2]);
      if (b2 && bank) return renderPractice(b2, bank);
    }
    if (parts[0] === 'wrong' && parts[1] && parts[2]) {
      var b3 = findBoard(parts[1]);
      if (b3 && TYPE_GROUPS[parts[2]]) return renderWrongCategory(b3, parts[2]);
    }
    renderHome();
  }

  /* ================= 首页 ================= */
  function renderHome() {
    app.innerHTML =
      '<header class="topbar"><div class="topbar-inner">' +
        SETTINGS_BTN +
        '<h1>刷题软件</h1>' +
        '<span class="topbar-sub">题库练习 · 错题复习 · 进度自动记忆</span>' +
      '</div></header>' +
      '<main class="container">' +
        '<h2 class="page-title">选择板块</h2>' +
        '<div class="board-grid">' +
          QUESTION_BANKS.map(function (b) {
            var total = b.banks.reduce(function (s, bk) { return s + bk.questions.length; }, 0);
            return '<a class="board-card" href="#/board/' + b.id + '">' +
              '<div class="board-card-icon">📚</div>' +
              '<div class="board-card-name">' + escapeHtml(b.name) + '</div>' +
              '<div class="board-card-meta">' + b.banks.length + ' 个题库 · ' + total + ' 题</div>' +
            '</a>';
          }).join('') +
        '</div>' +
      '</main>';
  }

  /* ================= 板块页 ================= */
  function renderBoard(board) {
    app.innerHTML =
      '<header class="topbar"><div class="topbar-inner">' +
        SETTINGS_BTN +
        '<a class="back-link" href="#/">← 返回首页</a>' +
        '<h1>' + escapeHtml(board.name) + '</h1>' +
      '</div></header>' +
      '<main class="container board-layout">' +
        '<aside class="board-nav">' +
          '<button class="nav-item active" data-tab="practice">开始刷题</button>' +
          '<button class="nav-item" data-tab="wrong">错题集</button>' +
        '</aside>' +
        '<section class="board-content" id="board-content"></section>' +
      '</main>';

    var nav = app.querySelector('.board-nav');
    nav.addEventListener('click', function (e) {
      var btn = e.target.closest('.nav-item');
      if (!btn) return;
      nav.querySelectorAll('.nav-item').forEach(function (n) { n.classList.remove('active'); });
      btn.classList.add('active');
      renderBoardTab(board, btn.dataset.tab);
    });

    renderBoardTab(board, 'practice');
  }

  function renderBoardTab(board, tab) {
    var content = document.getElementById('board-content');
    if (tab === 'practice') {
      if (board.banks.length === 0) {
        content.innerHTML = '<div class="empty-state">该板块暂无题库，敬请期待</div>';
        return;
      }
      content.innerHTML = '<div class="bank-grid">' +
        board.banks.map(function (bank) {
          var done = countDone(bank.id);
          var total = bank.questions.length;
          var pct = total ? Math.round(done / total * 100) : 0;
          return '<a class="bank-card" href="#/practice/' + board.id + '/' + bank.id + '">' +
            '<div class="bank-card-head">' +
              '<span class="bank-card-name">' + escapeHtml(bank.name) + '</span>' +
              '<span class="bank-card-count">' + total + ' 题</span>' +
            '</div>' +
            '<div class="bank-card-progress">' +
              '<div class="progress-bar"><div class="progress-fill" style="width:' + pct + '%"></div></div>' +
              '<span class="progress-text">' + done + '/' + total + '</span>' +
            '</div>' +
          '</a>';
        }).join('') +
      '</div>';
    } else {
      var counts = { choice: 0, judge: 0, blank: 0, short: 0 };
      board.banks.forEach(function (bank) {
        wrongSet(bank.id).forEach(function (qi) {
          counts[groupOf(bank.questions[qi].type)]++;
        });
      });
      var total = counts.choice + counts.judge + counts.blank + counts.short;
      if (total === 0) {
        content.innerHTML = '<div class="empty-state">🎉 暂无错题，继续保持！</div>';
        return;
      }
      content.innerHTML = '<div class="bank-grid">' +
        TYPE_GROUP_ORDER.map(function (id) {
          var g = TYPE_GROUPS[id];
          var c = counts[id];
          if (c === 0) {
            return '<span class="bank-card disabled"><div class="bank-card-head">' +
              '<span class="bank-card-name">' + g.label + '</span>' +
              '<span class="bank-card-count">0 道错题</span>' +
            '</div></span>';
          }
          return '<a class="bank-card" href="#/wrong/' + board.id + '/' + id + '">' +
            '<div class="bank-card-head">' +
              '<span class="bank-card-name">' + g.label + '</span>' +
              '<span class="badge-wrong">' + c + ' 道错题</span>' +
            '</div>' +
          '</a>';
        }).join('') +
      '</div>';
    }
  }

  /* ================= 刷题页（入口） ================= */
  function renderPractice(board, bank) {
    var items = bank.questions.map(function (_, qi) { return { bank: bank, qi: qi }; });
    practiceCore(board, board.name + ' · ' + bank.name, items, false, bank);
  }

  function renderWrongCategory(board, category) {
    var items = [];
    board.banks.forEach(function (bank) {
      wrongSet(bank.id).forEach(function (qi) {
        if (TYPE_GROUPS[category].types.indexOf(bank.questions[qi].type) !== -1) {
          items.push({ bank: bank, qi: qi });
        }
      });
    });
    var title = board.name + ' · ' + TYPE_GROUPS[category].label + '（错题）';
    if (items.length === 0) {
      app.innerHTML =
        '<header class="topbar"><div class="topbar-inner">' +
          '<a class="back-link" href="#/board/' + board.id + '">← 返回</a>' +
          '<div class="topbar-title">' + escapeHtml(title) + '</div>' +
        '</div></header>' +
        '<main class="container"><div class="empty-state">🎉 该分类暂无错题！</div></main>';
      return;
    }
    // 错题模式：进入即清空旧作答，让用户重新作答
    items.forEach(function (it) {
      var p = progress(it.bank.id);
      delete p.answers[it.qi];
      delete p.results[it.qi];
    });
    saveState();
    practiceCore(board, title, items, true, null);
  }

  /* ================= 刷题核心 ================= */
  function practiceCore(board, title, items, wrongMode, bank) {
    var pos = 0;
    if (!wrongMode && bank) pos = progress(bank.id).index;
    if (pos < 0 || pos >= items.length) pos = 0;

    var selected = null;   // 当前题已选但未提交的答案
    var lastKey = null;    // 用于在切题时清空选中

    app.innerHTML =
      '<header class="topbar"><div class="topbar-inner">' +
        SETTINGS_BTN +
        '<a class="back-link" id="back-link" href="#/board/' + board.id + '">← 返回</a>' +
        '<div class="topbar-title">' + escapeHtml(title) + '</div>' +
      '</div></header>' +
      '<main class="practice-layout container" id="practice-layout">' +
        '<aside class="nav-sidebar">' +
          '<div class="sidebar-head">' +
            '<span class="sidebar-title">题目导航</span>' +
            '<button class="sidebar-toggle" id="sidebar-toggle" title="收起/展开">⟨</button>' +
          '</div>' +
          '<div class="sidebar-grid" id="sidebar-grid"></div>' +
          '<div class="sidebar-legend"><span class="dot correct"></span>答对 <span class="dot wrong"></span>答错 <span class="dot cur"></span>当前</div>' +
        '</aside>' +
        '<section class="practice-main">' +
          '<div class="practice-progress">' +
            '<div class="progress-bar"><div class="progress-fill" id="practice-fill"></div></div>' +
            '<span id="practice-count"></span>' +
          '</div>' +
          '<div id="question-box"></div>' +
          '<div class="practice-hint" id="nav-hint"></div>' +
          '<div class="practice-nav">' +
            '<button class="btn" id="prev-btn">← 上一题</button>' +
            '<button class="btn btn-primary" id="next-btn">下一题 →</button>' +
          '</div>' +
        '</section>' +
      '</main>';

    var backLink = document.getElementById('back-link');
    backLink.addEventListener('click', function (e) {
      if (wrongMode) return; // 错题模式直接退出
      e.preventDefault();
      showExitModal(board, bank);
    });

    document.getElementById('sidebar-toggle').addEventListener('click', function () {
      document.getElementById('practice-layout').classList.toggle('collapsed');
    });
    document.getElementById('prev-btn').addEventListener('click', function () { goTo(pos - 1); });
    document.getElementById('next-btn').addEventListener('click', function () { onNext(); });

    function curItem() { return items[pos]; }
    function curQ() { return items[pos].bank.questions[items[pos].qi]; }
    function pFor(it) { return progress(it.bank.id); }
    function isAnswered(it) { return pFor(it).answers[it.qi] !== undefined; }

    function goTo(n) {
      if (n < 0) n = 0;
      if (n >= items.length) n = items.length - 1;
      pos = n;
      selected = null;
      if (!wrongMode && bank) progress(bank.id).index = pos;
      saveState();
      renderQuestion();
    }

    function onNext() {
      var it = curItem(), q = curQ();
      if (q.type === 'note') { goTo(pos + 1); return; } // 考点：直接跳下一条
      if (!isAnswered(it)) {
        if (hasSelection(q)) submitCurrent();
        else goTo(pos + 1); // 未作答 → 跳过
      } else {
        goTo(pos + 1);
      }
    }

    function hasSelection(q) {
      if (q.type === 'single' || q.type === 'judge') return selected !== null && selected !== undefined;
      if (q.type === 'multiple') return Array.isArray(selected) && selected.length > 0;
      if (q.type === 'blank') {
        var ins = document.querySelectorAll('#options-box .blank-input');
        return Array.prototype.some.call(ins, function (i) { return i.value.trim() !== ''; });
      }
      if (q.type === 'short') {
        var ta = document.getElementById('short-input');
        return ta && ta.value.trim() !== '';
      }
      return false;
    }

    function readBlank(q) {
      var ins = document.querySelectorAll('#options-box .blank-input');
      var vals = Array.prototype.map.call(ins, function (i) { return i.value; });
      return blankCount(q) === 1 ? vals[0] : vals;
    }
    function readShort() {
      var ta = document.getElementById('short-input');
      return ta ? ta.value : '';
    }

    function submitCurrent() {
      var it = curItem(), q = curQ(), ans, correct;
      if (q.type === 'single') { ans = selected; correct = ans === q.answer; }
      else if (q.type === 'judge') { ans = selected; correct = ans === q.answer; }
      else if (q.type === 'multiple') { ans = selected.slice(); correct = isCorrect(q, ans); }
      else if (q.type === 'blank') { ans = readBlank(q); correct = blankCorrect(q, ans); }
      else if (q.type === 'short') { ans = readShort(); correct = shortCorrect(q.answer, ans); }

      var p = pFor(it);
      p.answers[it.qi] = ans;
      if (q.answer == null) {
        p.results[it.qi] = 'pending'; // 无标准答案：待自行判分或 AI 审阅
      } else {
        p.results[it.qi] = correct ? 'correct' : 'wrong';
        setWrong(it.bank.id, it.qi, !correct);
      }
      p.index = pos;
      saveState();
      selected = null;

      if (wrongMode && correct) removeCurrent();
      else { renderQuestion(); }
    }

    function removeCurrent() {
      items.splice(pos, 1);
      if (items.length === 0) { showCompletion(); return; }
      if (pos >= items.length) pos = items.length - 1;
      renderQuestion();
    }

    function markLearned() {
      var it = curItem();
      setWrong(it.bank.id, it.qi, false);
      saveState();
      removeCurrent();
    }

    function overrideResult(correct) {
      var it = curItem();
      var p = pFor(it);
      p.results[it.qi] = correct ? 'correct' : 'wrong';
      setWrong(it.bank.id, it.qi, !correct);
      saveState();
      renderQuestion();
    }

    function runAIExplain(q, it) {
      var box = document.getElementById('ai-box');
      var btn = document.getElementById('ai-explain');
      var cached = getAIExplain(it.bank.id, it.qi);
      if (cached) {
        box.innerHTML = '<div class="ai-result"><strong>AI 解析：</strong>' + escapeHtml(cached) + '</div>';
        return;
      }
      box.innerHTML = '<div class="ai-loading">AI 解析中…</div>';
      if (btn) btn.disabled = true;
      aiExplain(q).then(function (text) {
        setAIExplain(it.bank.id, it.qi, text);
        box.innerHTML = '<div class="ai-result"><strong>AI 解析：</strong>' + escapeHtml(text) + '</div>';
      }).catch(function (e) {
        box.innerHTML = '<div class="ai-error">' + escapeHtml(e.message || String(e)) + '</div>';
      }).then(function () { if (btn) btn.disabled = false; });
    }

    function runAIReview(q, it) {
      var box = document.getElementById('ai-box');
      var btn = document.getElementById('ai-review');
      box.innerHTML = '<div class="ai-loading">AI 审阅中…</div>';
      btn.disabled = true;
      aiReview(q, pFor(it).answers[it.qi]).then(function (text) {
        var verdict = parseVerdict(text);
        var label = verdict === null ? '无法判断' : (verdict ? '正确' : '错误');
        if (verdict !== null) {
          var p = pFor(it);
          p.results[it.qi] = verdict ? 'correct' : 'wrong';
          setWrong(it.bank.id, it.qi, !verdict);
          saveState();
          var panel = document.querySelector('#question-box .result-panel');
          if (panel) {
            panel.className = 'result-panel ' + (verdict ? 'correct' : 'wrong');
            var tag = panel.querySelector('.result-tag');
            if (tag) tag.textContent = verdict ? '✓ 回答正确' : '✗ 回答错误';
          }
          renderSidebar();
        }
        box.innerHTML = '<div class="ai-result"><strong>AI 审阅：' + label + '</strong><br>' + escapeHtml(text) + '</div>';
      }).catch(function (e) {
        box.innerHTML = '<div class="ai-error">' + escapeHtml(e.message || String(e)) + '</div>';
      }).then(function () { btn.disabled = false; });
    }

    function showCompletion() {
      app.innerHTML =
        '<header class="topbar"><div class="topbar-inner">' +
          '<a class="back-link" href="#/board/' + board.id + '">← 返回</a>' +
          '<div class="topbar-title">' + escapeHtml(title) + '</div>' +
        '</div></header>' +
        '<main class="container"><div class="empty-state">🎉 错题已全部掌握，太棒了！<br><br>' +
        '<a class="btn btn-primary" href="#/board/' + board.id + '">返回板块</a></div></main>';
    }

    function updateProgress() {
      document.getElementById('practice-fill').style.width = ((pos + 1) / items.length * 100) + '%';
      document.getElementById('practice-count').textContent = '第 ' + (pos + 1) + ' / ' + items.length + ' 题';
      renderSidebar();
      refreshNav();
    }

    function refreshNav() {
      var q = curQ(), it = curItem();
      var btn = document.getElementById('next-btn');
      var hint = document.getElementById('nav-hint');
      if (q.type === 'note') {
        btn.textContent = '下一题 →';
        hint.textContent = '考点，点击「下一题」继续';
        return;
      }
      var answered = isAnswered(it);
      if (answered) {
        btn.textContent = '下一题 →';
        hint.textContent = '点击「下一题」继续';
      } else if (hasSelection(q)) {
        btn.textContent = '查看答案';
        hint.textContent = '已作答，点击「查看答案」显示解析';
      } else {
        btn.textContent = '下一题 →';
        hint.textContent = '选择答案后点击「下一题」；不答则跳过本题';
      }
    }

    function renderSidebar() {
      var grid = document.getElementById('sidebar-grid');
      var html = '';
      var lastChapter = null;
      items.forEach(function (it, idx) {
        var q = it.bank.questions[it.qi];
        var chapter = q.chapter || '';
        if (chapter !== lastChapter) {
          if (chapter) html += '<div class="slide-chapter">' + escapeHtml(chapter) + '</div>';
          lastChapter = chapter;
        }
        var p = pFor(it);
        var answered = p.answers[it.qi] !== undefined;
        var res = p.results[it.qi];
        var cls = 'slide-item';
        if (q.type === 'note') cls += ' note';
        else if (idx === pos) cls += ' current';
        else if (answered) cls += res === 'correct' ? ' correct' : (res === 'wrong' ? ' wrong' : ' pending');
        var preview = q.stem.replace(/\s+/g, ' ').trim();
        if (preview.length > 42) preview = preview.slice(0, 42) + '…';
        html += '<button class="' + cls + '" data-idx="' + idx + '">' +
          '<span class="slide-no">' + (idx + 1) + '</span>' +
          '<span class="slide-preview">' + escapeHtml(preview) + '</span>' +
        '</button>';
      });
      grid.innerHTML = html;
      Array.prototype.forEach.call(grid.querySelectorAll('.slide-item'), function (btn) {
        btn.addEventListener('click', function () { goTo(parseInt(btn.dataset.idx, 10)); });
      });
    }

    function renderQuestion() {
      updateProgress();
      var it = curItem(), q = curQ(), p = pFor(it);
      if (q.type === 'note') {
        document.getElementById('question-box').innerHTML =
          '<div class="question-card note-card">' +
            '<div class="question-meta">' +
              '<span class="type-badge type-note">考点</span>' +
              '<span class="question-no">第 ' + (pos + 1) + ' / ' + items.length + ' 条</span>' +
            '</div>' +
            '<div class="question-stem">' + escapeHtml(q.stem) + '</div>' +
          '</div>';
        refreshNav();
        return;
      }
      var answered = p.answers[it.qi] !== undefined;
      var saved = p.answers[it.qi];
      var correct = p.results[it.qi] === 'correct';
      var key = it.bank.id + ':' + it.qi;
      if (key !== lastKey) { selected = null; lastKey = key; }

      var metaBtn;
      if (wrongMode) {
        metaBtn = '<button class="wrong-toggle active" id="learned-btn">✓ 已学会</button>';
      } else {
        metaBtn = '<button class="wrong-toggle' + (isWrong(it.bank.id, it.qi) ? ' active' : '') + '" id="wrong-toggle">' +
          (isWrong(it.bank.id, it.qi) ? '✓ 已在错题集' : '标为错题') + '</button>';
      }

      var meta =
        '<span class="type-badge type-' + q.type + '">' + TYPE_LABELS[q.type] + '</span>' +
        '<span class="question-no">第 ' + (pos + 1) + ' / ' + items.length + ' 题</span>' +
        metaBtn;

      document.getElementById('question-box').innerHTML =
        '<div class="question-card">' +
          '<div class="question-meta">' + meta + '</div>' +
          '<div class="question-stem">' + escapeHtml(q.stem) + '</div>' +
          '<div class="question-options" id="options-box">' + optionsHtml(q, answered, saved, correct) + '</div>' +
          (answered ? resultHtml(q, correct) : '') +
        '</div>';

      if (wrongMode) {
        document.getElementById('learned-btn').addEventListener('click', markLearned);
      } else {
        document.getElementById('wrong-toggle').addEventListener('click', function () {
          setWrong(it.bank.id, it.qi, !isWrong(it.bank.id, it.qi));
          saveState();
          renderQuestion();
        });
      }

      bindOptions(q, it, answered);

      var redo = document.getElementById('redo-btn');
      if (redo) {
        redo.addEventListener('click', function () {
          var p = pFor(it);
          delete p.answers[it.qi];
          delete p.results[it.qi];
          saveState();
          selected = null;
          renderQuestion();
        });
      }
      var or1 = document.getElementById('override-right');
      var or2 = document.getElementById('override-wrong');
      if (or1) or1.addEventListener('click', function () { overrideResult(true); });
      if (or2) or2.addEventListener('click', function () { overrideResult(false); });

      var aiEx = document.getElementById('ai-explain');
      if (aiEx) aiEx.addEventListener('click', function () { runAIExplain(q, it); });
      var aiRev = document.getElementById('ai-review');
      if (aiRev) aiRev.addEventListener('click', function () { runAIReview(q, it); });

      // 显示答案时自动带出 AI 解析（有缓存直接显示，有 Key 才调用）
      if (answered && (getAIExplain(it.bank.id, it.qi) || loadSettings().apiKey)) {
        runAIExplain(q, it);
      }

      refreshNav();
    }

    function optionsHtml(q, answered, saved, correct) {
      var html = '';
      if (q.type === 'single' || q.type === 'judge') {
        var opts = q.type === 'judge' ? ['正确', '错误'] : q.options;
        html = opts.map(function (opt, i) {
          var isAns = q.type === 'judge' ? (i === 0) === q.answer : i === q.answer;
          var cls = '';
          if (answered) {
            var isSel = q.type === 'judge' ? (i === 0) === saved : i === saved;
            if (isAns) cls = ' opt-correct';
            else if (isSel) cls = ' opt-wrong';
          } else {
            var sel = q.type === 'judge' ? (i === 0) === selected : i === selected;
            if (sel) cls = ' opt-selected';
          }
          return '<button class="option' + cls + '" data-index="' + i + '"' + (answered ? ' disabled' : '') + '>' +
            '<span class="opt-letter">' + (q.type === 'judge' ? (i === 0 ? '✓' : '✗') : letter[i]) + '</span>' +
            '<span class="opt-text">' + escapeHtml(opt) + '</span>' +
          '</button>';
        }).join('');
      } else if (q.type === 'multiple') {
        html = '<div class="opt-hint">多选题：选好后点击「下一题」提交</div>' +
          q.options.map(function (opt, i) {
            var isAns = q.answer.indexOf(i) !== -1;
            var cls = '';
            if (answered) {
              var isSel = saved.indexOf(i) !== -1;
              if (isAns) cls = ' opt-correct';
              else if (isSel) cls = ' opt-wrong';
            } else if (Array.isArray(selected) && selected.indexOf(i) !== -1) {
              cls = ' opt-selected';
            }
            return '<button class="option' + cls + '" data-index="' + i + '"' + (answered ? ' disabled' : '') + '>' +
              '<span class="opt-letter">' + letter[i] + '</span>' +
              '<span class="opt-text">' + escapeHtml(opt) + '</span>' +
            '</button>';
          }).join('');
      } else if (q.type === 'blank') {
        var n = blankCount(q);
        html = '<div class="blank-inputs">' + Array(n).fill(0).map(function (_, i) {
          var val = answered ? (Array.isArray(saved) ? saved[i] : (i === 0 ? saved : '')) : '';
          var valHtml = answered ? ' value="' + escapeHtml(val == null ? '' : val) + '"' : '';
          var cls = '';
          if (answered) {
            var exp = Array.isArray(q.answer) ? q.answer[i] : q.answer;
            var got = Array.isArray(saved) ? saved[i] : saved;
            cls = sameAnswer(exp, got) ? ' correct' : ' wrong';
          }
          return '<div class="blank-row"><span class="blank-label">' + (i + 1) + '</span>' +
            '<input class="blank-input' + cls + '" data-index="' + i + '"' + valHtml + (answered ? ' disabled' : '') + '>' +
          '</div>';
        }).join('') + '</div>';
      } else if (q.type === 'short') {
        var savedText = answered ? (typeof saved === 'string' ? saved : '') : '';
        html = '<textarea class="short-input" id="short-input" placeholder="在此写下你的答案（需与参考答案完全一致）"' +
          (answered ? ' disabled' : '') + '>' + (answered ? escapeHtml(savedText) : '') + '</textarea>';
      }
      return html;
    }

    function bindOptions(q, it, answered) {
      if (answered) return;

      if (q.type === 'single' || q.type === 'judge') {
        var btns = document.querySelectorAll('#options-box .option');
        Array.prototype.forEach.call(btns, function (btn) {
          btn.addEventListener('click', function () {
            var i = parseInt(btn.dataset.index, 10);
            selected = (q.type === 'judge') ? (i === 0) : i;
            Array.prototype.forEach.call(btns, function (b) {
              b.classList.toggle('opt-selected', parseInt(b.dataset.index, 10) === i);
            });
            refreshNav();
          });
        });
      } else if (q.type === 'multiple') {
        if (!Array.isArray(selected)) selected = [];
        var mbtns = document.querySelectorAll('#options-box .option');
        Array.prototype.forEach.call(mbtns, function (btn) {
          btn.addEventListener('click', function () {
            var i = parseInt(btn.dataset.index, 10);
            var idx = selected.indexOf(i);
            if (idx === -1) { selected.push(i); btn.classList.add('opt-selected'); }
            else { selected.splice(idx, 1); btn.classList.remove('opt-selected'); }
            refreshNav();
          });
        });
      }
      // 填空 / 简答：点击「下一题」时读取输入，无需单独绑定
    }

    function resultHtml(q, correct) {
      var noAnswer = q.answer == null;
      var showAnswer = !noAnswer && (q.type === 'short' || !correct);
      var showOverride = q.type === 'short' || noAnswer;
      var showAIReview = q.type === 'short' || q.type === 'blank' || noAnswer;
      var showAIExplain = !noAnswer;
      var panelClass = noAnswer ? 'pending' : (correct ? 'correct' : 'wrong');
      var tag = noAnswer ? '📝 本题未提供标准答案（请自行判分，或用下方 AI 审阅）'
        : (correct ? '✓ 回答正确' : '✗ 回答错误') + (q.type === 'short' ? '（本地判分：与答案完全一致才算对，可 AI 审阅）' : '');
      var override = showOverride
        ? '<div class="override-row"><span>手动判分：</span>' +
          '<button class="btn btn-sm" id="override-right">判为正确</button>' +
          '<button class="btn btn-sm" id="override-wrong">判为错误</button></div>'
        : '';
      return '<div class="result-panel ' + panelClass + '">' +
        '<div class="result-tag">' + tag + '</div>' +
        (showAnswer ? '<div class="answer-ref"><strong>正确答案：</strong>' + escapeHtml(formatAnswer(q)) + '</div>' : '') +
        (q.explanation ? '<div class="explanation"><strong>解析：</strong>' + escapeHtml(q.explanation) + '</div>' : '') +
        override +
        '<div id="ai-box"></div>' +
        '<div class="result-actions">' +
          (showAIExplain ? '<button class="btn btn-sm" id="ai-explain">🤖 AI 解析</button>' : '') +
          (showAIReview ? '<button class="btn btn-sm" id="ai-review">🤖 AI 审阅</button>' : '') +
          '<button class="btn btn-sm" id="redo-btn">重新作答</button>' +
        '</div>' +
      '</div>';
    }

    renderQuestion();
  }

  /* ================= 退出确认 ================= */
  function showExitModal(board, bank) {
    var overlay = document.createElement('div');
    overlay.className = 'modal-overlay';
    overlay.innerHTML =
      '<div class="modal">' +
        '<h3>退出题库</h3>' +
        '<p>是否保存本次刷题进度？</p>' +
        '<p class="modal-sub">「不保存」将重置该题库的作答进度与错题记录</p>' +
        '<div class="modal-actions">' +
          '<button class="btn" data-act="cancel">取消</button>' +
          '<button class="btn" data-act="reset">不保存，重置进度</button>' +
          '<button class="btn btn-primary" data-act="save">保存并退出</button>' +
        '</div>' +
      '</div>';
    document.body.appendChild(overlay);
    overlay.addEventListener('click', function (e) {
      var btn = e.target.closest('[data-act]');
      if (!btn) return;
      var act = btn.dataset.act;
      document.body.removeChild(overlay);
      if (act === 'cancel') return;
      if (act === 'reset') {
        delete state.progress[bank.id];
        delete state.wrongSet[bank.id];
        saveState();
      }
      location.hash = '#/board/' + board.id;
    });
  }

  /* ================= 启动 ================= */
  document.addEventListener('click', function (e) {
    if (e.target.closest('#settings-btn')) openSettings();
  });
  window.addEventListener('hashchange', render);
  render();
})();
