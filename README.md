# IPL Auction 2026 - Multiplayer Real-Time Bidding 🏏

A fully functional multiplayer IPL auction simulator where **2-10 real players** can join a room and bid on **ALL players** from the IPL 2026 dataset in real-time.

## 🎮 Features

### ✅ Multiplayer System
- **2-10 real human players** can join each auction
- First player is automatically the **HOST**
- **Room code system** - share 6-digit code with friends
- Real-time synchronization using WebSockets
- Players join from different devices/browsers

### ✅ Host Controls
- **Create Room** with custom settings:
  - Set max players (2-10)
  - Set bidding timer (5-30 seconds per player)
- **Start Auction** when all players join
- **Pause/Resume** auction at any time
- **End Auction** at any time

### ✅ All Players Features
- **Pause Button** available to all players
- See live updates of all bids
- View upcoming players queue
- Track all team squads in real-time

### ✅ Auction Features
- **ALL players** from JSON auctioned (200+ players)
- Players come in order: **Batsmen → All-Rounders → Bowlers**
- **Base Prices**: 
  - Top tier: ₹2 Cr
  - Middle tier: ₹1 Cr
  - Lower tier: ₹50 Lakh
- **Bidding Increments**:
  - Under ₹5 Cr: **+₹10 Lakh**
  - ₹5 Cr and above: **+₹25 Lakh**
- **Timer resets** on each bid
- **SOLD/UNSOLD** animations
- **Complete player stats** displayed

### ✅ Beautiful UI
- Modern dark theme with gradients
- Fully **responsive** (mobile, tablet, desktop)
- **Live timer** with circular countdown
- Color-coded player roles
- Real-time team purse tracking
- Smooth animations

## 🚀 How to Use

### 1. Start the Server

```bash
cd "Auction"
python auction_server.py
```

Server starts at: **http://localhost:8080**

### 2. Create a Room (Host)

1. Open http://localhost:8080 in your browser
2. Enter your name
3. Choose your team (e.g., CSK, MI, RCB)
4. Set max players (2-10)
5. Set bidding timer (5-30 seconds)
6. Click **"Create Room"**
7. **Copy the 6-digit room code** and share with friends

### 3. Join a Room (Players)

1. Open http://localhost:8080 in **different browsers/devices**
2. Enter your name
3. Choose your team (each team can only be picked once)
4. Enter the **6-digit room code**
5. Click **"Join Room"**

### 4. Start the Auction

- Once all players join (or minimum 2 players), **host clicks "Start Auction"**
- ALL 200+ players from the JSON will be auctioned
- Players appear in order: Batsmen → All-Rounders → Bowlers

### 5. Bidding

- **Timer starts** for each player (5-30 seconds based on host settings)
- Click **"BID"** button to place your bid
- Bid increments automatically (+₹10L under ₹5Cr, +₹25L above)
- Timer **resets** when anyone bids
- When timer expires, **highest bidder wins** the player
- If no one bids, player is **UNSOLD**

### 6. Controls During Auction

- **Pause**: Any player can pause the auction
- **Resume**: Host can resume
- **End Auction**: Host can end auction at any time

## 📁 Project Files

```
Auction/
├── auction_server.py      # WebSocket server (multiplayer backend)
├── index.html             # Main HTML (UI)
├── auction.js             # JavaScript (WebSocket client, game logic)
├── ipl_players_with_stats.json  # Player database (200+ players)
└── requirements.txt       # Python dependencies
```

## 🔧 Technical Details

### Backend (auction_server.py)
- **Python** with `aiohttp` for WebSocket server
- Real-time room management
- Synchronizes auction state across all clients
- Handles bidding, timer, player sold logic

### Frontend (index.html + auction.js)
- **WebSocket client** for real-time communication
- Three screens: Home → Lobby → Auction
- Timer synchronization
- Real-time UI updates

### Data (ipl_players_with_stats.json)
- 124 Batsmen
- 74 Bowlers
- 26 All-Rounders
- Complete IPL statistics for each player

## 🎯 Base Price Assignment

Players are sorted by performance and divided into 3 tiers:

**Batsmen**: Sorted by total runs
**Bowlers**: Sorted by matches played
**All-Rounders**: Sorted by batting matches

- **Top 1/3**: ₹2 Cr base price
- **Middle 1/3**: ₹1 Cr base price
- **Bottom 1/3**: ₹50 Lakh base price

## 🎮 Gameplay Flow

1. **Home Screen** → Create/Join Room
2. **Lobby Screen** → Wait for players, host starts auction
3. **Auction Screen** → Real-time bidding on all players
4. **Summary** → View final team squads

## ⚡ Requirements

- **Python 3.7+**
- **aiohttp** (installed via requirements.txt)
- **Modern web browser** (Chrome, Firefox, Edge, Safari)

## 🌐 Network Play

To play with friends over network:

1. **Find your IP address** (run `ipconfig` on Windows)
2. Share: `http://YOUR_IP:8080` instead of localhost
3. Make sure port **8080 is open** in firewall

## 🐛 Troubleshooting

**WebSocket connection failed?**
- Make sure server is running (`python auction_server.py`)
- Check firewall settings
- Try different browser

**Room code not working?**
- Make sure all players use same server
- Room codes are case-sensitive
- Each room expires when all players leave

**Timer not syncing?**
- Only host manages timer
- Check your internet connection
- Refresh page and rejoin room

## 📝 Notes

- **Purse**: Each team starts with ₹120 Cr
- **No player limits** - buy as many as your purse allows
- **Can't un-bid** - bids are final
- **Room persists** until all players leave
- **Auction can be ended early** by host

## 🎉 Enjoy the Auction!

Experience the thrill of being an IPL team owner in this realistic multiplayer auction simulator!
