const TEAMS = [
  { abbr:'CSK', name:'Chennai Super Kings', color:'#ffc107', textColor:'#000' },
  { abbr:'MI',  name:'Mumbai Indians',      color:'#004ba0', textColor:'#fff' },
  { abbr:'RCB', name:'Royal Challengers',   color:'#d32f2f', textColor:'#fff' },
  { abbr:'KKR', name:'Kolkata Knight Riders',color:'#512da8', textColor:'#ffc107' },
  { abbr:'DC',  name:'Delhi Capitals',       color:'#2196f3', textColor:'#fff' },
  { abbr:'PBKS',name:'Punjab Kings',         color:'#e53935', textColor:'#fff' },
  { abbr:'RR',  name:'Rajasthan Royals',    color:'#e91e63', textColor:'#fff' },
  { abbr:'SRH', name:'Sunrisers Hyderabad', color:'#ff6f00', textColor:'#000' },
  { abbr:'GT',  name:'Gujarat Titans',      color:'#424242', textColor:'#00bcd4' },
  { abbr:'LSG', name:'Lucknow Super Giants',color:'#00acc1', textColor:'#fff' },
];

let ws = null;
let playerId = null;
let roomCode = null;
let roomData = null;
let selectedTeam = null;
let isHost = false;
let playersData = { withStats: {}, categorized: {} };
let auctionMode = 'mega';
let auctionQueue = [];
let timerInterval = null;

function normalizeTimerDuration(value, fallback = 15) {
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(30, Math.max(5, parsed));
}

function syncTimerControls() {
  if (!roomData) return;
  const timerSelect = document.getElementById('timerSelect');
  if (timerSelect) timerSelect.value = String(normalizeTimerDuration(roomData.timer_duration, 15));
}

const PAGE_MAP = { home: 'index.html', lobby: 'lobby.html', auction: 'auction.html' };
const PAGE = document.body ? (document.body.dataset.page || 'home') : 'home';

function navigateTo(screen) {
  const target = PAGE_MAP[screen] || PAGE_MAP.home;
  const current = window.location.pathname.split('/').pop() || PAGE_MAP.home;
  if (current === target) return;
  window.location.href = target;
}

function getNavigationType() {
  const entries = performance.getEntriesByType('navigation');
  if (entries && entries.length) return entries[0].type;
  if (performance.navigation) {
    if (performance.navigation.type === 1) return 'reload';
    if (performance.navigation.type === 2) return 'back_forward';
  }
  return 'navigate';
}

function resetSessionState() {
  localStorage.removeItem('currentScreen');
  localStorage.removeItem('roomCode');
  localStorage.removeItem('playerId');
  roomCode = null;
  playerId = null;
  roomData = null;
  isHost = false;
}

// Initialize
window.addEventListener('load', () => {
  const savedScreen = localStorage.getItem('currentScreen');
  const savedRoomCode = localStorage.getItem('roomCode');
  const savedPlayerId = localStorage.getItem('playerId');
  const navType = getNavigationType();

  if (savedScreen && savedRoomCode && savedPlayerId) {
    if (PAGE !== savedScreen && navType !== 'back_forward') {
      navigateTo(savedScreen);
      return;
    }

    roomCode = savedRoomCode;
    playerId = savedPlayerId;
    connectWebSocket(true);
  } else if (PAGE !== 'home') {
    navigateTo('home');
    return;
  }

  initPage();
});

// Prevent unload to help with page state
window.addEventListener('beforeunload', () => {
  // Session data is already saved to localStorage
  // This helps maintain state across reloads
});

function initPage() {
  loadPlayerData();
  if (PAGE === 'home') initHomePage();
  if (PAGE === 'lobby') initLobbyPage();
  if (PAGE === 'auction') initAuctionPage();
}

function initHomePage() {
  const grid = document.getElementById('teamsGrid');
  if (!grid) {
    console.error('teamsGrid not found!');
    return;
  }

  console.log('Initializing teams, found', TEAMS.length, 'teams');
  
  TEAMS.forEach((t, i) => {
    const btn = document.createElement('div');
    btn.className = 'team-btn';
    btn.dataset.teamIdx = i;
    btn.innerHTML = `
      <div class="team-logo" style="background:${t.color};color:${t.textColor}">${t.abbr}</div>
      <div class="team-name">${t.abbr}</div>
    `;
    btn.onclick = () => selectTeam(i, btn);
    grid.appendChild(btn);
  });
  
  console.log('Teams grid populated with', grid.children.length, 'buttons');

  document.getElementById('playerName')?.addEventListener('input', checkReady);
  document.getElementById('roomCodeInput')?.addEventListener('input', checkReady);
  document.getElementById('createRoomBtn')?.addEventListener('click', createRoom);
  document.getElementById('joinRoomBtn')?.addEventListener('click', joinRoom);

   // Browse Rooms
   const browseBtn = document.getElementById('browseRoomsBtn');
   const modal = document.getElementById('browseRoomsModal');
   const closeBtn = document.getElementById('closeBrowseRooms');
   const roomsList = document.getElementById('roomsList');
   if (browseBtn && modal && closeBtn && roomsList) {
     browseBtn.onclick = () => {
       modal.style.display = 'block';
       fetchRoomsList();
     };
     closeBtn.onclick = () => { modal.style.display = 'none'; };
     window.onclick = (e) => { if (e.target === modal) modal.style.display = 'none'; };
   }
}

function fetchRoomsList() {
  // Open a temp websocket to fetch rooms
  const wsBrowse = new WebSocket(`ws://${window.location.hostname}:${window.location.port}/ws`);
  wsBrowse.onopen = () => {
    wsBrowse.send(JSON.stringify({ action: 'list_rooms' }));
  };
  wsBrowse.onmessage = (event) => {
    const data = JSON.parse(event.data);
    if (data.type === 'room_list') {
      renderRoomsList(data.rooms);
      wsBrowse.close();
    }
  };
  wsBrowse.onerror = () => {
    document.getElementById('roomsList').innerHTML = '<p style="color:red">Failed to fetch rooms.</p>';
  };
}

function renderRoomsList(rooms) {
  if (!rooms.length) {
    document.getElementById('roomsList').innerHTML = '<p style="color:var(--text-dim);text-align:center;padding:20px;">No rooms found. Create one!</p>';
    return;
  }
  document.getElementById('roomsList').innerHTML = rooms.map(r => {
    const statusColor = r.status === 'waiting' ? '#10b981' : r.status === 'active' ? '#fbbf24' : '#ef4444';
    const statusLabel = r.status.charAt(0).toUpperCase() + r.status.slice(1);
    const canJoin = r.status === 'waiting' && r.players.length < 10;
    return `
      <div class="room-list-item">
        <div class="room-item-header">
          <span class="room-code-tag">${r.room_code}</span>
          <span class="room-status-badge" style="background:${statusColor}20;color:${statusColor};border:1px solid ${statusColor}40">${statusLabel}</span>
        </div>
        <div class="room-item-info">
          <div><span class="room-info-label">Host:</span> ${r.host || 'N/A'}</div>
          <div><span class="room-info-label">Players:</span> ${r.players.join(', ')} (${r.players.length}/10)</div>
          <div><span class="room-info-label">Mode:</span> ${r.auction_mode === 'mega' ? 'Mega' : 'Legend'} | Timer: ${r.timer_duration}s</div>
        </div>
        ${canJoin ? `<button class="room-join-btn" onclick="joinBrowsedRoom('${r.room_code}')">Join Room</button>` : ''}
      </div>
    `;
  }).join('');
}

function joinBrowsedRoom(code) {
  // Close modal
  const modal = document.getElementById('browseRoomsModal');
  if (modal) modal.style.display = 'none';
  // Fill the code and trigger join
  const codeInput = document.getElementById('roomCodeInput');
  if (codeInput) {
    codeInput.value = code;
    checkReady();
    joinRoom();
  }
}

function switchSoldTab(tab) {
  document.querySelectorAll('.su-tab').forEach(t => t.classList.remove('active'));
  if (tab === 'sold') {
    document.getElementById('soldTabContent').style.display = 'block';
    document.getElementById('unsoldTabContent').style.display = 'none';
    document.querySelectorAll('.su-tab')[0].classList.add('active');
  } else {
    document.getElementById('soldTabContent').style.display = 'none';
    document.getElementById('unsoldTabContent').style.display = 'block';
    document.querySelectorAll('.su-tab')[1].classList.add('active');
  }
}

function initLobbyPage() {
  document.getElementById('shareBtn')?.addEventListener('click', copyRoomCode);
  document.getElementById('leaveRoomBtn')?.addEventListener('click', leaveRoom);
  document.getElementById('startAuctionBtn')?.addEventListener('click', startAuction);
}

function initAuctionPage() {
  document.getElementById('pauseBtn')?.addEventListener('click', togglePause);
  document.getElementById('resumeBtn')?.addEventListener('click', resumeAuction);
  document.getElementById('timerSelect')?.addEventListener('change', changeTimer);
  document.getElementById('chatSendBtn')?.addEventListener('click', sendChatMessage);
  document.getElementById('chatInput')?.addEventListener('keypress', (e) => {
    if (e.key === 'Enter') sendChatMessage();
  });
  document.getElementById('endAuctionBtn')?.addEventListener('click', endAuction);
  document.addEventListener('keydown', handleBidHotkey);
}

function handleBidHotkey(e) {
  const active = document.activeElement;
  const isTyping = active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA');
  if (isTyping) return;

  if (e.key === '1' || e.code === 'Numpad1') {
    const bidBtn = document.getElementById('bidBtn');
    if (bidBtn && !bidBtn.disabled) {
      e.preventDefault();
      placeBid();
    }
  }
}

function selectTeam(idx, el) {
  document.querySelectorAll('.team-btn').forEach(b => b.classList.remove('selected'));
  el.classList.add('selected');
  selectedTeam = idx;
  checkReady();
}

function checkReady() {
  const name = document.getElementById('playerName').value.trim();
  const hasNameAndTeam = name && selectedTeam !== null;
  
  document.getElementById('createRoomBtn').disabled = !hasNameAndTeam;
  
  const roomCodeVal = document.getElementById('roomCodeInput').value.trim();
  document.getElementById('joinRoomBtn').disabled = !(hasNameAndTeam && roomCodeVal.length === 6);
  
  // Enable Browse Rooms only after name and team are selected
  const browseBtn = document.getElementById('browseRoomsBtn');
  if (browseBtn) browseBtn.disabled = !hasNameAndTeam;
}

async function loadPlayerData() {
  try {
    // Load both datasets
    const respStats = await fetch('ipl_players_with_stats.json');
    const respCategorized = await fetch('ipl_categorized_players.json');
    playersData.withStats = await respStats.json();
    playersData.categorized = await respCategorized.json();
    console.log('Loaded players:', playersData);
  } catch(e) {
    console.error('Failed to load player data:', e);
    alert('Failed to load player data. Please refresh the page.');
  }
}

function connectWebSocket(isReconnecting = false) {
  const wsUrl = `ws://${window.location.hostname}:${window.location.port}/ws`;
  ws = new WebSocket(wsUrl);

  ws.onopen = () => {
    console.log('WebSocket connected');
    
    // Handle reconnection if needed
    if (isReconnecting && roomCode && playerId) {
      ws.send(JSON.stringify({
        action: 'reconnect',
        room_code: roomCode,
        player_id: playerId
      }));
    }
  };

  ws.onmessage = (event) => {
    const data = JSON.parse(event.data);
    handleWebSocketMessage(data);
  };

  ws.onerror = (error) => {
    console.error('WebSocket error:', error);
  };

  ws.onclose = () => {
    console.log('WebSocket closed');
    setTimeout(() => {
      if (roomCode) {
        alert('Connection lost. Reconnecting...');
        connectWebSocket();
      }
    }, 2000);
  };
}

function handleWebSocketMessage(data) {
  console.log('Received:', data);

  switch(data.type) {
    case 'room_created':
      roomCode = data.room_code;
      playerId = data.player_id;
      roomData = data.room_data;
      isHost = true;
      showLobby();
      break;

    case 'joined_room':
      roomCode = data.room_code;
      playerId = data.player_id;
      roomData = data.room_data;
      isHost = false;
      showLobby();
      break;
    
    case 'reconnected':
      roomData = data.room_data;
      playerId = data.player_id;
      roomCode = data.room_code;
      isHost = playerId === roomData.host_id;
      auctionMode = roomData.auction_mode || 'mega';
      
      // Restore to correct screen
      if (roomData.auction_state.status === 'active' || roomData.auction_state.status === 'paused' || roomData.auction_state.status === 'ended') {
        localStorage.setItem('currentScreen', 'auction');
        if (PAGE !== 'auction') {
          navigateTo('auction');
          return;
        }

        renderTeams();
        updateAuctionUI();
        renderUpcoming();

        // Show End Auction button if host
        if (isHost) {
          document.getElementById('endAuctionBtn').style.display = 'block';
          document.getElementById('timerControls').style.display = 'flex';
        }

        if (roomData.auction_state.status === 'active' && isHost) {
          startTimer();
        }

        if (roomData.auction_state.status === 'paused') {
          document.getElementById('pausedOverlay')?.classList.add('show');
        }
      } else {
        localStorage.setItem('currentScreen', 'lobby');
        if (PAGE !== 'lobby') {
          navigateTo('lobby');
          return;
        }

        document.getElementById('roomCodeDisplay').textContent = roomCode;
        updateLobby();

        if (isHost) {
          document.getElementById('startAuctionBtn').style.display = 'block';
        }
      }
      break;

    case 'player_joined':
    case 'player_left':
      roomData = data.room_data;
      updateLobby();
      if (data.type === 'player_left' && roomData && roomData.host_id === playerId) {
        isHost = true;
        document.getElementById('startAuctionBtn').style.display = 'block';
      }
      break;

    case 'auction_started':
      roomData = data.room_data;
      auctionMode = roomData.auction_mode || 'mega';
      localStorage.setItem('currentScreen', 'auction');
      showAuction();
      break;

    case 'bid_placed':
      roomData = data.room_data;
      updateAuctionUI();
      break;

    case 'auction_paused':
      roomData = data.room_data;
      document.getElementById('pausedOverlay').classList.add('show');
      document.getElementById('pauseBtn').style.display = 'none';
      document.getElementById('resumeBtn').style.display = 'block';
      if (timerInterval) clearInterval(timerInterval);
      break;

    case 'auction_resumed':
      roomData = data.room_data;
      document.getElementById('pausedOverlay').classList.remove('show');
      document.getElementById('pauseBtn').style.display = 'block';
      document.getElementById('resumeBtn').style.display = 'none';
      if (isHost && roomData.auction_state.status === 'active') {
        startTimer();
      }
      break;

    case 'player_sold':
      roomData = data.room_data;
      showSoldOverlay(data.winner_name, data.final_price);
      break;

    case 'new_message':
      addChatMessage(data.message.player_name, data.message.message, data.message.team);
      break;

    case 'timer_changed':
      roomData = data.room_data;
      alert(`Timer duration changed to ${data.timer_duration}s by host`);
      syncTimerControls();
      updateTimerDisplay();
      if (isHost && roomData?.auction_state?.status === 'active') {
        startTimer();
      }
      break;

    case 'auction_ended':
      roomData = data.room_data;
      if (timerInterval) clearInterval(timerInterval);
      
      // Show results directly - no re-auction
      showAuctionResults();
      break;

    case 'timer_update':
      if (roomData) {
        roomData.auction_state.time_left = data.time_left;
        updateTimerDisplay();
      }
      break;

    case 'left_room':
      // Successfully left the room
      resetSessionState();
      break;

    case 'error':
      alert('Error: ' + data.message);
      // Clear saved session if error about duplicate name or room not found
      if (data.message && (data.message.includes('already exists') || data.message.includes('not found'))) {
        resetSessionState();
        if (ws) {
          try { ws.close(); } catch (e) {}
        }
        navigateTo('home');
      }
      break;
  }
}

function createRoom() {
  const name = document.getElementById('playerName').value.trim();
  const auctionMode = document.getElementById('auctionMode').value;
  const timerDuration = normalizeTimerDuration(document.getElementById('timerDuration').value, 15);

  resetSessionState();

  connectWebSocket();

  ws.onopen = () => {
    ws.send(JSON.stringify({
      action: 'create_room',
      player_name: name,
      team: TEAMS[selectedTeam].abbr,
      auction_mode: auctionMode,
      timer_duration: timerDuration
    }));
  };
}

function joinRoom() {
  const name = document.getElementById('playerName').value.trim();
  const code = document.getElementById('roomCodeInput').value.trim().toUpperCase();

  resetSessionState();

  connectWebSocket();

  ws.onopen = () => {
    ws.send(JSON.stringify({
      action: 'join_room',
      room_code: code,
      player_name: name,
      team: TEAMS[selectedTeam].abbr
    }));
  };
}

function showLobby() {
  // Save current screen state
  localStorage.setItem('currentScreen', 'lobby');
  localStorage.setItem('roomCode', roomCode);
  localStorage.setItem('playerId', playerId);

  if (PAGE !== 'lobby') {
    navigateTo('lobby');
    return;
  }

  const roomCodeEl = document.getElementById('roomCodeDisplay');
  if (roomCodeEl) roomCodeEl.textContent = roomCode;
  
  if (isHost) {
    document.getElementById('startAuctionBtn').style.display = 'block';
  }

  updateLobby();
}

function updateLobby() {
  if (!roomData) return;

  const list = document.getElementById('playersList');
  if (!list) return;

  const players = Object.entries(roomData.players);
  document.getElementById('playerCount').textContent = players.length;
  document.getElementById('maxPlayerCount').textContent = '10';

  list.innerHTML = players.map(([pid, p]) => {
    const team = TEAMS.find(t => t.abbr === p.team);
    const isHostPlayer = pid === roomData.host_id;
    return `
      <div class="player-card ${isHostPlayer ? 'host' : ''}">
        <div class="player-badge" style="background:${team.color};color:${team.textColor}">${team.abbr}</div>
        <div class="player-info">
          <div class="player-info-name">${p.name}${pid === playerId ? ' (You)' : ''}</div>
          <div class="player-info-team">${team.name}</div>
        </div>
        ${isHostPlayer ? '<span class="host-badge">HOST</span>' : ''}
      </div>
    `;
  }).join('');

  // Update team grid to disable taken teams
  const teamButtons = document.querySelectorAll('.team-btn');
  if (teamButtons.length) {
    const myTeam = roomData.players[playerId]?.team;
    teamButtons.forEach(btn => {
      const teamIdx = parseInt(btn.dataset.teamIdx);
      const teamAbbr = TEAMS[teamIdx].abbr;
      const taken = players.some(([_, p]) => p.team === teamAbbr);
      
      if (taken && teamAbbr !== myTeam) {
        btn.classList.add('disabled');
        btn.onclick = null;
      }
    });
  }

  // Host can start with 2+ players, max 10
  const canStart = players.length >= 2;
  document.getElementById('startAuctionBtn').disabled = !canStart;
  
  if (players.length < 2) {
    document.getElementById('waitingMessage').style.display = 'flex';
    document.getElementById('waitingMessage').innerHTML = `
      <div class="waiting-spinner"></div>
      <p>Waiting for at least 2 players to join...</p>
      <p class="auction-mode-display">${roomData.auction_mode === 'mega' ? 'Mega Auction' : 'Legend Auction'}</p>
    `;
  } else {
    document.getElementById('waitingMessage').style.display = 'none';
  }
}

function copyRoomCode() {
  navigator.clipboard.writeText(roomCode);
  document.getElementById('shareBtn').textContent = '✓ Copied!';
  setTimeout(() => {
    document.getElementById('shareBtn').textContent = '📋 Copy Room Code';
  }, 2000);
}

function leaveRoom() {
  if (ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ action: 'leave_room' }));
  }
  if (ws) ws.close();
  localStorage.removeItem('currentScreen');
  localStorage.removeItem('roomCode');
  localStorage.removeItem('playerId');
  roomCode = null;
  playerId = null;
  navigateTo('home');
}

function startAuction() {
  // Get auction mode from room data
  auctionMode = roomData.auction_mode || 'mega';
  
  // Build auction queue based on auction mode
  auctionQueue = [];
  
  const data = auctionMode === 'mega' ? playersData.categorized : playersData.withStats;
  
  if (data.batsmen) {
    auctionQueue.push(...assignBasePrices(data.batsmen, 'batsman', auctionMode));
  }
  if (data.all_rounders) {
    auctionQueue.push(...assignBasePrices(data.all_rounders, 'all_rounder', auctionMode));
  }
  if (data.bowlers) {
    auctionQueue.push(...assignBasePrices(data.bowlers, 'bowler', auctionMode));
  }

  // Sort by role
  auctionQueue.sort((a, b) => {
    const order = { batsman: 1, all_rounder: 2, bowler: 3 };
    return order[a.role] - order[b.role];
  });

  ws.send(JSON.stringify({
    action: 'start_auction',
    auction_queue: auctionQueue
  }));
}

function assignBasePrices(players, role, mode) {
  if (mode === 'mega') {
    // For Mega auction, parse price from categorized data
    return players.map((p) => {
      let basePrice = 0.5; // default
      if (p.price) {
        const priceStr = p.price.toLowerCase();
        if (priceStr.includes('18') || priceStr.includes('14')) {
          basePrice = 2;
        } else if (priceStr.includes('10') || priceStr.includes('4')) {
          basePrice = 1;
        } else {
          basePrice = 0.5;
        }
      }
      return { 
        ...p, 
        basePrice, 
        role,
        isForeign: p.nationality && !p.nationality.toLowerCase().includes('india')
      };
    });
  } else {
    // For Legend auction, use stats-based pricing
    let sorted = [...players];
    
    if (role === 'batsman') {
      sorted.sort((a,b) => parseFloat(b.stats?.runs_or_wickets||0) - parseFloat(a.stats?.runs_or_wickets||0));
    } else if (role === 'bowler') {
      sorted.sort((a,b) => parseFloat(b.stats?.matches||0) - parseFloat(a.stats?.matches||0));
    } else {
      sorted.sort((a,b) => parseFloat(b.batting_stats?.matches||0) - parseFloat(a.batting_stats?.matches||0));
    }
    
    const third = Math.ceil(sorted.length / 3);
    return sorted.map((p, i) => {
      let basePrice;
      if (i < third) basePrice = 2;
      else if (i < third * 2) basePrice = 1;
      else basePrice = 0.5;
      return { ...p, basePrice, role, isForeign: false };
    });
  }
}

function showAuction() {
  // Save current screen state
  localStorage.setItem('currentScreen', 'auction');

  // Always restore auction mode from room data
  if (roomData && roomData.auction_mode) {
    auctionMode = roomData.auction_mode;
  }

  if (PAGE !== 'auction') {
    navigateTo('auction');
    return;
  }

  // Update header
  const myTeam = TEAMS.find(t => t.abbr === roomData.players[playerId].team);
  document.getElementById('userBadge').innerHTML = myTeam.abbr;
  document.getElementById('userBadge').style.background = myTeam.color;
  document.getElementById('userBadge').style.color = myTeam.textColor;
  document.getElementById('userNameDisplay').textContent = roomData.players[playerId].name;
  document.getElementById('userTeamDisplay').textContent = myTeam.name;

  // Check if current player is host
  const isCurrentHost = playerId === roomData.host_id;

  syncTimerControls();
  
  if (isCurrentHost) {
    document.getElementById('endAuctionBtn').style.display = 'block';
    document.getElementById('timerControls').style.display = 'flex';
    if (roomData.auction_state.status === 'active') startTimer();
  } else {
    document.getElementById('endAuctionBtn').style.display = 'none';
    document.getElementById('timerControls').style.display = 'none';
  }

  updateAuctionUI();
}

function updateAuctionUI() {
  if (!roomData || !roomData.auction_state) return;

  const state = roomData.auction_state;
  const currentPlayer = state.auction_queue[state.current_player_idx];
  
  if (!currentPlayer) return;

  renderPlayer(currentPlayer);
  renderUpcoming();
  renderTeams();
  renderBidState(currentPlayer);
  updateTimerDisplay();
}

function renderPlayer(p) {
  // Ensure basePrice exists and is valid
  if (!p.basePrice || p.basePrice === 0) {
    p.basePrice = 0.5; // Default to 50 lakh minimum
  }
  
  // Get display name and team
  let displayName = p.name;
  let teams = p.team || '';
  let nationality = p.nationality || '';
  
  // For legend mode with old format - name has team in parentheses
  const nameMatch = p.name.match(/^(.+?)\s*\((.+)\)$/);
  if (nameMatch) {
    displayName = nameMatch[1];
    teams = nameMatch[2];
  }

  // For legend mode, determine nationality from isForeign flag
  if (!nationality && auctionMode === 'legend') {
    nationality = p.isForeign ? 'Overseas' : 'Indian';
  } else if (!nationality) {
    nationality = p.isForeign ? 'Overseas' : 'Indian';
  }

  // ─── Build details HTML (goes in sidebar detailsPanel) ───
  let detailsHTML = '';

  if (auctionMode === 'mega') {
    detailsHTML = `
      <div class="detail-section-header">
        <span class="detail-icon">📋</span> Player Details
      </div>
      <div class="detail-items">
        <div class="detail-row">
          <span class="detail-label">Previous Team</span>
          <span class="detail-value">${teams || 'N/A'}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Role</span>
          <span class="detail-value">${(p.role_text || p.role).replace('_', ' ')}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Nationality</span>
          <span class="detail-value ${p.isForeign ? 'foreign-player' : 'indian-player'}">${nationality || 'N/A'}</span>
        </div>
        <div class="detail-row">
          <span class="detail-label">Base Price</span>
          <span class="detail-value accent-text">${formatCr(p.basePrice)}</span>
        </div>
      </div>
    `;
  } else {
    // Legend Auction: Show stats in sidebar
    let statsHTML = '';
    if (p.role === 'batsman' && p.stats) {
      statsHTML = `
        <div class="detail-section-header">
          <span class="detail-icon">📊</span> Career Statistics
        </div>
        <div class="stats-grid-sidebar">
          ${statBox(p.stats.matches, 'Matches')}
          ${statBox(p.stats.innings, 'Innings')}
          ${statBox(parseInt(p.stats.runs_or_wickets||0).toLocaleString(), 'Runs')}
          ${statBox(p.stats.avg, 'Average')}
          ${statBox(p.stats.sr_or_economy, 'Strike Rate')}
          ${statBox(parseInt(p.stats.hundreds_or_5w||0), '100s')}
          ${statBox(parseInt(p.stats.fifties_or_4w||0), '50s')}
          ${statBox(parseInt(p.stats.fours_or_runs_conceded||0), '4s')}
          ${statBox(p.stats.sixes_or_wickets, '6s')}
        </div>
      `;
    } else if (p.role === 'bowler' && p.stats) {
      statsHTML = `
        <div class="detail-section-header">
          <span class="detail-icon">📊</span> Career Statistics
        </div>
        <div class="stats-grid-sidebar">
          ${statBox(p.stats.matches, 'Matches')}
          ${statBox(p.stats.innings, 'Innings')}
          ${statBox(p.stats.balls_or_balls_faced, 'Wickets')}
          ${statBox(p.stats.hundreds_or_5w, 'Average')}
          ${statBox(p.stats.fifties_or_4w, 'Economy')}
          ${statBox(p.stats.ducks_or_maidens, 'Strike Rate')}
        </div>
      `;
    } else if (p.role === 'all_rounder') {
      statsHTML = `
        <div class="detail-section-header">
          <span class="detail-icon">🏏</span> Batting Statistics
        </div>
        <div class="stats-grid-sidebar">
          ${statBox(p.batting_stats?.matches||'-', 'Matches')}
          ${statBox(parseInt(p.batting_stats?.runs_or_wickets||0).toLocaleString(), 'Runs')}
          ${statBox(p.batting_stats?.avg||'-', 'Average')}
          ${statBox(p.batting_stats?.sr_or_economy||'-', 'SR')}
        </div>
        <div class="detail-section-header" style="margin-top:16px;">
          <span class="detail-icon">🎳</span> Bowling Statistics
        </div>
        <div class="stats-grid-sidebar">
          ${statBox(p.bowling_stats?.matches||'-', 'Matches')}
          ${statBox(p.bowling_stats?.balls_or_balls_faced||'-', 'Wickets')}
          ${statBox(p.bowling_stats?.hundreds_or_5w||'-', 'Avg')}
          ${statBox(p.bowling_stats?.fifties_or_4w||'-', 'Econ')}
        </div>
      `;
    } else {
      statsHTML = `
        <div class="detail-section-header">
          <span class="detail-icon">📋</span> Player Information
        </div>
        <p style="text-align:center;margin-top:16px;color:var(--text-dim);font-size:0.95rem;">Stats not available</p>
      `;
    }
    detailsHTML = statsHTML;
  }

  // ─── Render details panel (below bidding in center) ───
  const detailsPanel = document.getElementById('detailsPanel');
  if (detailsPanel) detailsPanel.innerHTML = detailsHTML;

  // ─── Center panel: player name + timer + base price + current bid + bid button ───
  document.getElementById('playerPanel').innerHTML = `
    <div class="center-player-card">
      <div class="player-top-row">
        <div class="player-identity">
          <span class="player-role-badge ${p.role}">${p.role.replace('_', ' ')}</span>
          <h2 class="player-name-large">${displayName}</h2>
          <p class="player-teams-text">${teams}</p>
          ${p.isForeign ? '<span class="foreign-badge">🌍 FOREIGN</span>' : ''}
        </div>
        <div class="timer-circle">
          <svg class="timer-svg" width="100" height="100">
            <circle class="timer-bg" cx="50" cy="50" r="42"></circle>
            <circle class="timer-progress" id="timerProgress" cx="50" cy="50" r="42"
              stroke-dasharray="264" stroke-dashoffset="0"></circle>
          </svg>
          <div class="timer-text" id="timerText">${roomData.auction_state.time_left}</div>
        </div>
      </div>

      <div class="center-bid-area">
        <div class="base-price-pill">
          <span class="bp-label">BASE PRICE</span>
          <span class="bp-value">${formatCr(p.basePrice)}</span>
        </div>

        <div class="current-bid-card">
          <div class="current-bid-label">CURRENT BID</div>
          <div class="current-bid-amount" id="bidAmount">${formatCr(roomData.auction_state.current_bid)}</div>
          <div class="current-bidder" id="bidder">Base Price</div>
        </div>

        <button class="bid-btn bid-btn-primary" id="bidBtn">
          BID ${formatCr(getNextBid())}
        </button>
      </div>

      <div class="bid-history" id="bidHistory"></div>
    </div>
  `;

  document.getElementById('bidBtn').addEventListener('click', placeBid);
}

function statBox(val, label) {
  return `<div class="stat-box">
    <div class="stat-box-value">${val||'-'}</div>
    <div class="stat-box-label">${label}</div>
  </div>`;
}

function renderUpcoming() {
  const state = roomData.auction_state;
  const panel = document.getElementById('upcomingPanel');
  const isExpanded = panel && panel.classList.contains('expanded');
  
  const start = state.current_player_idx + 1;
  const end = isExpanded ? state.auction_queue.length : Math.min(start + 5, state.auction_queue.length);
  
  const upcoming = state.auction_queue.slice(start, end);
  
  document.getElementById('upcomingList').innerHTML = upcoming.map((p) => {
    const nameMatch = p.name.match(/^(.+?)\s*\(/);
    const name = nameMatch ? nameMatch[1] : p.name;
    return `
      <div class="upcoming-card">
        <div class="upcoming-name">${name}</div>
        <div class="upcoming-role role-${p.role.toLowerCase()}">${p.role.replace('_', ' ')}</div>
      </div>
    `;
  }).join('');
}

function renderTeams() {
  const players = Object.entries(roomData.players);
  const state = roomData.auction_state;

  document.getElementById('teamsList').innerHTML = players.map(([pid, p]) => {
    const team = TEAMS.find(t => t.abbr === p.team);
    const isUser = pid === playerId;
    const isActiveBidder = pid === state.current_bidder_id;

    return `
      <div class="team-card ${isUser?'user-team':''} ${isActiveBidder?'active-bidder':''}">
        <div class="team-card-header">
          <div class="team-card-logo" style="background:${team.color};color:${team.textColor}">${team.abbr}</div>
          <div class="team-card-info">
            <div class="team-card-name">${p.name}${isUser?' (You)':''}</div>
            <div class="team-card-purse">${formatCr(p.purse)}</div>
          </div>
        </div>
        <div class="team-players-list">
          ${p.players.length === 0 ? '<div class="no-players">No players yet</div>' : 
            p.players.map(pl => {
              const nm = pl.name.match(/^(.+?)\s*\(/);
              return `<div class="team-player-item">
                <span class="team-player-name">${nm ? nm[1] : pl.name}</span>
                <span class="team-player-price">${formatCrShort(pl.price)}</span>
              </div>`;
            }).join('')
          }
        </div>
      </div>
    `;
  }).join('');

  // Update user stats
  const myData = roomData.players[playerId];
  document.getElementById('userPurse').textContent = formatCr(myData.purse);
  document.getElementById('userCount').textContent = myData.players.length;
}

function renderBidState(currentPlayer) {
  const state = roomData.auction_state;

  document.getElementById('bidAmount').textContent = formatCr(state.current_bid);

  if (state.current_bidder_id) {
    const bidder = roomData.players[state.current_bidder_id];
    document.getElementById('bidder').innerHTML = 
      `<strong>${bidder.name}${state.current_bidder_id === playerId ? ' (You)' : ''}</strong>`;
  } else {
    document.getElementById('bidder').innerHTML = 'Base Price';
  }

  const nextBid = getNextBid();
  const myData = roomData.players[playerId];
  const canBid = myData.purse >= nextBid && state.current_bidder_id !== playerId && state.status === 'active';

  const bidBtn = document.getElementById('bidBtn');
  bidBtn.textContent = `BID ${formatCr(nextBid)}`;
  bidBtn.disabled = !canBid;

  // Render bid history
  const histEl = document.getElementById('bidHistory');
  histEl.innerHTML = state.bid_history.slice().reverse().map(h => `
    <div class="bid-history-item">
      <span class="bid-history-team">${h.player_name}</span>
      <span class="bid-history-amount">${formatCr(h.amount)}</span>
    </div>
  `).join('');
}

function getNextBid() {
  const current = roomData.auction_state.current_bid;
  if (current < 5) return Math.round((current + 0.10) * 100) / 100;
  return Math.round((current + 0.25) * 100) / 100;
}

function placeBid() {
  const nextBid = getNextBid();
  ws.send(JSON.stringify({
    action: 'place_bid',
    bid_amount: nextBid
  }));
}

function startTimer() {
  if (timerInterval) clearInterval(timerInterval);

  timerInterval = setInterval(() => {
    if (roomData.auction_state.status !== 'active') {
      clearInterval(timerInterval);
      return;
    }

    roomData.auction_state.time_left--;
    
    ws.send(JSON.stringify({
      action: 'timer_tick',
      time_left: roomData.auction_state.time_left
    }));

    updateTimerDisplay();

    if (roomData.auction_state.time_left <= 0) {
      clearInterval(timerInterval);
      soldPlayer();
    }
  }, 1000);
}

function updateTimerDisplay() {
  const timeLeft = roomData.auction_state.time_left;
  const timerText = document.getElementById('timerText');
  if (timerText) timerText.textContent = timeLeft;

  const progress = document.getElementById('timerProgress');
  if (progress) {
    const duration = normalizeTimerDuration(roomData.timer_duration, 15);
    const percent = Math.max(0, Math.min(1, timeLeft / duration));
    const circumference = 264; // 2 * π * 42
    const offset = circumference * (1 - percent);
    progress.style.strokeDashoffset = offset;
  }
}

function soldPlayer() {
  const state = roomData.auction_state;
  const currentPlayer = state.auction_queue[state.current_player_idx];
  
  ws.send(JSON.stringify({
    action: 'player_sold',
    player_data: {
      name: currentPlayer.name,
      price: state.current_bid,
      role: currentPlayer.role
    },
    final_price: state.current_bid
  }));
}

function showSoldOverlay(winnerName, finalPrice) {
  const state = roomData.auction_state;
  const prevIdx = state.current_player_idx - 1;
  
  if (prevIdx >= 0 && prevIdx < state.auction_queue.length) {
    const player = state.auction_queue[prevIdx];
    const nameMatch = player.name.match(/^(.+?)\s*\(/);
    const name = nameMatch ? nameMatch[1] : player.name;

    let displayName = 'UNSOLD';
    let price = '';
    let badgeClass = 'unsold';

    if (winnerName !== 'UNSOLD' && finalPrice) {
      displayName = 'SOLD!';
      badgeClass = '';
      price = `
        <div class="sold-team">to ${winnerName}</div>
        <div class="sold-price">${formatCr(finalPrice)}</div>
      `;
      
      // Add to sold players list
      addSoldPlayer(name, winnerName, finalPrice, player.role);
    } else {
      // Add to unsold players list
      addUnsoldPlayer(name, player.basePrice, player.role);
      // Don't show toast notification for unsold - overlay is enough
    }

    document.getElementById('soldContent').innerHTML = `
      <div class="sold-badge ${badgeClass}">${displayName}</div>
      <div class="sold-player-name">${name}</div>
      ${price}
    `;

    document.getElementById('soldOverlay').classList.add('show');

    setTimeout(() => {
      document.getElementById('soldOverlay').classList.remove('show');
      
      if (state.current_player_idx < state.auction_queue.length && state.status === 'active') {
        updateAuctionUI();
        if (isHost) startTimer();
      }
    }, 2500);
  }
}

function togglePause() {
  if (roomData.auction_state.status === 'active') {
    ws.send(JSON.stringify({ action: 'pause_auction' }));
  } else if (roomData.auction_state.status === 'paused') {
    ws.send(JSON.stringify({ action: 'resume_auction' }));
  }
}

function endAuction() {
  if (confirm('Are you sure you want to end the auction?')) {
    ws.send(JSON.stringify({ action: 'end_auction' }));
  }
}

function resumeAuction() {
  ws.send(JSON.stringify({ action: 'resume_auction' }));
}

function changeTimer() {
  const newTimer = normalizeTimerDuration(document.getElementById('timerSelect').value, 15);
  if (isHost) {
    ws.send(JSON.stringify({ 
      action: 'change_timer', 
      timer_duration: newTimer 
    }));
  }
}

function sendChatMessage() {
  const input = document.getElementById('chatInput');
  const message = input.value.trim();
  if (message && ws && ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({
      action: 'send_message',
      message: message
    }));
    input.value = '';
  }
}

function addChatMessage(playerName, message, team) {
  const chatMessages = document.getElementById('chatMessages');
  const teamInfo = TEAMS.find(t => t.abbr === team);
  const color = teamInfo ? teamInfo.color : '#666';
  
  const msgDiv = document.createElement('div');
  msgDiv.className = 'chat-message';
  msgDiv.innerHTML = `
    <span class="chat-sender" style="color: ${color}">${playerName}:</span>
    <span class="chat-text">${escapeHtml(message)}</span>
  `;
  chatMessages.appendChild(msgDiv);
  chatMessages.scrollTop = chatMessages.scrollHeight;
}

function addSoldPlayer(playerName, winnerName, price, role) {
  const soldList = document.getElementById('soldPlayersList');
  const count = document.getElementById('soldCount');
  
  const soldDiv = document.createElement('div');
  soldDiv.className = 'sold-player-item';
  soldDiv.dataset.price = price; // Store price for sorting
  soldDiv.innerHTML = `
    <div class="sold-player-name">${playerName}</div>
    <div class="sold-player-details">
      <span class="role-badge role-${role.toLowerCase()}">${role}</span>
      <span>${winnerName} • ${formatCr(price)}</span>
    </div>
  `;
  
  // Insert in sorted order (highest price first)
  let inserted = false;
  for (let i = 0; i < soldList.children.length; i++) {
    const childPrice = parseFloat(soldList.children[i].dataset.price || 0);
    if (price > childPrice) {
      soldList.insertBefore(soldDiv, soldList.children[i]);
      inserted = true;
      break;
    }
  }
  if (!inserted) {
    soldList.appendChild(soldDiv);
  }
  
  count.textContent = soldList.children.length;
}

function addUnsoldPlayer(playerName, basePrice, role) {
  const unsoldList = document.getElementById('unsoldPlayersList');
  const count = document.getElementById('unsoldCount');
  
  const unsoldDiv = document.createElement('div');
  unsoldDiv.className = 'unsold-player-item';
  unsoldDiv.innerHTML = `
    <div class="unsold-player-name">${playerName}</div>
    <div class="unsold-player-details">
      <span class="role-badge role-${role.toLowerCase()}">${role}</span>
      <span>Base: ${formatCr(basePrice)}</span>
    </div>
  `;
  unsoldList.insertBefore(unsoldDiv, unsoldList.firstChild);
  count.textContent = unsoldList.children.length;
}

function escapeHtml(text) {
  const div = document.createElement('div');
  div.textContent = text;
  return div.innerHTML;
}

function toggleUpcoming() {
  const panel = document.getElementById('upcomingPanel');
  const icon = document.getElementById('expandIcon');
  
  panel.classList.toggle('expanded');
  if (panel.classList.contains('expanded')) {
    icon.textContent = '▲';
  } else {
    icon.textContent = '▼';
  }
  // Re-render the upcoming list with new limit
  renderUpcoming();
}

function formatCr(val) {
  // Handle invalid values
  if (!val || val === 0 || isNaN(val)) {
    return '₹50 L'; // Default to minimum base price
  }
  if (val >= 1) return '₹' + val.toFixed(2) + ' Cr';
  return '₹' + (val * 100).toFixed(0) + ' L';
}

function formatCrShort(val) {
  if (val >= 1) return val.toFixed(2) + 'Cr';
  return (val * 100).toFixed(0) + 'L';
}

function showToast(message, type = 'info') {
  const toast = document.createElement('div');
  toast.className = `toast toast-${type}`;
  toast.textContent = message;
  document.body.appendChild(toast);
  
  setTimeout(() => toast.classList.add('show'), 10);
  
  setTimeout(() => {
    toast.classList.remove('show');
    setTimeout(() => toast.remove(), 300);
  }, 3000);
}

function showAuctionResults() {
  let currentTeamPage = 0;
  let currentUnsoldPage = 0;
  const teamsPerPage = 2;
  
  const playerEntries = Object.entries(roomData.players);
  const totalTeamPages = Math.ceil(playerEntries.length / teamsPerPage);
  
  // Group unsold players by base price
  const unsoldByPrice = {};
  if (roomData.auction_state.unsold_players) {
    roomData.auction_state.unsold_players.forEach(player => {
      const price = player.basePrice;
      if (!unsoldByPrice[price]) {
        unsoldByPrice[price] = [];
      }
      unsoldByPrice[price].push(player);
    });
  }
  const unsoldPrices = Object.keys(unsoldByPrice).sort((a, b) => b - a); // High to low
  const totalUnsoldPages = unsoldPrices.length;
  
  function renderResults() {
    const existingOverlay = document.querySelector('.results-overlay');
    if (existingOverlay) existingOverlay.remove();
    
    const startIdx = currentTeamPage * teamsPerPage;
    const endIdx = Math.min(startIdx + teamsPerPage, playerEntries.length);
    const currentTeams = playerEntries.slice(startIdx, endIdx);
    
    const resultsHTML = `
      <div class="results-overlay">
        <div class="results-container">
          <div class="results-header">
            <h1>🏆 Auction Complete!</h1>
            <p>Final Team Squads - Page ${currentTeamPage + 1}/${totalTeamPages}</p>
          </div>
          <div class="results-teams">
            ${currentTeams.map(([pid, p]) => {
              const team = TEAMS.find(t => t.abbr === p.team);
              const totalSpent = 120 - p.purse;
              return `
                <div class="result-team-card">
                  <div class="result-team-header" style="background: ${team.color}; color: ${team.textColor}">
                    <div class="result-team-name">
                      <div class="result-team-badge">${team.abbr}</div>
                      <div>
                        <h3>${p.name}</h3>
                        <p>${team.name}</p>
                      </div>
                    </div>
                    <div class="result-team-stats">
                      <div class="result-stat">
                        <span class="result-stat-label">Players</span>
                        <span class="result-stat-value">${p.players.length}</span>
                      </div>
                      <div class="result-stat">
                        <span class="result-stat-label">Spent</span>
                        <span class="result-stat-value">${formatCr(totalSpent)}</span>
                      </div>
                      <div class="result-stat">
                        <span class="result-stat-label">Remaining</span>
                        <span class="result-stat-value">${formatCr(p.purse)}</span>
                      </div>
                      ${roomData.auction_mode === 'mega' ? `
                        <div class="result-stat">
                          <span class="result-stat-label">Foreign</span>
                          <span class="result-stat-value">${p.foreign_count || 0}/8</span>
                        </div>
                      ` : ''}
                    </div>
                  </div>
                  <div class="result-players-list">
                    ${p.players.length > 0 ? p.players.map(player => {
                      const pName = player.name.match(/^(.+?)\s*\(/)?.[1] || player.name;
                      return `
                        <div class="result-player-item">
                          <span class="result-player-name">${pName}</span>
                          <div class="result-player-meta">
                            <span class="result-player-role role-${player.role}">${(player.role_text || player.role).replace('_', ' ')}</span>
                            <span class="result-player-price">${formatCr(player.soldPrice)}</span>
                            ${player.isForeign ? '<span class="foreign-tag">🌍</span>' : ''}
                          </div>
                        </div>
                      `;
                    }).join('') : '<p class="no-players">No players bought</p>'}
                  </div>
                </div>
              `;
            }).join('')}
          </div>
          
          ${totalTeamPages > 1 ? `
            <div class="pagination-controls">
              <button class="page-btn" ${currentTeamPage === 0 ? 'disabled' : ''} onclick="window.prevTeamPage()">◀ Previous</button>
              <span class="page-indicator">${currentTeamPage + 1} / ${totalTeamPages}</span>
              <button class="page-btn" ${currentTeamPage === totalTeamPages - 1 ? 'disabled' : ''} onclick="window.nextTeamPage()">▶ Next</button>
            </div>
          ` : ''}
          
          ${totalUnsoldPages > 0 ? `
            <div class="results-unsold-section">
              <h2>❌ Unsold Players - Base Price ${formatCr(parseFloat(unsoldPrices[currentUnsoldPage]))}</h2>
              <div class="results-unsold-list">
                ${unsoldByPrice[unsoldPrices[currentUnsoldPage]].map(player => {
                  const pName = player.name.match(/^(.+?)\s*\(/)?.[1] || player.name;
                  return `
                    <div class="result-unsold-item">
                      <span class="result-player-name">${pName}</span>
                      <span class="result-player-role role-${player.role}">${player.role}</span>
                      <span class="result-unsold-base">Base: ${formatCr(player.basePrice)}</span>
                    </div>
                  `;
                }).join('')}
              </div>
              ${totalUnsoldPages > 1 ? `
                <div class="pagination-controls">
                  <button class="page-btn" ${currentUnsoldPage === 0 ? 'disabled' : ''} onclick="window.prevUnsoldPage()">◀ Previous</button>
                  <span class="page-indicator">${currentUnsoldPage + 1} / ${totalUnsoldPages}</span>
                  <button class="page-btn" ${currentUnsoldPage === totalUnsoldPages - 1 ? 'disabled' : ''} onclick="window.nextUnsoldPage()">▶ Next</button>
                </div>
              ` : ''}
            </div>
          ` : ''}
          
          <div style="text-align: center; margin-top: 50px; padding-bottom: 30px;">
            <button class="close-results-btn" onclick="goBackToHome()">🏠 Back to Home</button>
          </div>
        </div>
      </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', resultsHTML);
  }
  
  // Expose pagination functions globally
  window.nextTeamPage = () => {
    if (currentTeamPage < totalTeamPages - 1) {
      currentTeamPage++;
      renderResults();
    }
  };
  
  window.prevTeamPage = () => {
    if (currentTeamPage > 0) {
      currentTeamPage--;
      renderResults();
    }
  };
  
  window.nextUnsoldPage = () => {
    if (currentUnsoldPage < totalUnsoldPages - 1) {
      currentUnsoldPage++;
      renderResults();
    }
  };
  
  window.prevUnsoldPage = () => {
    if (currentUnsoldPage > 0) {
      currentUnsoldPage--;
      renderResults();
    }
  };
  
  renderResults();
}

function closeResults() {
  const overlay = document.querySelector('.results-overlay');
  if (overlay) overlay.remove();
}

function goBackToHome() {
  // Clear session and go home
  if (ws) {
    try { ws.close(); } catch(e) {}
  }
  resetSessionState();
  navigateTo('home');
}

function showUnsoldSelection() {
  let currentPage = 0;
  
  // Group unsold players by base price
  const unsoldByPrice = {};
  roomData.auction_state.unsold_players.forEach(player => {
    const price = player.basePrice;
    if (!unsoldByPrice[price]) {
      unsoldByPrice[price] = [];
    }
    unsoldByPrice[price].push(player);
  });
  
  const unsoldPrices = Object.keys(unsoldByPrice).sort((a, b) => b - a); // High to low
  const totalPages = unsoldPrices.length;
  
  function renderSelection() {
    const existingOverlay = document.querySelector('.results-overlay');
    if (existingOverlay) existingOverlay.remove();
    
    const currentPrice = unsoldPrices[currentPage];
    const currentPlayers = unsoldByPrice[currentPrice];
    
    const unsoldHTML = `
      <div class="results-overlay">
        <div class="results-container">
          <div class="results-header">
            <h1>⚠️ Unsold Players</h1>
            <p>${roomData.auction_state.unsold_players.length} players went unsold</p>
            <p style="color: var(--text-dim); font-size: 0.9rem;">Select players with Base Price ${formatCr(parseFloat(currentPrice))} for re-auction</p>
          </div>
          
          <div class="unsold-selection-grid">
            ${currentPlayers.map((player, idx) => {
              const pName = player.name.match(/^(.+?)\s*\(/)?.[1] || player.name;
              const globalIdx = roomData.auction_state.unsold_players.indexOf(player);
              return `
                <div class="unsold-select-card">
                  <input type="checkbox" id="unsold-${globalIdx}" class="unsold-checkbox" data-player='${JSON.stringify(player)}'>
                  <label for="unsold-${globalIdx}" class="unsold-card-label">
                    <div class="unsold-card-name">${pName}</div>
                    <div class="unsold-card-meta">
                      <span class="role-badge role-${player.role}">${player.role}</span>
                      <span class="unsold-card-price">${formatCr(player.basePrice)}</span>
                    </div>
                  </label>
                </div>
              `;
            }).join('')}
          </div>
          
          ${totalPages > 1 ? `
            <div class="pagination-controls">
              <button class="page-btn" ${currentPage === 0 ? 'disabled' : ''} onclick="window.prevUnsoldSelectPage()">◀ Previous</button>
              <span class="page-indicator">${currentPage + 1} / ${totalPages}</span>
              <button class="page-btn" ${currentPage === totalPages - 1 ? 'disabled' : ''} onclick="window.nextUnsoldSelectPage()">▶ Next</button>
            </div>
          ` : ''}
          
          <div class="unsold-actions">
            <button class="unsold-action-btn primary" onclick="startReauction()">🔄 Re-Auction Selected</button>
            <button class="unsold-action-btn secondary" onclick="finishAuction()">✅ Finish Auction</button>
            <p style="color: var(--text-dim); font-size: 0.85rem; margin-top:extend 10px;">Any player can select players for re-auction or finish the auction</p>
          </div>
        </div>
      </div>
    `;
    
    document.body.insertAdjacentHTML('beforeend', unsoldHTML);
  }
  
  // Expose pagination functions globally
  window.nextUnsoldSelectPage = () => {
    if (currentPage < totalPages - 1) {
      currentPage++;
      renderSelection();
    }
  };
  
  window.prevUnsoldSelectPage = () => {
    if (currentPage > 0) {
      currentPage--;
      renderSelection();
    }
  };
  
  renderSelection();
}

function startReauction() {
  const checkboxes = document.querySelectorAll('.unsold-checkbox:checked');
  const selectedPlayers = Array.from(checkboxes).map(cb => JSON.parse(cb.dataset.player));
  
  if (selectedPlayers.length === 0) {
    alert('Please select at least one player to re-auction');
    return;
  }
  
  // Close unsold selection
  const overlay = document.querySelector('.results-overlay');
  if (overlay) overlay.remove();
  
  // Send to server to restart auction with selected players
  ws.send(JSON.stringify({
    action: 'start_reauction',
    selected_players: selectedPlayers
  }));
}

function finishAuction() {
  // Close unsold selection and show final results
  const overlay = document.querySelector('.results-overlay');
  if (overlay) overlay.remove();
  
  showAuctionResults();
}