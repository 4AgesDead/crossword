/* ============================================================
   Кроссворд «Учёба и наука» — интерактивная логика
   ============================================================ */

(() => {
  'use strict';

  const PUZZLE = window.PUZZLE;
  if (!PUZZLE) {
    console.error('Не найден файл puzzle.js — сетка кроссворда не загружена.');
    return;
  }

  const DIRS = {
    across: { dr: 0, dc: 1, label: 'По горизонтали', arrow: '→' },
    down: { dr: 1, dc: 0, label: 'По вертикали', arrow: '↓' },
  };
  const OTHER = { across: 'down', down: 'across' };
  const STORAGE_KEY = 'crossword-study-science-v1';
  const PUZZLE_SIGNATURE = (() => {
    const source = JSON.stringify(
      PUZZLE.words.map((word) => [
        word.answer,
        word.row,
        word.col,
        word.dir,
        word.number,
      ])
    );
    let hash = 2166136261;
    for (let i = 0; i < source.length; i += 1) {
      hash ^= source.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    return (hash >>> 0).toString(16);
  })();

  const $ = (selector) => document.querySelector(selector);
  const keyOf = (row, col) => `${row},${col}`;

  const els = {
    statProgress: $('#statProgress'),
    statTime: $('#statTime'),
    statWords: $('#statWords'),
    statWordTotal: $('#statWordTotal'),
    currentClue: $('#currentClue'),
    clueDirection: $('#clueDirection'),
    clueNumber: $('#clueNumber'),
    clueType: $('#clueType'),
    clueText: $('#clueText'),
    prevWord: $('#prevWord'),
    nextWord: $('#nextWord'),
    gridScroller: $('#gridScroller'),
    gridWrap: $('.grid-wrap'),
    grid: $('#grid'),
    cluesPanel: $('.clues'),
    progressBar: $('#progressBar'),
    progressFill: $('#progressFill'),
    progressLabel: $('#progressLabel'),
    checkBtn: $('#checkBtn'),
    hintBtn: $('#hintBtn'),
    revealWordBtn: $('#revealWordBtn'),
    revealAllBtn: $('#revealAllBtn'),
    resetBtn: $('#resetBtn'),
    zoomOut: $('#zoomOut'),
    zoomIn: $('#zoomIn'),
    acrossList: $('#acrossList'),
    downList: $('#downList'),
    winDialog: $('#winDialog'),
    winText: $('#winText'),
    winTime: $('#winTime'),
    winHints: $('#winHints'),
    winRestart: $('#winRestart'),
    winClose: $('#winClose'),
    confetti: $('#confetti'),
    toast: $('#toast'),
  };

  /** @type {Map<string, any>} */
  const cells = new Map();
  /** @type {any[]} */
  let allWords = [];
  /** @type {any[]} */
  let orderedWords = [];

  const state = {
    active: null, // { row, col }
    dir: 'across',
    started: false,
    elapsed: 0,
    hints: 0,
    solved: false,
    timerId: 0,
    zoom: 1,
    baseCell: 30,
  };

  let toastTimer = 0;

  /* ------------------------------------------------------------
     Модель
     ------------------------------------------------------------ */

  function buildModel() {
    const sorted = [...PUZZLE.words].sort(
      (a, b) => a.number - b.number || (a.dir === 'across' ? -1 : 1)
    );

    allWords = sorted.map((source, index) => {
      const meta = DIRS[source.dir];
      const word = {
        ...source,
        id: index,
        cells: Array.from({ length: source.answer.length }, (_, i) => ({
          row: source.row + meta.dr * i,
          col: source.col + meta.dc * i,
        })),
      };

      word.cells.forEach((position, i) => {
        const key = keyOf(position.row, position.col);
        let cell = cells.get(key);
        if (!cell) {
          cell = {
            row: position.row,
            col: position.col,
            solution: source.answer[i],
            number: null,
            words: {},
            el: null,
            input: null,
          };
          cells.set(key, cell);
        }
        cell.words[word.dir] = word;
        if (i === 0 && cell.number == null) {
          cell.number = word.number;
        }
      });

      return word;
    });

    orderedWords = [...allWords];
  }

  const cellAt = (row, col) => cells.get(keyOf(row, col));
  const valueOf = (cell) => (cell && cell.input ? cell.input.value.toUpperCase() : '');

  function activeCell() {
    return state.active ? cellAt(state.active.row, state.active.col) : null;
  }

  function activeWord() {
    const cell = activeCell();
    if (!cell) return null;
    return cell.words[state.dir] || null;
  }

  /* ------------------------------------------------------------
     Отрисовка сетки и вопросов
     ------------------------------------------------------------ */

  function buildGrid() {
    const fragment = document.createDocumentFragment();
    const height = PUZZLE.height;
    const width = PUZZLE.width;

    for (let row = 0; row < height; row += 1) {
      for (let col = 0; col < width; col += 1) {
        const cell = cellAt(row, col);
        const el = document.createElement('div');
        el.className = 'cell';
        el.dataset.row = String(row);
        el.dataset.col = String(col);

        if (!cell) {
          el.classList.add('cell--blank');
          fragment.appendChild(el);
          continue;
        }

        if (!cellAt(row - 1, col)) el.classList.add('edge-t');
        if (!cellAt(row + 1, col)) el.classList.add('edge-b');
        if (!cellAt(row, col - 1)) el.classList.add('edge-l');
        if (!cellAt(row, col + 1)) el.classList.add('edge-r');

        if (cell.number != null) {
          const number = document.createElement('span');
          number.className = 'cell__num';
          number.textContent = cell.number;
          number.setAttribute('aria-hidden', 'true');
          el.appendChild(number);
        }

        const input = document.createElement('input');
        input.type = 'text';
        input.maxLength = 1;
        input.dataset.row = String(row);
        input.dataset.col = String(col);
        input.autocomplete = 'off';
        input.autocapitalize = 'characters';
        input.spellcheck = false;
        input.inputMode = 'text';
        input.setAttribute(
          'aria-label',
          `${cell.number != null ? 'Слово ' + cell.number + '. ' : ''}Строка ${row + 1}, столбец ${col + 1}`
        );

        el.appendChild(input);
        cell.el = el;
        cell.input = input;
        bindCell(cell);
        fragment.appendChild(el);
      }
    }

    els.grid.style.setProperty('--cols', String(width));
    els.grid.appendChild(fragment);
  }

  function buildClues() {
    const acrossWords = allWords.filter((word) => word.dir === 'across');
    const downWords = allWords.filter((word) => word.dir === 'down');

    renderClueList(els.acrossList, acrossWords);
    renderClueList(els.downList, downWords);
  }

  function renderClueList(listElement, words) {
    const fragment = document.createDocumentFragment();

    words.forEach((word) => {
      const item = document.createElement('li');
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'clue';
      button.dataset.word = String(word.id);

      const number = document.createElement('span');
      number.className = 'clue__num';
      number.textContent = word.number;

      const text = document.createElement('span');
      text.className = 'clue__text';
      text.textContent = word.clue;

      button.append(number, text);
      button.addEventListener('click', () => {
        selectWord(word, { focus: true, fromClue: true });
      });

      item.appendChild(button);
      fragment.appendChild(item);
      word.clueButton = button;
    });

    listElement.appendChild(fragment);
  }

  /* ------------------------------------------------------------
     Выделение и навигация
     ------------------------------------------------------------ */

  function selectCell(row, col, preferredDir, options = {}) {
    const cell = cellAt(row, col);
    if (!cell) return;

    let dir = preferredDir || state.dir;
    if (!dir || !cell.words[dir]) {
      if (cell.words[state.dir]) dir = state.dir;
      else dir = cell.words.across ? 'across' : 'down';
    }

    state.dir = dir;
    state.active = { row, col };

    refreshHighlights();
    updateCurrentClue();

    if (options.focus !== false) {
      cell.input.focus({ preventScroll: true });
      if (options.select !== false) cell.input.select();
    }

    if (options.scroll) {
      cell.el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  function selectWord(word, options = {}) {
    if (!word) return;
    const target =
      word.cells.find((position) => !valueOf(cellAt(position.row, position.col))) ||
      word.cells[0];

    selectCell(target.row, target.col, word.dir, {
      focus: options.focus !== false,
      scroll: true,
    });

    if (options.fromClue && window.matchMedia('(max-width: 1080px)').matches) {
      els.currentClue.scrollIntoView({ behavior: 'smooth', block: 'center' });
    }
  }

  function stepWord(delta) {
    if (!orderedWords.length) return;
    const current = activeWord();
    let index = current ? orderedWords.indexOf(current) : -1;

    if (index === -1) {
      index = delta > 0 ? 0 : orderedWords.length - 1;
    } else {
      index = (index + delta + orderedWords.length) % orderedWords.length;
    }

    selectWord(orderedWords[index], { focus: true });
  }

  function toggleDirection() {
    if (!state.active) {
      selectWord(orderedWords[0], { focus: false });
      return;
    }
    const cell = activeCell();
    const alt = OTHER[state.dir];
    if (cell && cell.words[alt]) {
      state.dir = alt;
      refreshHighlights();
      updateCurrentClue();
      if (document.activeElement !== cell.input) {
        cell.input.focus({ preventScroll: true });
      }
      cell.input.select();
    }
  }

  function refreshHighlights() {
    for (const cell of cells.values()) {
      cell.el.classList.remove('is-word', 'is-active');
    }
    for (const word of allWords) {
      if (word.clueButton) word.clueButton.classList.remove('is-active');
    }

    const cell = activeCell();
    if (!cell) return;

    const word = cell.words[state.dir] || null;
    if (word) {
      for (const position of word.cells) {
        const wordCell = cellAt(position.row, position.col);
        if (wordCell) wordCell.el.classList.add('is-word');
      }
      if (word.clueButton) {
        word.clueButton.classList.add('is-active');
        revealClueInPanel(word.clueButton);
      }
    }

    cell.el.classList.add('is-active');
  }

  function updateCurrentClue() {
    const word = activeWord();

    if (!word) {
      els.clueDirection.textContent = '→';
      els.clueNumber.textContent = '·';
      els.clueType.textContent = 'Кроссворд';
      els.clueText.textContent = 'Выберите слово в сетке или в списке вопросов';
      return;
    }

    els.clueDirection.textContent = DIRS[word.dir].arrow;
    els.clueNumber.textContent = word.number;
    els.clueType.textContent = DIRS[word.dir].label;
    els.clueText.textContent = word.clue;
  }

  function revealClueInPanel(button) {
    const panel = els.cluesPanel;
    if (!panel || panel.scrollHeight <= panel.clientHeight + 2) return;

    const panelRect = panel.getBoundingClientRect();
    const buttonRect = button.getBoundingClientRect();
    const margin = 12;

    if (buttonRect.top < panelRect.top + margin) {
      panel.scrollTop -= panelRect.top + margin - buttonRect.top;
    } else if (buttonRect.bottom > panelRect.bottom - margin) {
      panel.scrollTop += buttonRect.bottom - (panelRect.bottom - margin);
    }
  }

  function moveBy(dr, dc) {
    if (!state.active) return;

    const current = activeCell();
    const axisDir = dr !== 0 ? 'down' : 'across';
    const target = cellAt(state.active.row + dr, state.active.col + dc);

    if (target) {
      const dir = target.words[axisDir]
        ? axisDir
        : target.words[state.dir]
          ? state.dir
          : target.words.across
            ? 'across'
            : 'down';
      selectCell(target.row, target.col, dir, { scroll: true });
      return;
    }

    // У края сетки стрелка переключает направление, если есть пересечение.
    if (current && current.words[axisDir]) {
      state.dir = axisDir;
      refreshHighlights();
      updateCurrentClue();
    }
  }

  function moveWithinWord(delta) {
    const word = activeWord();
    if (!word) return;

    const index = word.cells.findIndex(
      (position) => position.row === state.active.row && position.col === state.active.col
    );
    const target = word.cells[index + delta];
    if (target) {
      selectCell(target.row, target.col, word.dir, {
        focus: true,
        scroll: true,
      });
    }
  }

  function jumpInWord(edge) {
    const word = activeWord();
    if (!word) return;
    const target = edge === 0 ? word.cells[0] : word.cells[word.cells.length - 1];
    selectCell(target.row, target.col, word.dir, { focus: true, scroll: true });
  }

  /* ------------------------------------------------------------
     Ввод
     ------------------------------------------------------------ */

  function bindCell(cell) {
    const { el, input } = cell;

    el.addEventListener('pointerdown', (event) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return;
      handleCellPress(cell);
    });

    el.addEventListener('click', () => {
      if (document.activeElement !== input) {
        input.focus({ preventScroll: true });
      }
      input.select();
      cell.el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    });

    input.addEventListener('focus', () => {
      if (
        !state.active ||
        state.active.row !== cell.row ||
        state.active.col !== cell.col
      ) {
        selectCell(cell.row, cell.col, state.dir, { focus: false });
      }
      window.requestAnimationFrame(() => {
        if (document.activeElement === input) input.select();
      });
    });

    input.addEventListener('keydown', (event) => onKeyDown(event, cell));
    input.addEventListener('input', () => onInput(cell));
    input.addEventListener('paste', (event) => onPaste(event, cell));
  }

  function handleCellPress(cell) {
    if (state.solved) {
      cell.input.focus({ preventScroll: true });
      return;
    }

    const same =
      state.active &&
      state.active.row === cell.row &&
      state.active.col === cell.col;

    let dir = state.dir;
    if (same) {
      const alt = OTHER[state.dir];
      if (cell.words[alt]) dir = alt;
    } else if (!cell.words[dir]) {
      dir = cell.words.across ? 'across' : 'down';
    }

    // Фокус и клавиатуру открываем по событию click,
    // чтобы перетаскивание сетки не вызывало ввод.
    selectCell(cell.row, cell.col, dir, { focus: false, scroll: false });
  }

  function onKeyDown(event, cell) {
    if (event.altKey || event.ctrlKey || event.metaKey) return;
    if (state.solved) return;

    const key = event.key;

    if (key.startsWith('Arrow')) {
      event.preventDefault();
      const dr = key === 'ArrowDown' ? 1 : key === 'ArrowUp' ? -1 : 0;
      const dc = key === 'ArrowRight' ? 1 : key === 'ArrowLeft' ? -1 : 0;
      moveBy(dr, dc);
      return;
    }

    if (key === ' ' || key === 'Spacebar') {
      event.preventDefault();
      toggleDirection();
      return;
    }

    if (key === 'Backspace') {
      event.preventDefault();
      handleBackspace(cell);
      return;
    }

    if (key === 'Delete') {
      event.preventDefault();
      clearCell(cell);
      updateProgress();
      checkSolved();
      saveProgress();
      return;
    }

    if (key === 'Enter') {
      event.preventDefault();
      stepWord(1);
      return;
    }

    if (key === 'Tab') {
      event.preventDefault();
      stepWord(event.shiftKey ? -1 : 1);
      return;
    }

    if (key === 'Home') {
      event.preventDefault();
      jumpInWord(0);
      return;
    }

    if (key === 'End') {
      event.preventDefault();
      jumpInWord(1);
      return;
    }

    if (key === 'Escape') {
      event.preventDefault();
      cell.input.blur();
      els.currentClue.focus();
      return;
    }

    if (key.length === 1) {
      if (/[a-zA-Z]/.test(key)) {
        event.preventDefault();
        enterLetter(cell, key.toUpperCase());
      } else if (/[а-яА-ЯёЁ]/.test(key)) {
        event.preventDefault();
        toast('Ответы вписываются латинскими буквами — переключите раскладку.');
      }
    }
  }

  function onInput(cell) {
    if (state.solved) return;

    const raw = cell.input.value;
    const letters = raw.toUpperCase().replace(/[^A-Z]/g, '');

    if (!letters) {
      if (raw.replace(/\s/g, '') !== '') {
        cell.input.value = '';
        updateProgress();
        saveProgress();
      }
      return;
    }

    startTimer();
    cell.input.value = letters.slice(-1);
    cell.el.classList.remove('is-wrong', 'is-correct', 'is-revealed');
    updateProgress();
    moveWithinWord(1);
    checkSolved();
    saveProgress();
  }

  function onPaste(event, cell) {
    if (state.solved) return;

    const clipboard = event.clipboardData || window.clipboardData;
    const text = clipboard ? clipboard.getData('text') : '';
    const letters = text.toUpperCase().replace(/[^A-Z]/g, '');

    if (!letters) return;
    event.preventDefault();
    fillLetters(cell, letters);
  }

  function fillLetters(cell, letters) {
    startTimer();

    let word = cell.words[state.dir] || cell.words.across || cell.words.down;
    let startIndex = 0;

    if (word) {
      const index = word.cells.findIndex(
        (position) => position.row === cell.row && position.col === cell.col
      );
      startIndex = index >= 0 ? index : 0;
    }

    const destinations = word
      ? word.cells.slice(startIndex)
      : [{ row: cell.row, col: cell.col }];

    destinations.forEach((position, i) => {
      const letter = letters[i];
      if (!letter) return;
      const target = cellAt(position.row, position.col);
      if (!target) return;
      target.input.value = letter;
      target.el.classList.remove('is-wrong', 'is-correct', 'is-revealed');
    });

    updateProgress();
    checkSolved();
    saveProgress();
  }

  function enterLetter(cell, letter, options = {}) {
    if (state.solved) return;

    startTimer();
    cell.input.value = letter;
    cell.el.classList.remove('is-wrong', 'is-correct');
    cell.el.classList.toggle('is-revealed', Boolean(options.reveal));
    updateProgress();

    if (options.advance !== false) {
      moveWithinWord(1);
    }

    checkSolved();
    saveProgress();
  }

  function clearCell(cell) {
    if (state.solved) return;
    if (!cell.input.value && !cell.el.classList.contains('is-revealed')) return;

    cell.input.value = '';
    cell.el.classList.remove('is-wrong', 'is-correct', 'is-revealed');
  }

  function handleBackspace(cell) {
    if (cell.input.value) {
      clearCell(cell);
      updateProgress();
      saveProgress();
      return;
    }

    const word = activeWord();
    if (!word) return;

    const index = word.cells.findIndex(
      (position) => position.row === state.active.row && position.col === state.active.col
    );
    if (index > 0) {
      const previous = word.cells[index - 1];
      selectCell(previous.row, previous.col, word.dir, {
        focus: true,
        scroll: true,
      });
      const previousCell = cellAt(previous.row, previous.col);
      if (previousCell) {
        clearCell(previousCell);
        updateProgress();
        saveProgress();
      }
    }
  }

  /* ------------------------------------------------------------
     Проверка, подсказки, завершение
     ------------------------------------------------------------ */

  function updateProgress() {
    let filled = 0;
    let completeWords = 0;

    for (const cell of cells.values()) {
      if (valueOf(cell)) filled += 1;
    }

    for (const word of allWords) {
      const complete = word.cells.every((position) => {
        const cell = cellAt(position.row, position.col);
        return cell && valueOf(cell);
      });
      if (complete) completeWords += 1;
    }

    const total = cells.size || 1;
    const percent = Math.round((filled / total) * 100);

    els.statProgress.textContent = `${percent}%`;
    els.statWords.textContent = String(completeWords);
    els.progressFill.style.width = `${percent}%`;
    els.progressBar.setAttribute('aria-valuenow', String(percent));
    els.progressLabel.textContent = `${filled} из ${total} букв`;
  }

  function updateTimerText() {
    els.statTime.textContent = formatTime(state.elapsed);
  }

  function formatTime(totalSeconds) {
    const seconds = Math.max(0, Math.floor(totalSeconds));
    const minutes = Math.floor(seconds / 60);
    const hours = Math.floor(minutes / 60);
    const restSeconds = String(seconds % 60).padStart(2, '0');

    if (hours > 0) {
      return `${hours}:${String(minutes % 60).padStart(2, '0')}:${restSeconds}`;
    }
    return `${String(minutes).padStart(2, '0')}:${restSeconds}`;
  }

  function startTimer() {
    if (state.started || state.solved) return;
    state.started = true;
    state.timerId = window.setInterval(() => {
      state.elapsed += 1;
      updateTimerText();
      if (state.elapsed % 5 === 0) saveProgress();
    }, 1000);
  }

  function stopTimer() {
    if (state.timerId) {
      window.clearInterval(state.timerId);
      state.timerId = 0;
    }
    state.started = false;
  }

  function checkSolved() {
    if (state.solved) return false;

    for (const cell of cells.values()) {
      if (valueOf(cell) !== cell.solution) return false;
    }

    onSolved();
    return true;
  }

  function onSolved() {
    if (state.solved) return;

    state.solved = true;
    stopTimer();
    freezeInputs(true);
    updateProgress();

    for (const cell of cells.values()) {
      cell.el.classList.remove('is-wrong', 'is-correct');
    }

    els.winTime.textContent = formatTime(state.elapsed);
    els.winHints.textContent = String(state.hints);
    els.winText.textContent = `Все ${allWords.length} слов на своих местах. Отличная работа!`;

    launchConfetti();
    saveProgress();

    window.setTimeout(() => {
      if (!els.winDialog.open) {
        if (typeof els.winDialog.showModal === 'function') {
          els.winDialog.showModal();
        } else {
          els.winDialog.setAttribute('open', '');
        }
      }
    }, 260);
  }

  function checkAnswers() {
    if (state.solved) {
      toast('Кроссворд уже разгадан. Нажмите «Заново», чтобы пройти его снова.');
      return;
    }

    startTimer();

    let wrong = 0;
    let empty = 0;

    for (const cell of cells.values()) {
      cell.el.classList.remove('is-wrong', 'is-correct');
      const value = valueOf(cell);

      if (!value) {
        empty += 1;
      } else if (value === cell.solution) {
        cell.el.classList.add('is-correct');
      } else {
        wrong += 1;
        cell.el.classList.add('is-wrong');
      }
    }

    if (wrong > 0) {
      toast(
        `Найдено ошибок: ${wrong}. Зелёные клетки — верно, красные — ошибки.`,
        'error'
      );
    } else if (empty > 0) {
      toast(
        `Пока всё верно — осталось заполнить ${empty} ${plural(empty, 'букву', 'буквы', 'букв')}.`
      );
    } else {
      checkSolved();
    }
  }

  function pickHintCell() {
    const word = activeWord();

    if (word) {
      for (const position of word.cells) {
        const cell = cellAt(position.row, position.col);
        if (cell && valueOf(cell) !== cell.solution) return cell;
      }
      return null;
    }

    const candidates = [...cells.values()].filter(
      (cell) => valueOf(cell) !== cell.solution
    );
    if (!candidates.length) return null;

    const empty = candidates.filter((cell) => !valueOf(cell));
    const pool = empty.length ? empty : candidates;
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function showHint() {
    if (state.solved) {
      toast('Кроссворд уже разгадан. Нажмите «Заново», чтобы пройти его снова.');
      return;
    }

    const cell = pickHintCell();
    if (!cell) {
      toast('В этом слове уже открыты все буквы.');
      return;
    }

    const word = cell.words[state.dir] || cell.words.across || cell.words.down;
    if (word && (!state.active || !word.cells.some(
      (position) => position.row === cell.row && position.col === cell.col
    ))) {
      selectCell(cell.row, cell.col, word.dir, { focus: true, scroll: true });
    }

    startTimer();
    state.hints += 1;
    enterLetter(cell, cell.solution, { advance: true, reveal: true });
    toast('Буква открыта — она подсвечена зелёным.');
  }

  function revealWord() {
    if (state.solved) {
      toast('Кроссворд уже разгадан. Нажмите «Заново», чтобы пройти его снова.');
      return;
    }

    const word = activeWord();
    if (!word) {
      toast('Сначала выберите слово в сетке или в списке вопросов.');
      return;
    }

    let changed = 0;

    for (const position of word.cells) {
      const cell = cellAt(position.row, position.col);
      if (!cell || valueOf(cell) === cell.solution) continue;
      cell.input.value = cell.solution;
      cell.el.classList.add('is-revealed');
      cell.el.classList.remove('is-wrong', 'is-correct');
      changed += 1;
    }

    if (changed === 0) {
      toast('Это слово уже заполнено верно.');
      return;
    }

    startTimer();
    state.hints += 1;
    updateProgress();
    checkSolved();
    saveProgress();
    toast(`Слово ${word.number} открыто.`);
  }

  function revealAllAnswers() {
    if (state.solved) {
      toast('Кроссворд уже завершён. Нажмите «Заново», чтобы начать с чистого листа.');
      return;
    }

    const confirmed = window.confirm(
      'Показать все ответы? Кроссворд будет считаться завершённым.'
    );
    if (!confirmed) return;

    for (const cell of cells.values()) {
      if (valueOf(cell) !== cell.solution) {
        cell.input.value = cell.solution;
        cell.el.classList.add('is-revealed');
      }
      cell.el.classList.remove('is-wrong', 'is-correct');
    }

    state.solved = true;
    stopTimer();
    freezeInputs(true);
    updateProgress();
    saveProgress();
    toast('Ответы открыты. Нажмите «Заново», чтобы пройти кроссворд снова.');
  }

  function freezeInputs(readOnly) {
    for (const cell of cells.values()) {
      cell.input.readOnly = readOnly;
    }
  }

  function resetPuzzle() {
    stopTimer();
    state.solved = false;
    state.started = false;
    state.elapsed = 0;
    state.hints = 0;
    state.zoom = 1;

    for (const cell of cells.values()) {
      cell.input.value = '';
      cell.input.readOnly = false;
      cell.el.classList.remove('is-wrong', 'is-correct', 'is-revealed');
    }

    clearConfetti();
    updateTimerText();
    updateProgress();
    applyCellSize();

    try {
      window.localStorage.removeItem(STORAGE_KEY);
    } catch (error) {
      /* localStorage может быть недоступен — это не критично */
    }

    selectWord(orderedWords[0], { focus: false });
    toast('Кроссворд очищен. Начнём заново!');
  }

  /* ------------------------------------------------------------
     Сохранение прогресса
     ------------------------------------------------------------ */

  function saveProgress() {
    const data = {
      v: 1,
      sig: PUZZLE_SIGNATURE,
      letters: {},
      revealed: [],
      elapsed: Math.round(state.elapsed),
      hints: state.hints,
      solved: state.solved,
    };

    for (const cell of cells.values()) {
      const value = valueOf(cell);
      if (value) data.letters[keyOf(cell.row, cell.col)] = value;
      if (cell.el.classList.contains('is-revealed')) {
        data.revealed.push(keyOf(cell.row, cell.col));
      }
    }

    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
    } catch (error) {
      /* приватный режим или file:// — просто продолжаем без сохранения */
    }
  }

  function restoreProgress() {
    let data = null;

    try {
      const raw = window.localStorage.getItem(STORAGE_KEY);
      if (raw) data = JSON.parse(raw);
    } catch (error) {
      return false;
    }

    if (!data || typeof data !== 'object') return false;
    if (data.sig !== PUZZLE_SIGNATURE) return false;

    const letters = data.letters && typeof data.letters === 'object' ? data.letters : {};

    for (const [key, value] of Object.entries(letters)) {
      const [row, col] = key.split(',').map(Number);
      const cell = cellAt(row, col);
      if (!cell) continue;
      if (typeof value === 'string' && /^[A-Z]$/.test(value)) {
        cell.input.value = value;
      }
    }

    for (const key of Array.isArray(data.revealed) ? data.revealed : []) {
      const [row, col] = String(key).split(',').map(Number);
      const cell = cellAt(row, col);
      if (cell) cell.el.classList.add('is-revealed');
    }

    state.elapsed = Math.max(0, Number(data.elapsed) || 0);
    state.hints = Math.max(0, Number(data.hints) || 0);
    state.solved = Boolean(data.solved);

    if (state.solved) {
      freezeInputs(true);
      for (const cell of cells.values()) {
        cell.el.classList.remove('is-wrong', 'is-correct');
      }
    }

    return Object.keys(letters).length > 0 || state.elapsed > 0 || state.solved;
  }

  /* ------------------------------------------------------------
     Масштаб
     ------------------------------------------------------------ */

  function fitCell() {
    const available = Math.max(200, els.gridScroller.clientWidth - 12);
    const fit = Math.floor(available / PUZZLE.width);
    state.baseCell = Math.min(42, Math.max(18, fit));
    applyCellSize();
  }

  function applyCellSize() {
    const size = Math.round(
      Math.min(64, Math.max(12, state.baseCell * state.zoom))
    );
    els.grid.style.setProperty('--cell', `${size}px`);
    els.zoomOut.disabled = state.zoom <= 0.71;
    els.zoomIn.disabled = state.zoom >= 2.19;
    updateScrollHints();
  }

  function updateScrollHints() {
    const scroller = els.gridScroller;
    const wrap = els.gridWrap;
    if (!scroller || !wrap) return;

    const max = scroller.scrollWidth - scroller.clientWidth;
    wrap.classList.toggle('can-scroll-left', scroller.scrollLeft > 4);
    wrap.classList.toggle(
      'can-scroll-right',
      max > 4 && scroller.scrollLeft < max - 4
    );
  }

  function zoomBy(delta) {
    state.zoom = Math.min(2.2, Math.max(0.7, Math.round((state.zoom + delta) * 100) / 100));
    applyCellSize();

    const cell = activeCell();
    if (cell) {
      cell.el.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
  }

  /* ------------------------------------------------------------
     Интерфейс: тосты, конфетти, диалог
     ------------------------------------------------------------ */

  function toast(message, kind = '') {
    els.toast.textContent = message;
    els.toast.className = `toast is-visible${kind ? ` is-${kind}` : ''}`;

    if (toastTimer) window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => {
      els.toast.classList.remove('is-visible');
      toastTimer = 0;
    }, 3400);
  }

  function launchConfetti() {
    const colors = ['#c2410c', '#eab308', '#0f766e', '#2563eb', '#db2777', '#65a30d'];
    els.confetti.innerHTML = '';

    for (let i = 0; i < 64; i += 1) {
      const piece = document.createElement('span');
      piece.style.left = `${Math.random() * 100}%`;
      piece.style.background = colors[i % colors.length];
      piece.style.animationDelay = `${Math.random() * 0.55}s`;
      piece.style.animationDuration = `${1.7 + Math.random() * 1.3}s`;
      piece.style.setProperty('--drift', `${(Math.random() * 2 - 1) * 100}px`);
      piece.style.width = `${5 + Math.random() * 5}px`;
      piece.style.height = `${8 + Math.random() * 7}px`;
      els.confetti.appendChild(piece);
    }
  }

  function clearConfetti() {
    els.confetti.innerHTML = '';
  }

  function plural(count, one, few, many) {
    const mod10 = count % 10;
    const mod100 = count % 100;
    if (mod10 === 1 && mod100 !== 11) return one;
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
    return many;
  }

  /* ------------------------------------------------------------
     События интерфейса
     ------------------------------------------------------------ */

  function bindControls() {
    els.prevWord.addEventListener('click', () => stepWord(-1));
    els.nextWord.addEventListener('click', () => stepWord(1));

    els.currentClue.addEventListener('click', () => {
      if (!state.active) {
        selectWord(orderedWords[0], { focus: true });
        return;
      }
      toggleDirection();
    });

    els.checkBtn.addEventListener('click', checkAnswers);
    els.hintBtn.addEventListener('click', showHint);
    els.revealWordBtn.addEventListener('click', revealWord);
    els.revealAllBtn.addEventListener('click', revealAllAnswers);

    els.resetBtn.addEventListener('click', () => {
      if (window.confirm('Очистить кроссворд и начать заново?')) {
        resetPuzzle();
      }
    });

    els.zoomIn.addEventListener('click', () => zoomBy(0.15));
    els.zoomOut.addEventListener('click', () => zoomBy(-0.15));
    els.gridScroller.addEventListener('scroll', updateScrollHints, { passive: true });

    els.winClose.addEventListener('click', () => els.winDialog.close());
    els.winRestart.addEventListener('click', () => {
      els.winDialog.close();
      resetPuzzle();
    });

    els.winDialog.addEventListener('click', (event) => {
      if (event.target !== els.winDialog) return;
      const rect = els.winDialog.getBoundingClientRect();
      const inside =
        event.clientX >= rect.left &&
        event.clientX <= rect.right &&
        event.clientY >= rect.top &&
        event.clientY <= rect.bottom;
      if (!inside) els.winDialog.close();
    });

    els.winDialog.addEventListener('close', clearConfetti);

    let resizeRaf = 0;
    window.addEventListener('resize', () => {
      window.cancelAnimationFrame(resizeRaf);
      resizeRaf = window.requestAnimationFrame(fitCell);
    });
  }

  /* ------------------------------------------------------------
     Старт
     ------------------------------------------------------------ */

  function init() {
    buildModel();
    buildGrid();
    buildClues();
    bindControls();

    els.statWordTotal.textContent = String(allWords.length);

    const restored = restoreProgress();
    updateTimerText();
    updateProgress();

    // Первый показ сетки после раскладки.
    window.requestAnimationFrame(fitCell);
    fitCell();

    selectWord(orderedWords[0], { focus: false });

    if (restored) {
      window.setTimeout(() => {
        if (state.solved) {
          toast('Этот кроссворд уже разгадан. Нажмите «Заново», чтобы пройти его снова.');
        } else {
          toast('Сохранённый прогресс восстановлен.');
        }
      }, 450);
    }
  }

  init();
})();
