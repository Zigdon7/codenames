import './style.css'

let ws: WebSocket;
let roomId = '';
let myName = '';
let myTeam: 'red' | 'blue' | null = null;
let myRole: 'spymaster' | 'operative' | null = null;
let state: any = null;
let customWords: string[] = [];
let timerDurationMs: number | null = null;
let enforceTimer = false;

const app = document.querySelector<HTMLDivElement>('#app')!

function connect() {
  ws = new WebSocket('ws://localhost:8080');
  ws.onopen = () => ws.send(JSON.stringify({ 
    type: 'join', name: myName, roomId, customWords, timerDurationMs, enforceTimer 
  }));
  ws.onmessage = (msg) => {
    const data = JSON.parse(msg.data);
    if (data.type === 'state') {
      state = data.state;
      myTeam = state.me.team;
      myRole = state.me.role;
      render();
    }
  };
}

function joinGame() {
  myName = (document.getElementById('name') as HTMLInputElement).value;
  roomId = (document.getElementById('room') as HTMLInputElement).value;
  
  const customStr = (document.getElementById('custom-words') as HTMLInputElement).value;
  customWords = customStr ? customStr.split(',').map(s => s.trim().toUpperCase()) : [];
  
  const timerSecs = Number((document.getElementById('timer-secs') as HTMLInputElement).value);
  if (timerSecs > 0) {
    timerDurationMs = timerSecs * 1000;
    enforceTimer = true;
  }
  
  if (!myName || !roomId) return alert("Enter name and room");
  connect();
}

function setRole(team: 'red'|'blue', role: 'spymaster'|'operative') {
  ws.send(JSON.stringify({ type: 'setRole', team, role }));
}

function giveClue() {
  const word = (document.getElementById('clue-word') as HTMLInputElement).value;
  const count = (document.getElementById('clue-count') as HTMLInputElement).value;
  if (!word || !count) return;
  ws.send(JSON.stringify({ type: 'giveClue', word, count }));
}

function guess(cardId: number) {
  if (myRole !== 'operative' || state.currentTurn !== myTeam || !state.clue || state.winner) return;
  ws.send(JSON.stringify({ type: 'guess', cardId }));
}

function endTurn() {
  if (myRole !== 'operative' || state.currentTurn !== myTeam || !state.winner) return;
  ws.send(JSON.stringify({ type: 'endTurn' }));
}

function render() {
  if (!state) {
    app.innerHTML = `
      <h1>Codenames</h1>
      <input id="name" placeholder="Your Name" />
      <input id="room" placeholder="Room ID" value="game1" />
      <br/><br/>
      <input id="custom-words" placeholder="Custom words (comma separated)" />
      <input id="timer-secs" type="number" placeholder="Timer seconds (e.g. 60)" />
      <button id="join-btn">Join</button>
    `;
    document.getElementById('join-btn')!.onclick = joinGame;
    return;
  }

  if (!myTeam || !myRole) {
    app.innerHTML = `
      <h2>Room: ${roomId}</h2>
      <div>
        <h3>Join Red</h3>
        <button id="red-spy">Spymaster</button> <button id="red-op">Operative</button>
      </div>
      <div>
        <h3>Join Blue</h3>
        <button id="blue-spy">Spymaster</button> <button id="blue-op">Operative</button>
      </div>
    `;
    document.getElementById('red-spy')!.onclick = () => setRole('red', 'spymaster');
    document.getElementById('red-op')!.onclick = () => setRole('red', 'operative');
    document.getElementById('blue-spy')!.onclick = () => setRole('blue', 'spymaster');
    document.getElementById('blue-op')!.onclick = () => setRole('blue', 'operative');
    return;
  }

  app.innerHTML = `
    <div class="status-bar">
      <div class="status-red">Red: ${state.redLeft} left</div>
      <div>Turn: <span class="status-${state.currentTurn}">${state.currentTurn.toUpperCase()}</span></div>
      <div class="status-blue">Blue: ${state.blueLeft} left</div>
      ${state.enforceTimer ? \`<div class="timer">Timer active...</div>\` : ''}
    </div>
    ${state.winner ? \`<h2>Winner: <span class="status-\${state.winner}">\${state.winner.toUpperCase()}</span></h2>\` : ''}
    ${state.clue ? \`<h3>Clue: \${state.clue.word} (\${state.clue.count})</h3>\` : ''}
    <div class="board">
      ${state.board.map((c: any) => `
        <div class="card type-${c.type} ${c.revealed ? 'revealed' : ''}" data-id="${c.id}">
          ${c.word}
        </div>
      `).join('')}
    </div>
    <div class="controls">
      ${myRole === 'spymaster' && myTeam === state.currentTurn && !state.clue && !state.winner ? `
        <input id="clue-word" placeholder="Clue word" />
        <input id="clue-count" type="number" min="1" max="9" placeholder="#" style="width: 50px;" />
        <button id="give-clue">Give Clue</button>
      ` : ''}
      ${myRole === 'operative' && myTeam === state.currentTurn && state.clue && !state.winner ? `
        <button id="end-turn">End Turn</button>
      ` : ''}
    </div>
    <div class="log">
      ${state.log.map((l: string) => `<div>${l}</div>`).join('')}
    </div>
  `;

  document.querySelectorAll('.card').forEach(el => {
    el.addEventListener('click', (e) => {
      guess(Number((e.target as HTMLElement).dataset.id));
    });
  });

  const giveBtn = document.getElementById('give-clue');
  if (giveBtn) giveBtn.onclick = giveClue;
  
  const endBtn = document.getElementById('end-turn');
  if (endBtn) endBtn.onclick = endTurn;
}

render();
