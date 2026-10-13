document.addEventListener("DOMContentLoaded", () => {
  const statusDot = document.getElementById("statusDot");
  const statusLabel = document.getElementById("statusLabel");
  const tabStatus = document.getElementById("tabStatus");
  const reconnectBtn = document.getElementById("reconnectBtn");
  const openDashboardBtn = document.getElementById("openDashboardBtn");
  const openInstagramBtn = document.getElementById("openInstagramBtn");

  async function checkBridgeStatus() {
    try {
      chrome.runtime.sendMessage({ type: "GET_STATUS" }, (response) => {
        if (chrome.runtime.lastError || !response) {
          // Fallback probe
          fetch("http://127.0.0.1:8000/api/health")
            .then(res => res.json())
            .then(() => setStatus(true, "Backend Active (Connecting...)"))
            .catch(() => setStatus(false, "Backend Offline"));
          return;
        }

        if (response.connected) {
          setStatus(true, "Connected & Ready");
        } else {
          setStatus(false, "Reconnecting...");
        }
      });
    } catch (e) {
      setStatus(false, "Bridge Offline");
    }

    // Check active instagram tab
    try {
      chrome.tabs.query({ url: "*://*.instagram.com/*" }, (tabs) => {
        if (tabs && tabs.length > 0) {
          tabStatus.textContent = `${tabs.length} Tab(s) Active`;
          tabStatus.style.color = "#34d399";
        } else {
          tabStatus.textContent = "Not Detected";
          tabStatus.style.color = "#94a3b8";
        }
      });
    } catch (e) {
      tabStatus.textContent = "Unknown";
    }
  }

  function setStatus(connected, text) {
    statusDot.className = "dot " + (connected ? "connected" : "connecting");
    statusLabel.textContent = text;
    statusLabel.style.color = connected ? "#34d399" : "#f59e0b";
  }

  reconnectBtn.addEventListener("click", () => {
    setStatus(false, "Reconnecting...");
    chrome.runtime.sendMessage({ type: "RECONNECT" }, () => {
      setTimeout(checkBridgeStatus, 600);
    });
  });

  openDashboardBtn.addEventListener("click", () => {
    chrome.tabs.create({ url: "http://localhost:5173" });
  });

  openInstagramBtn.addEventListener("click", () => {
    chrome.tabs.create({ url: "https://www.instagram.com/direct/inbox/" });
  });

  checkBridgeStatus();
  setInterval(checkBridgeStatus, 3000);
});
