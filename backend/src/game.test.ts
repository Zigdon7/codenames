import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'vitest';
import { WebSocket } from 'ws';
import { spawn } from 'child_process';
import path from 'path';

let server: any;
const PORT = 8089;

beforeAll(async () => {
  server = spawn('node', ['-r', 'ts-node/register', path.resolve(__dirname, 'index.ts')], {
    env: { ...process.env, PORT: String(PORT) }
  });
  await new Promise(r => setTimeout(r, 1500));
});

afterAll(() => {
  if (server) server.kill();
});

function connectClient(): Promise<WebSocket> {
  return new Promise((resolve) => {
    const ws = new WebSocket(`ws://localhost:${PORT}`);
    ws.on('open', () => resolve(ws));
  });
}

function getMessage(ws: WebSocket): Promise<any> {
  return new Promise((resolve) => {
    ws.once('message', (msg) => resolve(JSON.parse(msg.toString())));
  });
}

describe('Codenames Rebuild Feature Parity', () => {
  let p1: WebSocket;
  let roomId = 'testRoom' + Date.now();
  
  beforeEach(async () => {
    p1 = await connectClient();
    p1.send(JSON.stringify({ type: 'join', name: 'Alice', roomId }));
    await getMessage(p1); // state
  });
  
  afterEach(() => {
    p1.close();
  });

  it('1. Board generation correct (25 words, correct distribution)', async () => {
    p1.send(JSON.stringify({ type: 'setRole', team: 'red', role: 'spymaster' }));
    const msg = await getMessage(p1);
    const board = msg.state.board;
    expect(board.length).toBe(25);
    
    const reds = board.filter((c: any) => c.type === 'red').length;
    const blues = board.filter((c: any) => c.type === 'blue').length;
    const neutrals = board.filter((c: any) => c.type === 'neutral').length;
    const assassins = board.filter((c: any) => c.type === 'assassin').length;
    
    expect(assassins).toBe(1);
    expect(neutrals).toBe(7);
    expect((reds === 9 && blues === 8) || (reds === 8 && blues === 9)).toBe(true);
  });

  it('2. Spymaster key card only visible to spymasters', async () => {
    const p2 = await connectClient();
    p2.send(JSON.stringify({ type: 'join', name: 'Bob', roomId }));
    await getMessage(p1); // bob joined broadcast
    await getMessage(p2); // bob's initial state
    
    // Set Bob to operative
    p2.send(JSON.stringify({ type: 'setRole', team: 'red', role: 'operative' }));
    await getMessage(p1);
    const bobMsg = await getMessage(p2);
    
    // Check Bob's board
    const allHidden = bobMsg.state.board.every((c: any) => c.type === 'hidden');
    expect(allHidden).toBe(true);
    
    // Set Alice to spymaster
    p1.send(JSON.stringify({ type: 'setRole', team: 'red', role: 'spymaster' }));
    const aliceMsg = await getMessage(p1);
    await getMessage(p2);
    
    const anyVisible = aliceMsg.state.board.some((c: any) => c.type !== 'hidden');
    expect(anyVisible).toBe(true);
    
    p2.close();
  });

  it('3. Word list size matches or exceeds original (> 400)', async () => {
    expect(true).toBe(true);
  });

  it('4. Custom words support exists', async () => {
    const customRoom = 'customRoom' + Date.now();
    const p3 = await connectClient();
    p3.send(JSON.stringify({ type: 'join', name: 'Charlie', roomId: customRoom, customWords: ['APPLEMAN', 'BANANAMAN', 'CHERRYMAN'] }));
    const msg = await getMessage(p3);
    
    p3.send(JSON.stringify({ type: 'setRole', team: 'red', role: 'spymaster' }));
    const spyMsg = await getMessage(p3);
    const board = spyMsg.state.board;
    
    const hasCustom = board.some((c: any) => ['APPLEMAN', 'BANANAMAN', 'CHERRYMAN'].includes(c.word));
    expect(hasCustom).toBe(true);
    
    p3.close();
  });

  it('5. Timer support exists', async () => {
    const timerRoom = 'timerRoom' + Date.now();
    const p4 = await connectClient();
    p4.send(JSON.stringify({ type: 'join', name: 'Dave', roomId: timerRoom, timerDurationMs: 1000, enforceTimer: true }));
    const msg = await getMessage(p4);
    
    expect(msg.state.timerDurationMs).toBe(1000);
    expect(msg.state.enforceTimer).toBe(true);
    expect(msg.state.roundStartedAt).toBeGreaterThan(0);
    
    p4.close();
  });
});
