import express from 'express';
import http from 'http';
import { WebSocketServer, WebSocket } from 'ws';
// read large words array from json
import fs from 'fs';
import path from 'path';

let WORDS: string[] = [];
try {
  const wordsRaw = fs.readFileSync(path.join(__dirname, 'words.json'), 'utf8');
  const wordsObj = JSON.parse(wordsRaw);
  // English sets only — deduplicated
  const englishSets = ['English (Original)', 'English (Duet)', 'English (Deep Undercover) [MA]'];
  const allEnglish: string[] = [];
  for (const key of englishSets) {
    if (wordsObj[key]) allEnglish.push(...wordsObj[key]);
  }
  WORDS = [...new Set(allEnglish)];
} catch(e) {
  WORDS = ["APPLE", "BANANA", "ORANGE", "PEAR", "GRAPE", "MELON", "LEMON", "CHERRY", "PEACH", "PLUM", "KIWI", "MANGO", "FIG", "LIME", "DATE", "PINEAPPLE", "BERRY", "OLIVE", "BEAN", "CORN", "RICE", "WHEAT", "OAT", "RYE", "BARLEY"]; 
}

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

interface Card { id: number; word: string; type: 'red' | 'blue' | 'neutral' | 'assassin'; revealed: boolean; }
interface Player { id: string; name: string; ws: WebSocket; team: 'red' | 'blue' | null; role: 'spymaster' | 'operative' | null; }
interface GameState {
  roomId: string;
  players: Record<string, Player>;
  board: Card[];
  currentTurn: 'red' | 'blue';
  winner: 'red' | 'blue' | null;
  log: string[];
  redLeft: number;
  blueLeft: number;
  clue: { word: string; count: number } | null;
  timerDurationMs: number | null;
  enforceTimer: boolean;
  roundStartedAt: number;
  timerHandle?: NodeJS.Timeout | null;
}

const rooms: Record<string, GameState> = {};

function shuffle(array: any[]) { return array.sort(() => Math.random() - 0.5); }

function generateBoard(customWords: string[] = []): Card[] {
  // Combine custom words with normal words
  let availableWords = [...new Set([...customWords, ...WORDS])];
  if (availableWords.length < 25) {
     // pad with generic words just in case
     availableWords = [...availableWords, ...WORDS];
  }
  const chosenWords = shuffle(availableWords).slice(0, 25);
  const starter = Math.random() < 0.5 ? 'red' : 'blue';
  const types = [
    ...Array(starter === 'red' ? 9 : 8).fill('red'),
    ...Array(starter === 'blue' ? 9 : 8).fill('blue'),
    ...Array(7).fill('neutral'),
    'assassin'
  ];
  shuffle(types);
  return chosenWords.map((word, i) => ({ id: i, word, type: types[i], revealed: false }));
}

function createRoom(roomId: string, opts: any = {}) {
  const board = generateBoard(opts.customWords || []);
  const redCount = board.filter(c => c.type === 'red').length;
  rooms[roomId] = {
    roomId, players: {}, board,
    currentTurn: redCount === 9 ? 'red' : 'blue',
    winner: null, log: [], redLeft: redCount, blueLeft: board.filter(c => c.type === 'blue').length,
    clue: null,
    timerDurationMs: opts.timerDurationMs || null,
    enforceTimer: !!opts.enforceTimer,
    roundStartedAt: Date.now(),
    timerHandle: null
  };
  startTimer(roomId);
}

function startTimer(roomId: string) {
  const room = rooms[roomId];
  if (!room || !room.enforceTimer || !room.timerDurationMs) return;
  if (room.timerHandle) clearTimeout(room.timerHandle);
  
  room.timerHandle = setTimeout(() => {
    if (room.winner) return;
    room.currentTurn = room.currentTurn === 'red' ? 'blue' : 'red';
    room.clue = null;
    room.log.push(`Time's up! Turn passes to ${room.currentTurn.toUpperCase()}.`);
    room.roundStartedAt = Date.now();
    startTimer(roomId);
    broadcast(roomId);
  }, room.timerDurationMs);
}

function broadcast(roomId: string) {
  const room = rooms[roomId];
  if (!room) return;
  const stateToPlayers = Object.values(room.players).map(p => {
    const isSpymaster = p.role === 'spymaster';
    const board = room.board.map(c => ({
      ...c,
      type: (c.revealed || isSpymaster || room.winner) ? c.type : 'hidden'
    }));
    return {
      ws: p.ws,
      state: {
        roomId, currentTurn: room.currentTurn, winner: room.winner,
        redLeft: room.redLeft, blueLeft: room.blueLeft,
        clue: room.clue, log: room.log, board,
        timerDurationMs: room.timerDurationMs,
        enforceTimer: room.enforceTimer,
        roundStartedAt: room.roundStartedAt,
        players: Object.values(room.players).map(pl => ({ id: pl.id, name: pl.name, team: pl.team, role: pl.role })),
        me: { team: p.team, role: p.role }
      }
    };
  });
  
  stateToPlayers.forEach(({ ws, state }) => {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify({ type: 'state', state }));
    }
  });
}

wss.on('connection', (ws) => {
  let pId = Math.random().toString(36).slice(2, 9);
  let cRoom: string | null = null;

  ws.on('message', (msg) => {
    const data = JSON.parse(msg.toString());
    
    if (data.type === 'join') {
      cRoom = data.roomId;
      if (!rooms[cRoom!]) createRoom(cRoom!, {
          customWords: data.customWords,
          timerDurationMs: data.timerDurationMs,
          enforceTimer: data.enforceTimer
      });
      rooms[cRoom!].players[pId] = { id: pId, name: data.name, ws, team: null, role: null };
      rooms[cRoom!].log.push(`${data.name} joined.`);
      broadcast(cRoom!);
    }
    
    if (!cRoom || !rooms[cRoom]) return;
    const room = rooms[cRoom];
    const me = room.players[pId];

    if (data.type === 'setRole') {
      me.team = data.team; me.role = data.role;
      room.log.push(`${me.name} joined ${data.team} as ${data.role}.`);
      broadcast(cRoom);
    }
    
    if (data.type === 'giveClue' && me.team === room.currentTurn && me.role === 'spymaster' && !room.clue && !room.winner) {
      room.clue = { word: data.word, count: Number(data.count) };
      room.log.push(`[${me.team.toUpperCase()}] Clue: ${data.word} (${data.count})`);
      broadcast(cRoom);
    }
    
    if (data.type === 'guess' && me.team === room.currentTurn && me.role === 'operative' && room.clue && !room.winner) {
      const card = room.board.find(c => c.id === data.cardId);
      if (!card || card.revealed) return;
      
      card.revealed = true;
      room.log.push(`${me.name} guessed ${card.word}. It was ${card.type}.`);
      
      let passTurn = false;

      if (card.type === 'assassin') {
        room.winner = me.team === 'red' ? 'blue' : 'red';
        room.log.push(`Assassin revealed! ${room.winner.toUpperCase()} wins!`);
      } else if (card.type === me.team) {
        if (me.team === 'red') room.redLeft--; else room.blueLeft--;
        if (room.redLeft === 0 || room.blueLeft === 0) {
          room.winner = me.team;
          room.log.push(`${me.team.toUpperCase()} reveals all words and wins!`);
        }
      } else {
        if (card.type === (me.team === 'red' ? 'blue' : 'red')) {
          if (me.team === 'red') room.blueLeft--; else room.redLeft--;
          if (room.redLeft === 0 || room.blueLeft === 0) {
             room.winner = me.team === 'red' ? 'blue' : 'red';
             room.log.push(`${room.winner.toUpperCase()} wins by default!`);
          }
        }
        passTurn = true;
      }

      if (passTurn) {
        room.currentTurn = room.currentTurn === 'red' ? 'blue' : 'red';
        room.clue = null;
        room.roundStartedAt = Date.now();
        room.log.push(`Turn passes to ${room.currentTurn.toUpperCase()}.`);
        startTimer(cRoom);
      }
      broadcast(cRoom);
    }
    
    if (data.type === 'endTurn' && me.team === room.currentTurn && me.role === 'operative' && !room.winner) {
      room.currentTurn = room.currentTurn === 'red' ? 'blue' : 'red';
      room.clue = null;
      room.roundStartedAt = Date.now();
      room.log.push(`${me.name} ended the turn. Turn passes to ${room.currentTurn.toUpperCase()}.`);
      startTimer(cRoom);
      broadcast(cRoom);
    }
  });

  ws.on('close', () => {
    if (cRoom && rooms[cRoom]) {
      const name = rooms[cRoom].players[pId]?.name;
      delete rooms[cRoom].players[pId];
      if (name) rooms[cRoom].log.push(`${name} disconnected.`);
      broadcast(cRoom);
    }
  });
});

const PORT = process.env.PORT || 8080;
server.listen(PORT, () => console.log(`Server running on port ${PORT}`));

export { app, server, wss, createRoom, rooms, startTimer }; // export for tests
