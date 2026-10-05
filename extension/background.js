// MessageV2 Chrome Extension Background Service Worker
const WS_URL = "ws://127.0.0.1:8000/ws/extension";
let ws = null;
let reconnectTimer = null;

function connect() {
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
      ws.send(JSON.stringify({
        id: data.id,
        action: data.action,
        ...res
      }));
    } catch (err) {
      console.error("[MessageV2 Extension] Error handling message:", err);
      if (data && data.id) {
        ws.send(JSON.stringify({ id: data.id, success: false, error: String(err) }));
      }
    }
  };

  ws.onerror = (e) => {
    console.log("[MessageV2 Extension] WS error", e);
  };

  ws.onclose = () => {
    console.log("[MessageV2 Extension] Disconnected, retrying in 3s...");
    clearTimeout(reconnectTimer);
    reconnectTimer = setTimeout(connect, 3000);
  };
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
    const finish = () => {
      if (!resolved) {
        resolved = true;
        chrome.tabs.onUpdated.removeListener(listener);
        setTimeout(resolve, 1500); // 1.5s for DOM hydration
      }
    };

    function listener(id, changeInfo, tab) {
      if (id === tabId && changeInfo.status === "complete") {
        finish();
      }
    }

    chrome.tabs.onUpdated.addListener(listener);

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

// Dedicated automation tab isolation
let automationTabId = null;
let isScreencasting = false;
let currentScreencastTabId = null;

async function ensureScreencast(tabId) {
  if (!chrome.debugger) return;
  if (isScreencasting && currentScreencastTabId === tabId) return;

  if (isScreencasting && currentScreencastTabId && currentScreencastTabId !== tabId) {
    try {
      await chrome.debugger.detach({ tabId: currentScreencastTabId });
    } catch (e) {}
    isScreencasting = false;
    currentScreencastTabId = null;
  }

  try {
    await chrome.debugger.attach({ tabId }, "1.3");
    currentScreencastTabId = tabId;
    isScreencasting = true;
    await chrome.debugger.sendCommand({ tabId }, "Page.startScreencast", {
      format: "jpeg",
      quality: 60,
      maxWidth: 960,
      maxHeight: 720,
      everyNthFrame: 1
    });
    console.log("[MessageV2 Extension] Live screencast started on isolated tab:", tabId);
  } catch (err) {
    console.log("[MessageV2 Extension] Could not start screencast on tab:", tabId, err);
  }
}

if (chrome.debugger) {
  chrome.debugger.onEvent.addListener((source, method, params) => {
    if (method === "Page.screencastFrame" && params.data) {
      if (ws && ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({
          type: "LIVE_FRAME",
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
    console.log("[MessageV2 Extension] Screencast detached:", reason);
    if (source.tabId === currentScreencastTabId) {
      isScreencasting = false;
      currentScreencastTabId = null;
    }
  });
}

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === automationTabId) {
    console.log("[MessageV2 Extension] Automation tab was closed. Resetting allocation.");
    automationTabId = null;
    isScreencasting = false;
    currentScreencastTabId = null;
  }
});

// Find or start the dedicated Instagram tab in background
async function getInstagramTab() {
  // 1. If we already hold a dedicated tab, verify it's still alive
  if (automationTabId !== null) {
    try {
      const existing = await chrome.tabs.get(automationTabId);
      if (existing && !existing.discarded) {
        if (existing.status === "loading") {
          await waitForTabLoaded(existing.id, 10000);
        }
        ensureScreencast(existing.id).catch(() => {});
        return existing;
      }
    } catch (e) {
      automationTabId = null;
    }
  }

  // 2. Look for any existing Instagram tab to adopt
  const tabs = await chrome.tabs.query({ url: ["*://*.instagram.com/*", "*://instagram.com/*"] });
  if (tabs.length > 0) {
    automationTabId = tabs[0].id;
    const tab = tabs[0];
    if (tab.status === "loading") {
      await waitForTabLoaded(tab.id, 10000);
    }
    ensureScreencast(tab.id).catch(() => {});
    return tab;
  }

  // 3. Otherwise, create a dedicated background tab without stealing user focus (active: false)
  console.log("[MessageV2 Extension] Creating dedicated automation tab in background...");
  const newTab = await chrome.tabs.create({ url: "https://www.instagram.com/", active: false });
  automationTabId = newTab.id;
  await waitForTabLoaded(newTab.id, 15000);
  ensureScreencast(newTab.id).catch(() => {});
  return newTab;
}

async function handleCommand(msg) {
  const { action, payload } = msg;

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
    const tab = await getInstagramTab();
    if (tab && tab.id) {
      await ensureScreencast(tab.id);
      return { success: true, screencasting: isScreencasting, tabId: tab.id };
    }
    return { success: false, error: "No tab found" };
  }

  if (action === "CAPTURE_SCREENSHOT") {
    try {
      const tab = await getInstagramTab();

      // 1. Isolated tab capture via Debugger (captures THIS tab exclusively, even in background)
      if (chrome.debugger && tab && tab.id) {
        try {
          if (!isScreencasting || currentScreencastTabId !== tab.id) {
            await ensureScreencast(tab.id);
          }
          const shot = await chrome.debugger.sendCommand({ tabId: tab.id }, "Page.captureScreenshot", {
            format: "jpeg",
            quality: 65
          });
          if (shot && shot.data) {
            return { success: true, dataUrl: "data:image/jpeg;base64," + shot.data };
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
      return { success: true, dataUrl };
    } catch (err) {
      console.log("[MessageV2 Extension] captureVisibleTab error:", err);
      return { success: false, error: String(err) };
    }
  }

  const tab = await getInstagramTab();
  if (!tab || !tab.id) {
    return { success: false, error: "No Instagram tab found" };
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
          return (t === "send" || t === "send message") && b.offsetParent !== null;
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
      error: result?.result?.error
    };
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
