// MessageV2 Chrome Extension Background Service Worker
const WS_URL = "ws://127.0.0.1:8000/ws/extension";
const HEALTH_URL = "http://127.0.0.1:8000/api/health";
let ws = null;
let reconnectTimer = null;
let isConnecting = false;

async function isBackendReachable() {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 1200);
    const res = await fetch(HEALTH_URL, {
      method: "GET",
      cache: "no-store",
      headers: { "Accept": "application/json" },
      signal: controller.signal
    });
    clearTimeout(timeoutId);
    return res.ok;
  } catch (e) {
    return false;
  }
}

async function connect() {
  if (isConnecting) return;
  if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
    return;
  }

  isConnecting = true;
  try {
    // Probe backend first so Chrome doesn't throw net::ERR_CONNECTION_REFUSED on chrome://extensions
    const reachable = await isBackendReachable();
    if (!reachable) {
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, 4000);
      return;
    }

    if (ws && (ws.readyState === WebSocket.CONNECTING || ws.readyState === WebSocket.OPEN)) {
      return;
    }

    console.log("[MessageV2 Extension] Connecting to", WS_URL);
    ws = new WebSocket(WS_URL);

    ws.onopen = () => {
      console.log("[MessageV2 Extension] Connected to backend!");
      ws.send(JSON.stringify({ type: "HELLO", payload: { client: "chrome_extension", version: "1.0" } }));
    };

    ws.onmessage = async (event) => {
      let data = null;
      try {
        data = JSON.parse(event.data);
        console.log("[MessageV2 Extension] Received command:", data.action, data);
        const res = await handleCommand(data);
        if (ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({
            id: data.id,
            action: data.action,
            ...res
          }));
        }
      } catch (err) {
        console.warn("[MessageV2 Extension] Error handling message:", err);
        if (data && data.id && ws && ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ id: data.id, success: false, error: String(err) }));
        }
      }
    };

    ws.onerror = (e) => {
      console.log("[MessageV2 Extension] WS connection state:", ws ? ws.readyState : "null");
    };

    ws.onclose = () => {
      console.log("[MessageV2 Extension] Disconnected, scheduling reconnect probe in 3s...");
      ws = null;
      clearTimeout(reconnectTimer);
      reconnectTimer = setTimeout(connect, 3000);
    };
  } catch (err) {
    console.debug("[MessageV2 Extension] Connection probe catch:", err);
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 4000);
  } finally {
    isConnecting = false;
  }
}

// Keep service worker active
try {
  if (chrome.alarms) {
    chrome.alarms.create("keepAlive", { periodInMinutes: 0.3 });
    chrome.alarms.onAlarm.addListener(() => {
      connect();
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ type: "PING" }));
      }
    });
  }
} catch (e) {
  console.log("[MessageV2 Extension] Alarms setup error:", e);
}

// Wait for a tab to finish loading
function waitForTabLoaded(tabId, timeoutMs = 15000) {
  return new Promise((resolve) => {
    let resolved = false;
    const cleanup = () => {
      chrome.tabs.onUpdated.removeListener(listener);
      chrome.tabs.onRemoved.removeListener(removeListener);
    };

    const finish = () => {
      if (!resolved) {
        resolved = true;
        cleanup();
        setTimeout(resolve, 1500); // 1.5s for DOM hydration
      }
    };

    function removeListener(closedTabId) {
      if (closedTabId === tabId) {
        if (!resolved) {
          resolved = true;
          cleanup();
          resolve();
        }
      }
    }

    function listener(id, changeInfo, tab) {
      if (id === tabId && changeInfo.status === "complete") {
        finish();
      }
    }

    chrome.tabs.onUpdated.addListener(listener);
    chrome.tabs.onRemoved.addListener(removeListener);

    chrome.tabs.get(tabId).then((t) => {
      if (t && t.status === "complete") {
        finish();
      }
    }).catch(() => {});

    setTimeout(() => {
      finish();
    }, timeoutMs);
  });
}

// Dedicated automation tabs isolation for Worker 1 & Worker 2
let outreachTabId = null;
let scannerTabId = null;
let attachedDebuggerTabs = new Set();

async function ensureScreencastForTab(tabId, workerTag = "outreach") {
  if (!chrome.debugger) return;
  if (attachedDebuggerTabs.has(tabId)) return;

  try {
    await chrome.debugger.attach({ tabId }, "1.3");
    attachedDebuggerTabs.add(tabId);
    await chrome.debugger.sendCommand({ tabId }, "Page.startScreencast", {
      format: "jpeg",
      quality: 60,
      maxWidth: 960,
      maxHeight: 720,
      everyNthFrame: 1
    });
    console.log(`[MessageV2 Extension] Live screencast started on ${workerTag} tab:`, tabId);

    // Immediately push initial screenshot frame so backend stream is populated without waiting for page invalidation
    try {
      const shot = await chrome.debugger.sendCommand({ tabId }, "Page.captureScreenshot", {
        format: "jpeg",
        quality: 60
      });
      if (shot && shot.data && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: "LIVE_FRAME",
          worker: workerTag,
          tabId: tabId,
          data: shot.data
        }));
      }
    } catch (e) {}
  } catch (err) {
    if (String(err?.message || err).includes("Another debugger is already attached")) {
      attachedDebuggerTabs.add(tabId);
    }
    console.log(`[MessageV2 Extension] Screencast notice on ${workerTag} tab:`, tabId, err);
  }
}

// Periodic keep-alive screenshot probe for idle tabs so live feed never freezes when static
setInterval(async () => {
  if (!ws || ws.readyState !== WebSocket.OPEN || !chrome.debugger) return;
  for (const tabId of Array.from(attachedDebuggerTabs)) {
    try {
      const workerTag = (tabId === scannerTabId) ? "scanner" : "outreach";
      const shot = await chrome.debugger.sendCommand({ tabId }, "Page.captureScreenshot", {
        format: "jpeg",
        quality: 55
      });
      if (shot && shot.data && ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: "LIVE_FRAME",
          worker: workerTag,
          tabId: tabId,
          data: shot.data
        }));
      }
    } catch (e) {}
  }
}, 3000);

if (chrome.debugger) {
  chrome.debugger.onEvent.addListener((source, method, params) => {
    if (method === "Page.screencastFrame" && params.data) {
      const workerTag = (source.tabId === scannerTabId) ? "scanner" : "outreach";
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: "LIVE_FRAME",
          worker: workerTag,
          tabId: source.tabId,
          data: params.data
        }));
      }
      chrome.debugger.sendCommand(
        { tabId: source.tabId },
        "Page.screencastFrameAck",
        { sessionId: params.sessionId }
      ).catch(() => {});
    }
  });

  chrome.debugger.onDetach.addListener((source, reason) => {
    console.log("[MessageV2 Extension] Screencast detached from tab:", source.tabId, reason);
    attachedDebuggerTabs.delete(source.tabId);
  });
}

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === outreachTabId) {
    console.log("[MessageV2 Extension] Outreach tab was closed. Resetting allocation.");
    outreachTabId = null;
    attachedDebuggerTabs.delete(tabId);
  }
  if (tabId === scannerTabId) {
    console.log("[MessageV2 Extension] Scanner tab was closed. Resetting allocation.");
    scannerTabId = null;
    attachedDebuggerTabs.delete(tabId);
  }
});

// Worker 1 Outreach Tab (Instagram Profiles & Composer)
async function getOutreachTab() {
  if (outreachTabId !== null) {
    try {
      const existing = await chrome.tabs.get(outreachTabId);
      if (existing && !existing.discarded) {
        if (existing.status === "loading") {
          await waitForTabLoaded(existing.id, 10000);
        }
        ensureScreencastForTab(existing.id, "outreach").catch(() => {});
        return existing;
      }
    } catch (e) {
      outreachTabId = null;
    }
  }

  // Find an existing Instagram tab that is NOT the scanner tab
  const tabs = await chrome.tabs.query({ url: ["*://*.instagram.com/*", "*://instagram.com/*"] });
  for (const t of tabs) {
    if (t.id !== scannerTabId && (!t.url || !t.url.includes("/direct/inbox"))) {
      outreachTabId = t.id;
      ensureScreencastForTab(outreachTabId, "outreach").catch(() => {});
      return t;
    }
  }

  // Create dedicated Outreach tab in background
  console.log("[MessageV2 Extension] Creating dedicated Outreach tab (Tab A)...");
  const newTab = await chrome.tabs.create({ url: "https://www.instagram.com/", active: false });
  outreachTabId = newTab.id;
  await waitForTabLoaded(newTab.id, 15000);
  ensureScreencastForTab(newTab.id, "outreach").catch(() => {});
  return newTab;
}

// Worker 2 Reply Scanner Tab (/direct/inbox/)
async function getScannerTab() {
  if (scannerTabId !== null) {
    try {
      const existing = await chrome.tabs.get(scannerTabId);
      if (existing && !existing.discarded) {
        if (existing.status === "loading") {
          await waitForTabLoaded(existing.id, 10000);
        }
        ensureScreencastForTab(existing.id, "scanner").catch(() => {});
        return existing;
      }
    } catch (e) {
      scannerTabId = null;
    }
  }

  // Look for an existing direct/inbox tab
  const tabs = await chrome.tabs.query({ url: ["*://*.instagram.com/direct/*", "*://instagram.com/direct/*"] });
  for (const t of tabs) {
    if (t.id !== outreachTabId) {
      scannerTabId = t.id;
      ensureScreencastForTab(scannerTabId, "scanner").catch(() => {});
      return t;
    }
  }

  // Create dedicated Scanner tab in background
  console.log("[MessageV2 Extension] Creating dedicated Reply Scanner tab (Tab B)...");
  const newTab = await chrome.tabs.create({ url: "https://www.instagram.com/direct/inbox/", active: false });
  scannerTabId = newTab.id;
  await waitForTabLoaded(newTab.id, 15000);
  ensureScreencastForTab(newTab.id, "scanner").catch(() => {});
  return newTab;
}

// Router helper to select proper tab
async function getTargetTab(action, payload, msg) {
  if (msg?.worker === "scanner" || msg?.target === "scanner" || payload?.worker === "scanner" || payload?.target === "scanner" || action === "SCAN_INBOX_REPLIES" || action === "INSPECT_THREAD_REPLY") {
    return await getScannerTab();
  }
  return await getOutreachTab();
}

async function handleCommand(msg) {
  const { action, payload = {} } = msg;

  if (action === "PING") {
    return { success: true, pong: true };
  }

  if (action === "RELOAD_EXTENSION") {
    console.log("[MessageV2 Extension] Reloading extension...");
    setTimeout(() => {
      chrome.runtime.reload();
    }, 200);
    return { success: true, reloaded: true };
  }

  if (action === "START_SCREENCAST") {
    // Non-blocking attachment so backend doesn't time out waiting for tab network loads
    (async () => {
      try {
        const tabA = await getOutreachTab();
        if (tabA && tabA.id) {
          await ensureScreencastForTab(tabA.id, "outreach");
        }
      } catch (e) {}
      try {
        const tabB = await getScannerTab();
        if (tabB && tabB.id) {
          await ensureScreencastForTab(tabB.id, "scanner");
        }
      } catch (e) {}
    })();
    return { success: true, screencasting: true, outreachTabId, scannerTabId };
  }

  if (action === "CAPTURE_SCREENSHOT") {
    try {
      const targetWorker = (payload && payload.worker) || msg.worker || (msg.target === "scanner" ? "scanner" : "outreach");
      const tab = (targetWorker === "scanner") ? await getScannerTab() : await getOutreachTab();

      // 1. Isolated tab capture via Debugger (captures THIS tab exclusively, even in background)
      if (chrome.debugger && tab && tab.id) {
        try {
          await ensureScreencastForTab(tab.id, targetWorker);
          const shot = await chrome.debugger.sendCommand({ tabId: tab.id }, "Page.captureScreenshot", {
            format: "jpeg",
            quality: 65
          });
          if (shot && shot.data) {
            return { success: true, dataUrl: "data:image/jpeg;base64," + shot.data, worker: targetWorker };
          }
        } catch (dbgErr) {
          console.log("[MessageV2 Extension] Debugger capture fallback to window:", dbgErr);
        }
      }

      // 2. Fallback to captureVisibleTab
      let targetWinId = tab && tab.windowId ? tab.windowId : null;
      if (!targetWinId) {
        const activeTabs = await chrome.tabs.query({ active: true, lastFocusedWindow: true });
        if (activeTabs.length > 0 && activeTabs[0].windowId) {
          targetWinId = activeTabs[0].windowId;
        } else {
          const allWins = await chrome.windows.getAll({ windowTypes: ["normal"] });
          if (allWins.length > 0) {
            targetWinId = allWins[0].id;
          }
        }
      }

      if (targetWinId) {
        try {
          const win = await chrome.windows.get(targetWinId);
          if (win && win.state === "minimized") {
            await chrome.windows.update(targetWinId, { state: "normal" });
          }
        } catch (e) {}
      }

      const captureOptions = { format: "jpeg", quality: 65 };
      const dataUrl = await new Promise((resolve, reject) => {
        chrome.tabs.captureVisibleTab(targetWinId, captureOptions, (result) => {
          if (chrome.runtime.lastError || !result) {
            chrome.tabs.captureVisibleTab(null, captureOptions, (res2) => {
              if (chrome.runtime.lastError || !res2) {
                const msg = chrome.runtime.lastError ? chrome.runtime.lastError.message : "Empty capture buffer";
                reject(new Error(msg));
              } else {
                resolve(res2);
              }
            });
          } else {
            resolve(result);
          }
        });
      });
      return { success: true, dataUrl, worker: targetWorker };
    } catch (err) {
      console.log("[MessageV2 Extension] captureVisibleTab error:", err);
      return { success: false, error: String(err) };
    }
  }

  const tab = await getTargetTab(action, payload, msg);
  if (!tab || !tab.id) {
    return { success: false, error: "No target Instagram tab found" };
  }

  if (action === "GET_STATE" || action === "CHECK_LOGIN") {
    // 1. Check cookies directly (foolproof authentication check)
    let hasSessionCookie = false;
    let userId = null;
    try {
      if (chrome.cookies) {
        const sessionCookie = await chrome.cookies.get({ url: "https://www.instagram.com", name: "sessionid" });
        const userCookie = await chrome.cookies.get({ url: "https://www.instagram.com", name: "ds_user_id" });
        if (sessionCookie && sessionCookie.value) {
          hasSessionCookie = true;
        }
        if (userCookie && userCookie.value) {
          userId = userCookie.value;
        }
      }
    } catch (cookieErr) {
      console.log("[MessageV2 Extension] Cookie check error:", cookieErr);
    }

    // 2. Check DOM on the tab
    let domResult = {};
    try {
      const [res] = await chrome.scripting.executeScript({
        target: { tabId: tab.id },
        func: () => {
          const url = window.location.href;
          const bodyText = document.body ? document.body.innerText.toLowerCase() : "";
          
          // Logged-in navigation icons & indicators
          const directIcon = document.querySelector('svg[aria-label="Direct"], svg[aria-label="Messages"], a[href*="/direct/inbox/"], a[href*="/direct/"]');
          const homeIcon = document.querySelector('svg[aria-label="Home"]');
          const searchIcon = document.querySelector('svg[aria-label="Search"]');
          const profileIcon = document.querySelector('svg[aria-label="Your Profile"], svg[aria-label="Profile"], a[href*="/_mavon_/"]');
          const navBar = document.querySelector('nav, div[role="navigation"]');

          const isLoginPage = url.includes("/accounts/login") || bodyText.includes("log in with facebook") || Boolean(document.querySelector('input[name="password"]'));
          const hasChallenge = url.includes("/challenge/") || bodyText.includes("suspicious login") || bodyText.includes("verify your account");
          const isLoggedIn = (Boolean(directIcon || homeIcon || searchIcon || profileIcon) || Boolean(navBar && !isLoginPage)) && !isLoginPage;

          return {
            url,
            isLoggedIn,
            hasChallenge,
            title: document.title
          };
        }
      });
      domResult = res?.result || {};
    } catch (scriptErr) {
      console.log("[MessageV2 Extension] Script execution error:", scriptErr);
    }

    const isLoggedIn = hasSessionCookie || Boolean(domResult.isLoggedIn);

    return {
      success: true,
      is_logged_in: isLoggedIn,
      has_challenge: Boolean(domResult.hasChallenge),
      user_id: userId,
      url: domResult.url || tab.url,
      title: domResult.title || tab.title
    };
  }

  if (action === "OPEN_PROFILE") {
    const targetUrl = payload.url;
    // Quiet background navigation: do NOT set active: true!
    await chrome.tabs.update(tab.id, { url: targetUrl });
    await waitForTabLoaded(tab.id, 20000);
    return { success: true, url: targetUrl };
  }

  if (action === "EXTRACT_PROFILE") {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const bodyText = document.body ? document.body.innerText : "";
        let followers = 0;
        const followerMatch = bodyText.match(/([\d,\.kKmM]+)\s+followers/i);
        if (followerMatch) {
          const raw = followerMatch[1].replace(/,/g, '').toLowerCase();
          if (raw.includes('k')) followers = Math.round(parseFloat(raw.replace('k', '')) * 1000);
          else if (raw.includes('m')) followers = Math.round(parseFloat(raw.replace('m', '')) * 1000000);
          else followers = parseInt(raw, 10) || 0;
        }

        const usernameElem = document.querySelector('header h2, header h1, section h2');
        const username = usernameElem ? usernameElem.innerText.trim() : null;

        return {
          username,
          followers,
          url: window.location.href
        };
      }
    });

    return { success: true, data: result?.result || {} };
  }

  if (action === "CHECK_MESSAGE_AVAILABILITY") {
    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      func: () => {
        const buttons = Array.from(document.querySelectorAll('div[role="button"], button'));
        const msgBtn = buttons.find(b => {
          const t = b.innerText.trim().toLowerCase();
          return t === "message" || t === "send message";
        });
        return { available: Boolean(msgBtn) };
      }
    });

    return { success: true, available: result?.result?.available || false };
  }

  if (action === "PREPARE_AND_SEND_MESSAGE") {
    const messageText = payload.message || "Hey";
    const checkHistory = payload.check_history !== false && (payload.task_type === "MESSAGE" || !payload.task_type);
    const taskType = payload.task_type || "MESSAGE";

    const [result] = await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      args: [messageText, checkHistory, taskType],
      func: async (textToSend, shouldCheckHistory, currentTaskType) => {
        // 1. Click message button if not in DM thread
        if (!window.location.href.includes("/direct/t/")) {
          const buttons = Array.from(document.querySelectorAll('div[role="button"], button'));
          const msgBtn = buttons.find(b => {
            const t = b.innerText.trim().toLowerCase();
            return t === "message" || t === "send message";
          });
          if (msgBtn) {
            msgBtn.click();
            await new Promise(r => setTimeout(r, 2000));
          }
        }

        // Dismiss any notification or save info popup
        const notNowButtons = Array.from(document.querySelectorAll('button, div[role="button"]')).filter(b => {
          const t = b.innerText.toLowerCase();
          return t.includes("not now") || t.includes("cancel");
        });
        for (const btn of notNowButtons) {
          try { btn.click(); } catch (e) {}
        }

        // 2. Find message composer (contenteditable or textarea)
        let composer = null;
        for (let i = 0; i < 20; i++) {
          composer = document.querySelector('div[contenteditable="true"][role="textbox"], textarea[placeholder*="Message"], div[aria-label="Message"]');
          if (composer) break;
          await new Promise(r => setTimeout(r, 350));
        }

        // Check for Instagram DM restriction banners (e.g. Long Boi's Bakehouse)
        const restrictionPatterns = [
          "can't receive your message",
          "cannot receive your message",
          "don't allow new message requests",
          "you can't message this account",
          "cannot be messaged"
        ];
        const pageText = document.body.innerText.toLowerCase();
        const foundRestricted = restrictionPatterns.find(p => pageText.includes(p));
        if (foundRestricted) {
          const restrictionElem = Array.from(document.querySelectorAll('div, span, p')).find(el => {
            const t = el.innerText?.toLowerCase();
            return t && restrictionPatterns.some(p => t.includes(p)) && el.innerText.length < 200;
          });
          const exactReason = restrictionElem ? restrictionElem.innerText.trim() : "This account can't receive message requests";
          return {
            success: false,
            dm_restricted: true,
            error: exactReason
          };
        }

        if (!composer) {
          return { success: false, error: "Message composer not found" };
        }

        // 3. Detect existing conversation history (Anti-Duplicate Contact Guard)
        if (shouldCheckHistory) {
          // Identify the active DM thread container
          const chatPane = composer.closest('div[role="main"]') || document.querySelector('div[role="main"]') || document.body;
          
          // Check for message rows in Instagram's virtualized thread grid
          const msgRows = Array.from(chatPane.querySelectorAll('div[role="row"], div[role="listitem"]'));
          
          // Check for existing message bubbles inside active thread
          const threadBubbles = Array.from(chatPane.querySelectorAll('div[dir="auto"], span[dir="auto"]')).filter(el => {
            if (composer.contains(el)) return false;
            if (el.closest('header') || el.closest('nav') || el.closest('[role="navigation"]')) return false;
            const txt = el.innerText?.trim();
            if (!txt || txt === "Message..." || txt === "View Profile" || txt === "Search" || txt === "Primary" || txt === "General" || txt === "Requests") return false;
            return txt.length > 1;
          });

          if (msgRows.length > 0 || threadBubbles.length > 0) {
            return {
              success: false,
              already_messaged: true,
              error: `Existing conversation history detected with this contact (${msgRows.length} rows, ${threadBubbles.length} bubbles)`
            };
          }
        }

        // 4. Focus & Clean Composer (Ensure no stale drafts or duplicates)
        composer.focus();
        try {
          document.execCommand('selectAll', false, null);
          document.execCommand('delete', false, null);
        } catch (e) {}

        if (composer.innerText && composer.innerText.trim() !== '') {
          composer.innerText = '';
          composer.dispatchEvent(new Event('input', { bubbles: true }));
        }

        // 5. Insert text ONCE (Never fire beforeinput and execCommand sequentially)
        let inserted = false;
        try {
          inserted = document.execCommand('insertText', false, textToSend);
        } catch (e) {
          inserted = false;
        }

        let currentText = (composer.innerText || composer.textContent || '').trim();
        if (!inserted || currentText !== textToSend.trim()) {
          composer.innerText = textToSend;
          composer.dispatchEvent(new Event('input', { bubbles: true }));
          composer.dispatchEvent(new Event('change', { bubbles: true }));
        }

        // Sanity Check: Truncate if text was duplicated by browser
        currentText = (composer.innerText || composer.textContent || '').trim();
        if (currentText.length > textToSend.trim().length && currentText.startsWith(textToSend.trim())) {
          composer.innerText = textToSend;
          composer.dispatchEvent(new Event('input', { bubbles: true }));
        }

        await new Promise(r => setTimeout(r, 600));

        // 6. Send message (Single dispatch via Send button or Enter)
        const sendBtn = Array.from(document.querySelectorAll('div[role="button"], button')).find(b => {
          const t = b.innerText.trim().toLowerCase();
          const hasAria = (b.getAttribute('aria-label') || '').toLowerCase().includes('send');
          const hasSvgSend = Boolean(b.querySelector('svg[aria-label="Send"], svg[aria-label="Direct"]'));
          return (t === "send" || t === "send message" || hasAria || hasSvgSend) && b.offsetParent !== null;
        });

        if (sendBtn) {
          sendBtn.click();
        } else {
          composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
        }

        // Wait and confirm composer was cleared by Instagram
        let cleared = false;
        for (let i = 0; i < 10; i++) {
          await new Promise(r => setTimeout(r, 200));
          const afterText = (composer.innerText || composer.textContent || '').trim();
          if (afterText === '' || afterText === 'Message...') {
            cleared = true;
            break;
          }
        }

        if (!cleared && sendBtn) {
          composer.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', keyCode: 13, which: 13, bubbles: true }));
          await new Promise(r => setTimeout(r, 600));
        }

        return { success: true };
      }
    });

    return {
      success: result?.result?.success || false,
      already_messaged: result?.result?.already_messaged || false,
      dm_restricted: result?.result?.dm_restricted || false,
      error: result?.result?.error
    };
  }

  if (action === "SCAN_INBOX_REPLIES") {
    const scannerTab = await getScannerTab();
    if (!scannerTab || !scannerTab.id) return { success: false, error: "No Scanner tab found" };

    if (!scannerTab.url || !scannerTab.url.includes("/direct/")) {
      await chrome.tabs.update(scannerTab.id, { url: "https://www.instagram.com/direct/inbox/" });
      await waitForTabLoaded(scannerTab.id, 12000);
      await new Promise(r => setTimeout(r, 2500));
    }

    const [result] = await chrome.scripting.executeScript({
      target: { tabId: scannerTab.id },
      func: async () => {
        const rows = Array.from(document.querySelectorAll('a[href*="/direct/t/"]'));
        const threads = [];

        for (const row of rows.slice(0, 30)) {
          try {
            const href = row.getAttribute('href') || '';
            const fullText = row.innerText || '';
            const lines = fullText.split('\n').map(l => l.trim()).filter(Boolean);
            
            const contactName = lines[0] || '';
            const snippet = lines[1] || '';
            const hasReply = snippet.length > 0 && !snippet.startsWith("You:") && !snippet.startsWith("You sent");
            const unread = Boolean(row.querySelector('[aria-label*="unread"], [class*="unread"], div[style*="background-color: rgb(0, 149, 246)"]'));

            threads.push({
              name: contactName,
              snippet: snippet,
              has_reply: hasReply,
              unread: unread,
              href: href
            });
          } catch (e) {}
        }

        return { threads };
      }
    });

    return { success: true, threads: result?.result?.threads || [] };
  }

  if (action === "INSPECT_THREAD_REPLY") {
    const threadUrl = payload.thread_url;
    const scannerTab = await getScannerTab();
    if (!scannerTab || !scannerTab.id) return { success: false, error: "No Scanner tab found" };

    if (threadUrl && !(scannerTab.url || '').includes(threadUrl)) {
      const fullUrl = threadUrl.startsWith("http") ? threadUrl : `https://www.instagram.com${threadUrl}`;
      await chrome.tabs.update(scannerTab.id, { url: fullUrl });
      await waitForTabLoaded(scannerTab.id, 12000);
      await new Promise(r => setTimeout(r, 2500));
    }

    const [result] = await chrome.scripting.executeScript({
      target: { tabId: scannerTab.id },
      func: async () => {
        const composer = document.querySelector('div[contenteditable="true"][role="textbox"], textarea[placeholder*="Message"]');
        const chatPane = composer ? (composer.closest('div[role="main"]') || document.body) : document.body;
        
        const bubbles = Array.from(chatPane.querySelectorAll('div[dir="auto"], span[dir="auto"]')).filter(el => {
          if (composer && composer.contains(el)) return false;
          if (el.closest('header') || el.closest('nav') || el.closest('[role="navigation"]')) return false;
          const txt = el.innerText?.trim();
          if (!txt || txt === "Message..." || txt === "View Profile" || txt === "Search" || txt === "Primary" || txt === "General" || txt === "Requests") return false;
          return txt.length > 1;
        });

        if (bubbles.length === 0) {
          return { has_reply: false };
        }

        const lastBubble = bubbles[bubbles.length - 1];
        const lastText = lastBubble.innerText.trim();

        // Check if last bubble is inbound (not sent by us)
        const computed = window.getComputedStyle(lastBubble.parentElement || lastBubble);
        const isRightAligned = computed.justifyContent === 'flex-end' || computed.textAlign === 'right' || computed.alignSelf === 'flex-end';

        return {
          has_reply: true,
          text: lastText,
          is_inbound: !isRightAligned,
          bubbles_count: bubbles.length
        };
      }
    });

    return { success: true, data: result?.result || {} };
  }

  if (action === "SCREENSHOT") {
    try {
      const dataUrl = await chrome.tabs.captureVisibleTab(tab.windowId, { format: "jpeg", quality: 80 });
      return { success: true, dataUrl };
    } catch (e) {
      return { success: false, error: String(e) };
    }
  }

  return { success: false, error: `Unknown action ${action}` };
}

// Start connection immediately
connect();
