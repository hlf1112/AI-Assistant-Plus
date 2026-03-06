// 全局变量
let chatHistory = [];
let currentUserId = null;
let allHistoryLogs = []; // 【新增】在前端缓存加载到的历史记录，方便快速恢复

// ==========================================
// 1. 认证与基础逻辑
// ==========================================

function toggleAuthMode(mode) {
    const loginForm = document.getElementById('login-form');
    const regForm = document.getElementById('register-form');
    if (mode === 'register') {
        loginForm.classList.add('hidden');
        regForm.classList.remove('hidden');
    } else {
        loginForm.classList.remove('hidden');
        regForm.classList.add('hidden');
    }
}

async function login() {
    const userField = document.getElementById('login-username');
    const passField = document.getElementById('login-password');
    if (!userField.value || !passField.value) return alert("请输入用户名和密码");

    try {
        const response = await fetch('/api/login', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username: userField.value, password: passField.value })
        });
        const result = await response.json();
        if (result.success) {
            enterApp(result.username, result.userId);
        } else {
            alert("❌ 登录失败: " + result.message);
        }
    } catch (e) {
        alert("网络错误");
    }
}

async function register() {
    const username = document.getElementById('reg-username').value;
    const password = document.getElementById('reg-password').value;
    const confirm = document.getElementById('reg-confirm').value;

    if (!username || !password) return alert("请填写完整");
    if (password !== confirm) return alert("密码不一致");

    try {
        const response = await fetch('/api/register', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ username, password })
        });
        const result = await response.json();
        if (result.success) {
            alert("✅ 注册成功！请登录。");
            toggleAuthMode('login');
        } else {
            alert("❌ 注册失败: " + result.message);
        }
    } catch (e) { alert("网络错误"); }
}

function showAppAsGuest() {
    enterApp("Guest (试用)", "guest");
}

function enterApp(username, userId) {
    document.getElementById('auth-view').classList.add('hidden');
    document.getElementById('app-view').classList.remove('hidden');
    document.getElementById('display-username').innerText = username;
    currentUserId = userId;

    // 登录后默认显示新对话窗口
    startNewChat();
    // 加载侧边栏历史记录列表
    loadHistory();
}

async function logout() {
    try { await fetch('/api/logout', { method: 'POST' }); } catch (e) {}
    location.reload(); // 直接刷新页面最干净
}

// ==========================================
// 2. 聊天与历史记录管理 (核心修改)
// ==========================================

// 【新功能】发起新对话：清空界面，重置上下文
function startNewChat() {
    chatHistory = []; // 清空发给 AI 的记忆
    const chatBox = document.getElementById('chatBox');
    // 显示欢迎语
    chatBox.innerHTML = `
        <div class="msg-row">
            <div class="ai-label">AI 助手</div>
            <div class="ai-msg">你好！我是你的智能文档助手。点击“发起新对话”可随时开启新话题，点击左侧历史记录可“穿越”回过去接着聊。</div>
        </div>
    `;
}

// 加载历史记录 (仅渲染侧边栏列表)
async function loadHistory() {
    const historyList = document.getElementById('history-list');
    historyList.innerHTML = '<div class="empty-history" style="padding:10px;">⏳ 加载中...</div>';

    try {
        const response = await fetch(`/api/history?userId=${currentUserId}`);
        const data = await response.json();

        // 缓存数据，供点击时使用
        allHistoryLogs = data || [];

        historyList.innerHTML = '';
        if (data && data.length > 0) {
            data.forEach((log, index) => {
                // 侧边栏只显示用户的提问
                if (log.role === 'user') {
                    const item = document.createElement('div');
                    item.className = 'history-item';

                    // 截取预览
                    const preview = log.content.length > 18 ? log.content.substring(0, 18) + '...' : log.content;

                    item.innerHTML = `
                        <span class="history-text" title="${log.content}">👤 ${preview}</span>
                        <i class="fa-solid fa-trash-can btn-delete-log" onclick="deleteLog(${log.id}, event)" title="删除此条"></i>
                    `;

                    // 【关键】点击列表项 -> 恢复那场对话
                    item.onclick = () => restoreSession(index);

                    historyList.appendChild(item);
                }
            });
        } else {
            historyList.innerHTML = '<div class="empty-history" style="padding:10px;">暂无历史记录</div>';
        }
    } catch (e) {
        historyList.innerHTML = '<div class="empty-history">加载失败</div>';
    }
}

// 【新功能】恢复特定会话：加载 用户提问 + AI回答 到聊天框
function restoreSession(userLogIndex) {
    const chatBox = document.getElementById('chatBox');
    chatBox.innerHTML = ''; // 清空当前界面
    chatHistory = []; // 重置上下文

    // 1. 获取用户的那条提问
    const userLog = allHistoryLogs[userLogIndex];

    // 2. 尝试获取紧随其后的 AI 回答
    // (因为列表是按时间倒序的，所以回答通常在 index - 1 的位置)
    let aiLog = null;
    if (userLogIndex > 0 && allHistoryLogs[userLogIndex - 1].role === 'model') {
        aiLog = allHistoryLogs[userLogIndex - 1];
    }

    // 3. 渲染到界面
    renderMsg('user', userLog.content);
    if (aiLog) {
        renderMsg('model', aiLog.content);
        // 恢复上下文记忆，这样用户可以接着聊
        chatHistory.push({ role: 'user', content: userLog.content });
        chatHistory.push({ role: 'model', content: aiLog.content });
    } else {
        // 如果没有找到 AI 回答（比如当时报错了），只渲染用户的问句
        chatHistory.push({ role: 'user', content: userLog.content });
    }

    // 滚动到底部
    chatBox.scrollTop = chatBox.scrollHeight;
}

// 辅助渲染函数
function renderMsg(role, content) {
    const chatBox = document.getElementById('chatBox');
    const isUser = role === 'user';
    const msgDiv = document.createElement('div');
    msgDiv.className = 'msg-row';

    // 【核心修复】如果内容包含字面量的 "\n"，强制替换为真正的换行符
    if (content && typeof content === 'string') {
        content = content.replace(/\\n/g, '\n');
    }

    // 尝试渲染 Markdown
    let htmlContent = content;
    if (!isUser && typeof marked !== 'undefined') {
        htmlContent = marked.parse(content);
    }

    msgDiv.innerHTML = `
        <div class="${isUser ? 'user-label' : 'ai-label'}">${isUser ? '我 (历史)' : 'Gemini AI (历史)'}</div>
        <div class="${isUser ? 'user-msg' : 'ai-msg'}">${htmlContent}</div>
    `;
    chatBox.appendChild(msgDiv);
}

// 删除历史记录
async function deleteLog(logId, event) {
    event.stopPropagation(); // 阻止触发 restoreSession
    if (!confirm("确定删除这条记录吗？")) return;
    try {
        await fetch(`/api/history/${logId}`, { method: 'DELETE' });
        loadHistory(); // 刷新列表
        // 如果删除的是当前正在看的对话，建议清空一下
        // startNewChat();
    } catch (e) { alert("删除失败"); }
}

// ==========================================
// 3. 发送消息与上传 (逻辑不变)
// ==========================================

async function ask() {
    const qInput = document.getElementById('question');
    const q = qInput.value.trim();
    if(!q) return;

    const chatBox = document.getElementById('chatBox');
    const btn = document.getElementById('btnSend');
    const useRag = document.getElementById('ragSwitch').checked;

    // 渲染用户消息
    chatBox.innerHTML += `
        <div class="msg-row">
            <div class="user-label">我</div>
            <div class="user-msg">${q}</div>
        </div>
    `;
    qInput.value = '';
    btn.disabled = true;

    // 占位
    const aiContainer = document.createElement('div');
    aiContainer.className = 'msg-row';
    aiContainer.innerHTML = `<div class="ai-label">Gemini AI</div><div class="ai-msg">Thinking...</div>`;
    chatBox.appendChild(aiContainer);
    chatBox.scrollTop = chatBox.scrollHeight;

    const aiMsgDiv = aiContainer.querySelector('.ai-msg');
    let fullRawText = "";
    let isFirstChunk = true;

    try {
        const response = await fetch('/api/ask', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                question: q,
                enable_rag: useRag,
                history: chatHistory.slice(-10), // 只带最近10条记忆
                userId: currentUserId
            })
        });

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            const chunk = decoder.decode(value, { stream: true });
            const lines = chunk.split('\n\n');
            for (const line of lines) {
                if (line.trim().startsWith('data:')) {
                    if (isFirstChunk) { aiMsgDiv.innerHTML = ''; isFirstChunk = false; }
                    const content = line.substring(5).replace(/\\n/g, '\n');
                    fullRawText += content;
                    aiMsgDiv.innerHTML = (typeof marked !== 'undefined') ? marked.parse(fullRawText) : fullRawText;
                    chatBox.scrollTop = chatBox.scrollHeight;
                }
            }
        }
        // 更新上下文
        chatHistory.push({ role: 'user', content: q });
        chatHistory.push({ role: 'model', content: fullRawText });

        // 刷新左侧历史记录列表，让刚问的问题出现在列表顶端
        loadHistory();

    } catch (error) {
        aiMsgDiv.innerHTML += `<br><span style="color:red">Error: ${error.message}</span>`;
    } finally {
        btn.disabled = false;
        qInput.focus();
    }
}

// 保持 uploadAndTrain 和 resetKb 原样...
document.getElementById('fileInput').addEventListener('change', function(e) {
    document.getElementById('fileNameDisplay').innerText = e.target.files[0]?.name || "未选择文件";
});

async function uploadAndTrain() {
    // ... (你的原有上传代码) ...
    // 为节省篇幅，这里略去，请直接复用你之前的 uploadAndTrain 和 resetKb 函数
    const fileInput = document.getElementById('fileInput');
    const status = document.getElementById('status');
    const btn = document.getElementById('btnTrain');
    if(fileInput.files.length===0) return alert("请选择文件");
    const formData = new FormData();
    formData.append("file", fileInput.files[0]);
    if(currentUserId) formData.append("userId", currentUserId);

    btn.disabled=true; status.innerHTML="⏳ 上传中...";
    try {
        const res = await fetch('/api/upload', {method:'POST', body:formData});
        const json = await res.json();
        if(json.message) {
            const name = document.getElementById('display-username').innerText;
            status.innerHTML = `✅ 已学习 (用户: ${name})`;
            status.style.color = "#27ae60";
        } else { throw new Error(json.error); }
    } catch(e) {
        status.innerHTML = "❌ " + e.message;
        status.style.color = "#c0392b";
    } finally { btn.disabled=false; }
}

async function resetKb() {
    if(!confirm("确认清空?")) return;
    try {
        await fetch('/api/reset', {method:'POST'});
        alert("已清空");
    } catch(e){ alert("失败"); }
}