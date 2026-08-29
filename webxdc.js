/**
 * WebXDC Mock & Peer Simulation Layer
 * For browser development, testing and standalone usage.
 * When running in a real WebXDC client (e.g. Delta Chat), the messenger's native window.webxdc is preserved.
 */
(function () {
  if (window.webxdc && window.webxdc.isNative) {
    console.log('[WebXDC] Native WebXDC environment detected.');
    return;
  }

  const STORAGE_KEY = 'webxdc_updates_store_v1';
  const PEER_KEY = 'webxdc_simulated_peer';
  const CHANNEL_NAME = 'webxdc_broadcast_channel';

  const PEERS = [
    { addr: 'alireza@delta.chat', name: 'Alireza' },
    { addr: 'sarah@delta.chat', name: 'Sarah' },
    { addr: 'john@delta.chat', name: 'John' },
    { addr: 'alex@delta.chat', name: 'Alex' },
    { addr: 'maryam@delta.chat', name: 'Maryam' },
    { addr: 'chen@delta.chat', name: 'Chen' },
    { addr: 'elena@delta.chat', name: 'Elena' }
  ];

  let currentPeerIndex = 0;
  const savedPeer = localStorage.getItem(PEER_KEY);
  if (savedPeer) {
    const idx = PEERS.findIndex(p => p.addr === savedPeer);
    if (idx !== -1) currentPeerIndex = idx;
  }

  let listeners = [];
  let broadcastChannel = null;
  try {
    if (typeof BroadcastChannel !== 'undefined') {
      broadcastChannel = new BroadcastChannel(CHANNEL_NAME);
      broadcastChannel.onmessage = function (event) {
        if (event.data && event.data.type === 'NEW_UPDATE') {
          notifyListeners();
        }
      };
    }
  } catch (e) {
    console.warn('[WebXDC] BroadcastChannel not supported, falling back to storage events');
  }

  window.addEventListener('storage', function (e) {
    if (e.key === STORAGE_KEY) {
      notifyListeners();
    }
  });

  function getStoredUpdates() {
    try {
      const data = localStorage.getItem(STORAGE_KEY);
      return data ? JSON.parse(data) : [];
    } catch (e) {
      return [];
    }
  }

  function saveStoredUpdates(updates) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updates));
      if (broadcastChannel) {
        broadcastChannel.postMessage({ type: 'NEW_UPDATE' });
      }
    } catch (e) {
      console.error('[WebXDC] Failed to save updates', e);
    }
  }

  function notifyListeners() {
    const updates = getStoredUpdates();
    listeners.forEach(entry => {
      const pending = updates.filter(u => u.serial > entry.serial);
      pending.forEach(u => {
        try {
          entry.cb(u);
          entry.serial = u.serial;
        } catch (err) {
          console.error('[WebXDC] Error in listener', err);
        }
      });
    });
  }

  window.webxdc = {
    isSimulation: true,
    get selfAddr() {
      return PEERS[currentPeerIndex].addr;
    },
    get selfName() {
      return PEERS[currentPeerIndex].name;
    },
    setPeer: function (index) {
      if (index >= 0 && index < PEERS.length) {
        currentPeerIndex = index;
        localStorage.setItem(PEER_KEY, PEERS[currentPeerIndex].addr);
        window.dispatchEvent(new CustomEvent('webxdc:peerchange', { detail: PEERS[currentPeerIndex] }));
      }
    },
    getPeersList: function () {
      return PEERS.map((p, i) => ({ ...p, isCurrent: i === currentPeerIndex }));
    },
    sendUpdate: function (update, description) {
      const updates = getStoredUpdates();
      const newSerial = updates.length + 1;
      const entry = {
        payload: update.payload || {},
        info: update.info || description || '',
        summary: update.summary || '',
        serial: newSerial,
        sender: PEERS[currentPeerIndex].addr,
        senderName: PEERS[currentPeerIndex].name,
        timestamp: Date.now()
      };
      updates.push(entry);
      saveStoredUpdates(updates);
      notifyListeners();
      console.log('[WebXDC] Update sent:', entry);
    },
    sendToChat: async function (message) {
      console.log('[WebXDC Simulation] sendToChat called with:', message);
      if (message.file && (message.file.blob || message.file.name)) {
        console.log(`[WebXDC Simulation] Sent file "${message.file.name}" to Delta Chat!`);
      }
      return Promise.resolve();
    },
    setUpdateListener: function (cb, serial) {
      const entry = { cb, serial: serial || 0 };
      listeners.push(entry);
      const updates = getStoredUpdates();
      const past = updates.filter(u => u.serial > entry.serial);
      past.forEach(u => {
        try {
          cb(u);
          entry.serial = u.serial;
        } catch (err) {
          console.error('[WebXDC] Listener error', err);
        }
      });
      return Promise.resolve();
    },
    getAllUpdates: function () {
      return getStoredUpdates();
    },
    clearAllUpdates: function () {
      localStorage.removeItem(STORAGE_KEY);
      if (broadcastChannel) broadcastChannel.postMessage({ type: 'NEW_UPDATE' });
      window.location.reload();
    }
  };

  console.log('[WebXDC] Simulator active. Current peer:', window.webxdc.selfName, `(${window.webxdc.selfAddr})`);
})();
