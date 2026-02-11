import asyncio
import json
import secrets
from datetime import datetime
from aiohttp import web
import aiohttp_cors

# Store active rooms
rooms = {}

def normalize_timer_duration(value, default=15, min_value=5, max_value=30):
    try:
        parsed = int(value)
    except Exception:
        parsed = default
    return max(min_value, min(max_value, parsed))

class AuctionRoom:
    def __init__(self, room_code, host_name, auction_mode, timer_duration):
        self.room_code = room_code
        self.host_id = None
        self.auction_mode = auction_mode  # 'mega' or 'legend'
        self.max_players_per_team = 25  # Fixed at 25 players per team
        self.max_foreign_players = 8  # Max 8 foreign players in mega auction
        self.timer_duration = timer_duration
        self.players = {}
        self.teams = {}
        self.auction_state = {
            'status': 'waiting',  # waiting, active, paused, ended
            'current_player_idx': 0,
            'current_bid': 0,
            'current_bidder_id': None,
            'time_left': timer_duration,
            'bid_history': [],
            'auction_queue': [],
            'sold_players': [],
            'unsold_players': [],
            'paused_by': None
        }
        self.chat_messages = []
        self.websockets = {}
        
    def add_player(self, player_id, player_data):
        if len(self.players) >= 10:  # Max 10 teams
            return False
        
        if len(self.players) == 0:
            self.host_id = player_id
            
        self.players[player_id] = player_data
        self.players[player_id]['foreign_count'] = 0  # Track foreign players
        return True
    
    def remove_player(self, player_id):
        if player_id in self.players:
            del self.players[player_id]
        if player_id in self.websockets:
            del self.websockets[player_id]
        
        # If host leaves, assign new host
        if player_id == self.host_id and len(self.players) > 0:
            self.host_id = list(self.players.keys())[0]
    
    def to_dict(self):
        return {
            'room_code': self.room_code,
            'host_id': self.host_id,
            'auction_mode': self.auction_mode,
            'max_players_per_team': self.max_players_per_team,
            'max_foreign_players': self.max_foreign_players,
            'timer_duration': self.timer_duration,
            'players': self.players,
            'teams': self.teams,
            'auction_state': self.auction_state,
            'chat_messages': self.chat_messages
        }

async def handle_websocket(request):
    ws = web.WebSocketResponse()
    await ws.prepare(request)
    
    player_id = None
    room_code = None
    
    async for msg in ws:
        if msg.type == web.WSMsgType.TEXT:
            try:
                data = json.loads(msg.data)
                action = data.get('action')
                
                if action == 'reconnect':
                    # Handle reconnection
                    room_code = data.get('room_code')
                    player_id = data.get('player_id')
                    
                    if room_code in rooms and player_id in rooms[room_code].players:
                        room = rooms[room_code]
                        room.websockets[player_id] = ws
                        
                        await ws.send_json({
                            'type': 'reconnected',
                            'room_code': room_code,
                            'player_id': player_id,
                            'room_data': room.to_dict()
                        })
                    else:
                        await ws.send_json({'type': 'error', 'message': 'Room not found or player not in room'})
                
                elif action == 'create_room':
                    room_code = secrets.token_hex(3).upper()
                    while room_code in rooms:
                        room_code = secrets.token_hex(3).upper()
                    
                    timer_duration = normalize_timer_duration(data.get('timer_duration', 15))
                    room = AuctionRoom(
                        room_code,
                        data['player_name'],
                        data.get('auction_mode', 'mega'),
                        timer_duration
                    )
                    
                    player_id = secrets.token_hex(8)
                    room.add_player(player_id, {
                        'name': data['player_name'],
                        'team': data['team'],
                        'purse': 120,
                        'players': []
                    })
                    
                    room.websockets[player_id] = ws
                    rooms[room_code] = room
                    
                    await ws.send_json({
                        'type': 'room_created',
                        'room_code': room_code,
                        'player_id': player_id,
                        'room_data': room.to_dict()
                    })
                
                elif action == 'join_room':
                    room_code = data['room_code']
                    if room_code not in rooms:
                        await ws.send_json({'type': 'error', 'message': 'Room not found'})
                        continue
                    
                    room = rooms[room_code]
                    player_id = secrets.token_hex(8)
                    
                    # Check if player name already exists
                    existing_names = [p['name'] for p in room.players.values()]
                    if data['player_name'] in existing_names:
                        await ws.send_json({'type': 'error', 'message': 'Player name already exists in this room'})
                        continue
                    
                    # Check if team is already taken
                    taken_teams = [p['team'] for p in room.players.values()]
                    if data['team'] in taken_teams:
                        await ws.send_json({'type': 'error', 'message': 'Team already taken'})
                        continue
                    
                    if room.add_player(player_id, {
                        'name': data['player_name'],
                        'team': data['team'],
                        'purse': 120,
                        'players': []
                    }):
                        room.websockets[player_id] = ws
                        
                        # Notify player
                        await ws.send_json({
                            'type': 'joined_room',
                            'room_code': room_code,
                            'player_id': player_id,
                            'room_data': room.to_dict()
                        })
                        
                        # Broadcast to all players
                        await broadcast_to_room(room_code, {
                            'type': 'player_joined',
                            'room_data': room.to_dict()
                        })
                    else:
                        await ws.send_json({'type': 'error', 'message': 'Room is full'})
                
                elif action == 'leave_room':
                    if room_code and room_code in rooms:
                        room = rooms[room_code]
                        room.remove_player(player_id)
                        
                        if len(room.players) == 0:
                            del rooms[room_code]
                        else:
                            await broadcast_to_room(room_code, {
                                'type': 'player_left',
                                'room_data': room.to_dict()
                            })
                        
                        await ws.send_json({'type': 'left_room'})
                
                elif action == 'start_auction':
                    if room_code and room_code in rooms:
                        room = rooms[room_code]
                        if player_id == room.host_id:
                            room.auction_state['status'] = 'active'
                            room.auction_state['auction_queue'] = data['auction_queue']
                            room.auction_state['current_player_idx'] = 0
                            room.auction_state['time_left'] = room.timer_duration
                            
                            if len(room.auction_state['auction_queue']) > 0:
                                player = room.auction_state['auction_queue'][0]
                                room.auction_state['current_bid'] = player['basePrice']
                            
                            await broadcast_to_room(room_code, {
                                'type': 'auction_started',
                                'room_data': room.to_dict()
                            })
                
                elif action == 'start_reauction':
                    if room_code and room_code in rooms:
                        room = rooms[room_code]
                        # Any player can start re-auction, not just host
                        # Mark as re-auction to prevent showing unsold selection again
                        room.auction_state['is_reauction'] = True
                        room.auction_state['status'] = 'active'
                        room.auction_state['auction_queue'] = data['selected_players']
                        room.auction_state['current_player_idx'] = 0
                        room.auction_state['time_left'] = room.timer_duration
                        
                        if len(room.auction_state['auction_queue']) > 0:
                            player = room.auction_state['auction_queue'][0]
                            room.auction_state['current_bid'] = player['basePrice']
                        
                        await broadcast_to_room(room_code, {
                            'type': 'auction_started',
                            'room_data': room.to_dict()
                        })
                
                elif action == 'place_bid':
                    if room_code and room_code in rooms:
                        room = rooms[room_code]
                        if room.auction_state['status'] == 'active':
                            room.auction_state['current_bid'] = data['bid_amount']
                            room.auction_state['current_bidder_id'] = player_id
                            room.auction_state['time_left'] = room.timer_duration
                            room.auction_state['bid_history'].append({
                                'player_id': player_id,
                                'player_name': room.players[player_id]['name'],
                                'amount': data['bid_amount'],
                                'timestamp': datetime.now().isoformat()
                            })
                            
                            await broadcast_to_room(room_code, {
                                'type': 'bid_placed',
                                'room_data': room.to_dict()
                            })
                
                elif action == 'pause_auction':
                    if room_code and room_code in rooms:
                        room = rooms[room_code]
                        room.auction_state['status'] = 'paused'
                        room.auction_state['paused_by'] = player_id
                        
                        await broadcast_to_room(room_code, {
                            'type': 'auction_paused',
                            'paused_by': room.players[player_id]['name'],
                            'room_data': room.to_dict()
                        })
                
                elif action == 'resume_auction':
                    if room_code and room_code in rooms:
                        room = rooms[room_code]
                        room.auction_state['status'] = 'active'
                        room.auction_state['paused_by'] = None
                        
                        await broadcast_to_room(room_code, {
                            'type': 'auction_resumed',
                            'room_data': room.to_dict()
                        })
                
                elif action == 'list_rooms':
                    # Return all rooms and their status
                    room_list = []
                    for code, room in rooms.items():
                        room_list.append({
                            'room_code': code,
                            'status': room.auction_state['status'],
                            'players': [p['name'] for p in room.players.values()],
                            'auction_mode': room.auction_mode,
                            'timer_duration': room.timer_duration,
                            'host': room.players[room.host_id]['name'] if room.host_id in room.players else None
                        })
                    await ws.send_json({
                        'type': 'room_list',
                        'rooms': room_list
                    })
                
                elif action == 'send_message':
                    if room_code and room_code in rooms:
                        room = rooms[room_code]
                        message = {
                            'player_id': player_id,
                            'player_name': room.players[player_id]['name'],
                            'team': room.players[player_id]['team'],
                            'message': data['message'],
                            'timestamp': datetime.now().isoformat()
                        }
                        room.chat_messages.append(message)
                        
                        await broadcast_to_room(room_code, {
                            'type': 'new_message',
                            'message': message
                        })
                
                elif action == 'change_timer':
                    if room_code and room_code in rooms:
                        room = rooms[room_code]
                        if player_id == room.host_id:
                            timer_duration = normalize_timer_duration(data.get('timer_duration', room.timer_duration))
                            room.timer_duration = timer_duration
                            room.auction_state['time_left'] = timer_duration
                            
                            await broadcast_to_room(room_code, {
                                'type': 'timer_changed',
                                'timer_duration': timer_duration,
                                'room_data': room.to_dict()
                            })
                
                elif action == 'end_auction':
                    if room_code and room_code in rooms:
                        room = rooms[room_code]
                        if player_id == room.host_id:
                            room.auction_state['status'] = 'ended'
                            
                            await broadcast_to_room(room_code, {
                                'type': 'auction_ended',
                                'room_data': room.to_dict()
                            })
                
                elif action == 'player_sold':
                    if room_code and room_code in rooms:
                        room = rooms[room_code]
                        if player_id == room.host_id or room.auction_state['status'] == 'active':
                            player_data = data['player_data']
                            winner_id = room.auction_state['current_bidder_id']
                            final_price = data['final_price']
                            winner_name = 'UNSOLD'
                            
                            if winner_id and winner_id in room.players:
                                # Check foreign player limit in mega auction
                                is_foreign = player_data.get('isForeign', False)
                                if room.auction_mode == 'mega' and is_foreign:
                                    if room.players[winner_id].get('foreign_count', 0) >= room.max_foreign_players:
                                        await ws.send_json({
                                            'type': 'error',
                                            'message': 'Foreign player limit reached (8 max)'
                                        })
                                        continue
                                
                                # Check max players limit
                                if len(room.players[winner_id]['players']) >= room.max_players_per_team:
                                    await ws.send_json({
                                        'type': 'error',
                                        'message': f'Max {room.max_players_per_team} players limit reached'
                                    })
                                    continue
                                
                                room.players[winner_id]['purse'] -= final_price
                                # Add final price to player data before storing
                                player_data['soldPrice'] = final_price
                                room.players[winner_id]['players'].append(player_data)
                                winner_name = room.players[winner_id]['name']
                                
                                # Increment foreign count if foreign player
                                if is_foreign:
                                    room.players[winner_id]['foreign_count'] = room.players[winner_id].get('foreign_count', 0) + 1
                                
                                # Add to sold players list
                                room.auction_state['sold_players'].append({
                                    'name': player_data['name'],
                                    'price': final_price,
                                    'winner': winner_name,
                                    'winner_team': room.players[winner_id]['team'],
                                    'role': player_data['role']
                                })
                            else:
                                # No bids - mark as UNSOLD
                                room.auction_state['unsold_players'].append({
                                    'name': player_data['name'],
                                    'basePrice': player_data.get('basePrice', 0),
                                    'role': player_data['role']
                                })
                                winner_name = 'UNSOLD'
                                final_price = 0  # No price paid for unsold players
                            
                            # Move to next player
                            room.auction_state['current_player_idx'] += 1
                            room.auction_state['bid_history'] = []
                            room.auction_state['current_bidder_id'] = None
                            room.auction_state['time_left'] = room.timer_duration
                            
                            if room.auction_state['current_player_idx'] < len(room.auction_state['auction_queue']):
                                next_player = room.auction_state['auction_queue'][room.auction_state['current_player_idx']]
                                room.auction_state['current_bid'] = next_player['basePrice']
                            else:
                                room.auction_state['status'] = 'ended'
                            
                            await broadcast_to_room(room_code, {
                                'type': 'player_sold',
                                'winner_name': winner_name,
                                'final_price': final_price,
                                'player_name': player_data['name'],
                                'room_data': room.to_dict()
                            })
                
                elif action == 'timer_tick':
                    if room_code and room_code in rooms:
                        room = rooms[room_code]
                        if room.auction_state['status'] == 'active':
                            room.auction_state['time_left'] = data['time_left']
                            
                            await broadcast_to_room(room_code, {
                                'type': 'timer_update',
                                'time_left': data['time_left']
                            }, exclude_id=player_id)
                            
            except Exception as e:
                print(f"Error: {e}")
                await ws.send_json({'type': 'error', 'message': str(e)})
        
        elif msg.type == web.WSMsgType.ERROR:
            print(f'WebSocket error: {ws.exception()}')
    
    # Clean up on disconnect - just remove websocket, keep player data
    # This allows reconnection during page navigation
    if room_code and room_code in rooms and player_id:
        room = rooms[room_code]
        if player_id in room.websockets:
            del room.websockets[player_id]
            print(f"Player {player_id} websocket disconnected from room {room_code}")
    
    return ws

async def broadcast_to_room(room_code, message, exclude_id=None):
    if room_code not in rooms:
        return
    
    room = rooms[room_code]
    for pid, ws in room.websockets.items():
        if exclude_id and pid == exclude_id:
            continue
        try:
            await ws.send_json(message)
        except:
            pass

async def serve_static(request):
    path = request.match_info.get('path', 'index.html')
    if path == '':
        path = 'index.html'
    
    try:
        return web.FileResponse(f'./{path}')
    except:
        return web.Response(status=404, text='Not found')

app = web.Application()

# Configure CORS
cors = aiohttp_cors.setup(app, defaults={
    "*": aiohttp_cors.ResourceOptions(
        allow_credentials=True,
        expose_headers="*",
        allow_headers="*",
        allow_methods="*"
    )
})

app.router.add_get('/ws', handle_websocket)
app.router.add_get('/{path:.*}', serve_static)

# Add CORS to all routes
for route in list(app.router.routes()):
    cors.add(route)

if __name__ == '__main__':
    print("IPL Auction Server starting on http://localhost:8080")
    web.run_app(app, host='0.0.0.0', port=8080)
