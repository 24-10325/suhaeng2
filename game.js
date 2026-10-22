/* ============================================================
   MINESWEEPER GAME LOGIC
   Features:
   - Chord on single left-click (if adjacent flags == cell number)
   - Normal mode (infinite time) + Time Attack mode (10/40/100s)
   - Hint system: opens one random adjacent covered cell
     Normal  mode → +10s penalty
     TimeAttack   → -10s penalty
   - First-click safety (never mines on first click)
   ============================================================ */

'use strict';

// ── Config ────────────────────────────────────────────────────
const LEVELS = {
  easy:   { rows: 9,  cols: 9,  mines: 10 },
  medium: { rows: 16, cols: 16, mines: 40 },
  hard:   { rows: 16, cols: 30, mines: 99 },
};

const TIME_LIMITS = { easy: 10, medium: 40, hard: 100 };

// ── State ─────────────────────────────────────────────────────
let state = {};

function initState() {
  state = {
    rows: 0,
    cols: 0,
    mines: 0,
    mode: 'normal',      // 'normal' | 'timeattack'
    level: 'easy',
    grid: [],            // 2D array of cell objects
    mineSet: new Set(),  // string 'r,c'
    gameStatus: 'idle',  // 'idle' | 'playing' | 'won' | 'lost'
    firstClick: true,
    timerValue: 0,       // normal: elapsed (counts up), timeattack: remaining (counts down)
    timerInterval: null,
    hintCount: 0,
    timeLimit: 0,
  };
}

// ── DOM References ─────────────────────────────────────────────
const $ = id => document.getElementById(id);
const modeSection    = $('modeSection');
const gameSection    = $('gameSection');
const resultOverlay  = $('resultOverlay');
const boardEl        = $('board');
const mineCountEl    = $('mineCount');
const timerDisplayEl = $('timerDisplay');
const resetBtn       = $('resetBtn');
const resetEmoji     = $('resetEmoji');
const backBtn        = $('backBtn');
const hintBtn        = $('hintBtn');
const hintPenalty    = $('hintPenalty');
const gameInfoBadge  = $('gameInfoBadge');
const taProgressFill = $('taProgressFill');
const taTimeDisplay  = $('taTimeDisplay');
const timeAttackBar  = $('timeAttackBar');
const timerBlock     = $('timerBlock');
const resultEmoji    = $('resultEmoji');
const resultTitle    = $('resultTitle');
const resultSubtitle = $('resultSubtitle');
const resultTime     = $('resultTime');
const resultHints    = $('resultHints');

// ── Navigation ─────────────────────────────────────────────────
document.querySelectorAll('.diff-btn').forEach(btn => {
  btn.addEventListener('click', () => {
    const mode  = btn.dataset.mode;
    const level = btn.dataset.level;
    startGame(mode, level);
  });
});

backBtn.addEventListener('click', goToMenu);
$('resultRetry').addEventListener('click', () => {
  resultOverlay.classList.add('hidden');
  startGame(state.mode, state.level);
});
$('resultMenu').addEventListener('click', () => {
  resultOverlay.classList.add('hidden');
  goToMenu();
});
resetBtn.addEventListener('click', () => startGame(state.mode, state.level));
hintBtn.addEventListener('click', useHint);

function goToMenu() {
  stopTimer();
  modeSection.classList.remove('hidden');
  gameSection.classList.add('hidden');
}

// ── Start Game ─────────────────────────────────────────────────
function startGame(mode, level) {
  initState();
  stopTimer();

  const cfg = LEVELS[level];
  state.rows  = cfg.rows;
  state.cols  = cfg.cols;
  state.mines = cfg.mines;
  state.mode  = mode;
  state.level = level;

  if (mode === 'timeattack') {
    state.timeLimit  = TIME_LIMITS[level];
    state.timerValue = state.timeLimit;
  }

  // UI
  modeSection.classList.add('hidden');
  gameSection.classList.remove('hidden');
  resultOverlay.classList.add('hidden');

  const levelNames = { easy: '초급', medium: '중급', hard: '상급' };
  const modeLabel  = mode === 'timeattack' ? '⚡ 타임어택' : '🎯 일반';
  gameInfoBadge.textContent = `${modeLabel} · ${levelNames[level]}`;

  if (mode === 'timeattack') {
    timeAttackBar.classList.remove('hidden');
    timerBlock.classList.add('hidden');
    hintPenalty.textContent = '(-10초)';
    updateTABar();
  } else {
    timeAttackBar.classList.add('hidden');
    timerBlock.classList.remove('hidden');
    hintPenalty.textContent = '(+10초)';
  }

  updateMineCount();
  resetEmoji.textContent = '😊';
  state.hintCount = 0;

  buildBoard();
}

// ── Board Construction ─────────────────────────────────────────
function buildBoard() {
  boardEl.innerHTML = '';
  boardEl.style.gridTemplateColumns = `repeat(${state.cols}, var(--cell-size))`;

  state.grid = [];
  for (let r = 0; r < state.rows; r++) {
    state.grid[r] = [];
    for (let c = 0; c < state.cols; c++) {
      const cell = {
        r, c,
        isMine: false,
        revealed: false,
        flagged: false,
        adjacentMines: 0,
        el: null,
      };

      const el = document.createElement('div');
      el.className = 'cell covered';
      el.dataset.r = r;
      el.dataset.c = c;

      el.addEventListener('click',       () => handleLeftClick(r, c));
      el.addEventListener('contextmenu', e => { e.preventDefault(); handleRightClick(r, c); });

      cell.el = el;
      state.grid[r][c] = cell;
      boardEl.appendChild(el);
    }
  }

  if (state.mode === 'normal') {
    timerDisplayEl.textContent = '0';
  } else {
    taTimeDisplay.textContent = state.timerValue;
  }
}

// ── Mine Placement (deferred to first click) ───────────────────
function placeMines(safeR, safeC) {
  const excluded = new Set();
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      const nr = safeR + dr, nc = safeC + dc;
      if (nr >= 0 && nr < state.rows && nc >= 0 && nc < state.cols) {
        excluded.add(`${nr},${nc}`);
      }
    }
  }

  const candidates = [];
  for (let r = 0; r < state.rows; r++)
    for (let c = 0; c < state.cols; c++)
      if (!excluded.has(`${r},${c}`))
        candidates.push([r, c]);

  shuffle(candidates);
  for (let i = 0; i < state.mines; i++) {
    const [r, c] = candidates[i];
    state.grid[r][c].isMine = true;
    state.mineSet.add(`${r},${c}`);
  }

  // Compute adjacent counts
  for (let r = 0; r < state.rows; r++) {
    for (let c = 0; c < state.cols; c++) {
      if (!state.grid[r][c].isMine) {
        state.grid[r][c].adjacentMines = countAdjMines(r, c);
      }
    }
  }
}

function countAdjMines(r, c) {
  let count = 0;
  forEachNeighbor(r, c, (nr, nc) => {
    if (state.grid[nr][nc].isMine) count++;
  });
  return count;
}

// ── Click Handlers ─────────────────────────────────────────────
function handleLeftClick(r, c) {
  if (state.gameStatus === 'won' || state.gameStatus === 'lost') return;

  const cell = state.grid[r][c];
  if (cell.flagged) return;

  // First click: place mines, start timer
  if (state.firstClick) {
    state.firstClick = false;
    state.gameStatus = 'playing';
    placeMines(r, c);
    startTimer();
  }

  if (cell.revealed) {
    // Chord attempt on revealed numbered cell
    tryChord(r, c);
    return;
  }

  revealCell(r, c);
  checkWin();
}

function handleRightClick(r, c) {
  if (state.gameStatus === 'won' || state.gameStatus === 'lost') return;
  if (state.gameStatus === 'idle') return;

  const cell = state.grid[r][c];
  if (cell.revealed) return;

  cell.flagged = !cell.flagged;
  renderCell(cell);
  updateMineCount();
}

// ── Chord ──────────────────────────────────────────────────────
// Chord: if the cell is revealed, has a number, and adjacent flag count
// equals that number → reveal all adjacent non-flagged covered cells.
function tryChord(r, c) {
  const cell = state.grid[r][c];
  if (!cell.revealed || cell.adjacentMines === 0) return;

  let flagCount = 0;
  forEachNeighbor(r, c, (nr, nc) => {
    if (state.grid[nr][nc].flagged) flagCount++;
  });

  if (flagCount !== cell.adjacentMines) return;

  // Reveal all non-flagged, non-revealed neighbors
  let hitMine = false;
  const toReveal = [];
  forEachNeighbor(r, c, (nr, nc) => {
    const nb = state.grid[nr][nc];
    if (!nb.revealed && !nb.flagged) {
      toReveal.push(nb);
    }
  });

  toReveal.forEach(nb => {
    if (nb.isMine) {
      hitMine = true;
      nb.el.classList.add('mine-hit');
    } else {
      revealCell(nb.r, nb.c, true /* chordPop */);
    }
  });

  if (hitMine) {
    endGame(false);
  } else {
    checkWin();
  }
}

// ── Reveal ─────────────────────────────────────────────────────
function revealCell(r, c, chordAnim = false) {
  const cell = state.grid[r][c];
  if (cell.revealed || cell.flagged) return;

  cell.revealed = true;

  if (cell.isMine) {
    cell.el.classList.remove('covered');
    cell.el.classList.add('mine-hit');
    endGame(false);
    return;
  }

  renderCell(cell, chordAnim);

  // Flood-fill for empty cells
  if (cell.adjacentMines === 0) {
    forEachNeighbor(r, c, (nr, nc) => revealCell(nr, nc));
  }
}

// ── Render Cell ────────────────────────────────────────────────
function renderCell(cell, chordAnim = false) {
  const el = cell.el;
  el.className = 'cell';

  if (cell.revealed) {
    el.classList.add('revealed');
    if (cell.adjacentMines > 0) {
      el.textContent = cell.adjacentMines;
      el.dataset.num = cell.adjacentMines;
    } else {
      el.textContent = '';
      delete el.dataset.num;
    }
    if (chordAnim) el.classList.add('chord-pop');
  } else if (cell.flagged) {
    el.classList.add('flagged');
    el.textContent = '🚩';
  } else {
    el.classList.add('covered');
    el.textContent = '';
    delete el.dataset.num;
  }
}

// ── Win Check ──────────────────────────────────────────────────
function checkWin() {
  for (let r = 0; r < state.rows; r++) {
    for (let c = 0; c < state.cols; c++) {
      const cell = state.grid[r][c];
      if (!cell.isMine && !cell.revealed) return;
    }
  }
  endGame(true);
}

// ── End Game ───────────────────────────────────────────────────
function endGame(won) {
  stopTimer();
  state.gameStatus = won ? 'won' : 'lost';
  resetEmoji.textContent = won ? '😎' : '😵';

  if (!won) {
    // Reveal all mines
    for (let r = 0; r < state.rows; r++) {
      for (let c = 0; c < state.cols; c++) {
        const cell = state.grid[r][c];
        if (cell.isMine && !cell.flagged) {
          cell.el.className = 'cell mine-revealed';
          cell.el.textContent = '💣';
        }
      }
    }
  }

  setTimeout(() => showResult(won), won ? 600 : 800);
}

function showResult(won) {
  const levelNames = { easy: '초급', medium: '중급', hard: '상급' };

  if (won) {
    resultEmoji.textContent = '🎉';
    resultTitle.textContent = '클리어!';
    if (state.mode === 'timeattack') {
      const remaining = state.timerValue;
      resultSubtitle.textContent = `타임어택 성공! ${remaining}초 남았습니다.`;
    } else {
      resultSubtitle.textContent = `${levelNames[state.level]} 모드를 클리어했습니다!`;
    }
  } else {
    if (state.mode === 'timeattack' && state.timerValue <= 0) {
      resultEmoji.textContent = '⏰';
      resultTitle.textContent = '시간 초과!';
      resultSubtitle.textContent = '제한 시간 안에 클리어하지 못했습니다.';
    } else {
      resultEmoji.textContent = '💥';
      resultTitle.textContent = '지뢰 폭발!';
      resultSubtitle.textContent = '지뢰를 밟았습니다. 다시 도전해보세요!';
    }
  }

  const elapsed = state.mode === 'normal'
    ? state.timerValue
    : (state.timeLimit - state.timerValue);
  resultTime.textContent  = `${elapsed}초`;
  resultHints.textContent = `${state.hintCount}회`;

  resultOverlay.classList.remove('hidden');
}

// ── Hint ───────────────────────────────────────────────────────
function useHint() {
  if (state.gameStatus !== 'playing') return;

  // Collect: covered, non-flagged, non-mine cells adjacent to a revealed cell
  const candidates = [];
  for (let r = 0; r < state.rows; r++) {
    for (let c = 0; c < state.cols; c++) {
      const cell = state.grid[r][c];
      if (cell.revealed) {
        forEachNeighbor(r, c, (nr, nc) => {
          const nb = state.grid[nr][nc];
          if (!nb.revealed && !nb.flagged && !nb.isMine) {
            const key = `${nr},${nc}`;
            if (!candidates.find(k => k === key)) candidates.push(key);
          }
        });
      }
    }
  }

  if (candidates.length === 0) return; // Nothing useful to reveal

  // Pick random candidate
  const key = candidates[Math.floor(Math.random() * candidates.length)];
  const [r, c] = key.split(',').map(Number);

  state.hintCount++;
  revealCell(r, c);

  // Add hint animation
  state.grid[r][c].el.classList.add('hint-open');
  setTimeout(() => state.grid[r][c].el.classList.remove('hint-open'), 700);

  // Apply time penalty
  if (state.mode === 'normal') {
    state.timerValue += 10;
    timerDisplayEl.textContent = state.timerValue;
    flashTimer(timerBlock, 'timer-gain');
  } else {
    state.timerValue = Math.max(0, state.timerValue - 10);
    updateTABar();
    flashTimer(taTimeDisplay.parentElement.parentElement, 'timer-flash');
    if (state.timerValue <= 0) {
      endGame(false);
    }
  }

  checkWin();
}

// ── Timer ──────────────────────────────────────────────────────
function startTimer() {
  stopTimer();
  state.timerInterval = setInterval(() => {
    if (state.mode === 'normal') {
      state.timerValue++;
      timerDisplayEl.textContent = state.timerValue;
    } else {
      state.timerValue--;
      updateTABar();
      if (state.timerValue <= 0) {
        state.timerValue = 0;
        updateTABar();
        endGame(false);
      }
    }
  }, 1000);
}

function stopTimer() {
  if (state.timerInterval) {
    clearInterval(state.timerInterval);
    state.timerInterval = null;
  }
}

function updateTABar() {
  const pct = state.timerValue / state.timeLimit;
  taProgressFill.style.width = `${pct * 100}%`;
  taTimeDisplay.textContent  = state.timerValue;

  taProgressFill.classList.remove('warning', 'danger');
  if (pct <= 0.25) taProgressFill.classList.add('danger');
  else if (pct <= 0.5) taProgressFill.classList.add('warning');
}

function flashTimer(el, cls) {
  el.classList.remove(cls);
  void el.offsetWidth; // reflow to restart animation
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), 600);
}

// ── Mine Count Display ─────────────────────────────────────────
function updateMineCount() {
  let flags = 0;
  for (let r = 0; r < state.rows; r++)
    for (let c = 0; c < state.cols; c++)
      if (state.grid[r][c].flagged) flags++;
  mineCountEl.textContent = state.mines - flags;
}

// ── Utilities ──────────────────────────────────────────────────
function forEachNeighbor(r, c, fn) {
  for (let dr = -1; dr <= 1; dr++) {
    for (let dc = -1; dc <= 1; dc++) {
      if (dr === 0 && dc === 0) continue;
      const nr = r + dr, nc = c + dc;
      if (nr >= 0 && nr < state.rows && nc >= 0 && nc < state.cols) {
        fn(nr, nc);
      }
    }
  }
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
}

// ── Prevent default context menu on board ─────────────────────
boardEl.addEventListener('contextmenu', e => e.preventDefault());

// ── Chord hover highlight ──────────────────────────────────────
// When hovering a revealed numbered cell whose flag-count matches,
// highlight it to signal chord is ready.
boardEl.addEventListener('mouseover', e => {
  const el = e.target.closest('.cell');
  if (!el) return;
  const r = +el.dataset.r, c = +el.dataset.c;
  const cell = state.grid?.[r]?.[c];
  if (!cell || !cell.revealed || cell.adjacentMines === 0) return;

  let flags = 0;
  forEachNeighbor(r, c, (nr, nc) => {
    if (state.grid[nr][nc].flagged) flags++;
  });
  if (flags === cell.adjacentMines) {
    el.classList.add('chord-ready');
  }
});

boardEl.addEventListener('mouseout', e => {
  const el = e.target.closest('.cell');
  if (el) el.classList.remove('chord-ready');
});

// ── Init ───────────────────────────────────────────────────────
initState();
