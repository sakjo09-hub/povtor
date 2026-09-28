(() => {
  "use strict";

  const STORAGE_KEY = "slovo-app-v1";
  const VOWELS = "аеёиоуыэюя";
  const LETTER_ALTERNATIVES = {
    а: "о", о: "а", е: "и", и: "е", ё: "е", ы: "и", э: "е", я: "е", у: "ю", ю: "у",
    б: "п", п: "б", в: "ф", ф: "в", г: "к", к: "г", д: "т", т: "д", ж: "ш", ш: "ж",
    з: "с", с: "з", й: "и", л: "р", р: "л", м: "н", н: "м", х: "г", ц: "с", ч: "щ", щ: "ч"
  };
  const app = document.querySelector("#app");
  const modalLayer = document.querySelector("#modalLayer");
  const backButton = document.querySelector("#backButton");
  const brand = document.querySelector("#brand");
  const bottomNav = document.querySelector("#bottomNav");
  const settingsButton = document.querySelector("#settingsButton");
  const importFile = document.querySelector("#importFile");

  let state = loadState();
  let view = { route: "home", setId: null, showAnswers: false };
  let quiz = null;
  let draftHidden = [];
  let draftStressIndex = null;
  let draftDoubleIndex = null;
  let addedInSheet = 0;
  let pendingQuiz = null;

  function uid() {
    return crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  }

  function initialState() {
    return {
      version: 2,
      createdAt: new Date().toISOString(),
      activityDates: [],
      sets: [
        {
          id: uid(), title: "Слова к диктанту", type: "letters", createdAt: new Date().toISOString(),
          items: [
            makeLettersItem("багаж", [1]),
            makeLettersItem("впечатление", [2]),
            makeLettersItem("аккуратный", [3])
          ]
        },
        {
          id: uid(), title: "Слитно или раздельно", type: "spelling", createdAt: new Date().toISOString(),
          items: [
            makeItem({ prompt: "в/общем", answer: "separate" }),
            makeItem({ prompt: "на/конец", answer: "together" }),
            makeItem({ prompt: "по/прежнему", answer: "hyphen" })
          ]
        },
        {
          id: uid(), title: "Ударения", type: "stress", createdAt: new Date().toISOString(),
          items: [parseStress("звонИт"), parseStress("красИвее"), parseStress("тОрты")].filter(Boolean)
        },
        defaultDoubleSet()
      ]
    };
  }

  function makeItem(data) {
    return { id: uid(), attempts: 0, correct: 0, mistakes: 0, lastAnsweredAt: null, ...data };
  }

  function makeLettersItem(word, hidden) {
    return makeItem({ word: word.trim(), hidden: [...new Set(hidden)].sort((a, b) => a - b) });
  }

  function makeDoubleItem(word, selectedIndex) {
    const data = doubleRun(word.trim(), selectedIndex);
    return makeItem({ word: word.trim(), letter: data.letter, start: data.start, count: data.count });
  }

  function itemKey(type, item) {
    const text = value => String(value || "").trim().toLocaleLowerCase("ru-RU").replace(/\s+/g, " ");
    if (type === "letters") {
      const data = letterData(item);
      return `${text(data.word)}|${data.hidden.join(",")}`;
    }
    if (type === "double") {
      const data = doubleData(item);
      return `${text(data.word)}|${data.start}|${data.count}`;
    }
    if (type === "stress") return `${text(item.plain)}|${Number(item.stressIndex)}`;
    return `${text(item.prompt)}|${item.answer}`;
  }

  function addUniqueItem(set, item) {
    if (set.items.some(existing => itemKey(set.type, existing) === itemKey(set.type, item))) {
      toast("Такое задание уже есть в наборе");
      return false;
    }
    set.items.push(item);
    saveState();
    noteAdded();
    return true;
  }

  function defaultDoubleSet() {
    return {
      id: uid(), title: "Одна или две буквы", type: "double", createdAt: new Date().toISOString(),
      items: [
        makeDoubleItem("деревянный", 6),
        makeDoubleItem("ветреный", 5),
        makeDoubleItem("аккуратный", 1),
        makeDoubleItem("картина", 0)
      ]
    };
  }

  function loadState() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved && Array.isArray(saved.sets)) {
        if ((saved.version || 1) < 2) {
          saved.version = 2;
          if (!saved.sets.some(set => set.type === "double")) saved.sets.push(defaultDoubleSet());
          localStorage.setItem(STORAGE_KEY, JSON.stringify(saved));
        }
        return saved;
      }
    } catch (_) {}
    const fresh = initialState();
    localStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
    return fresh;
  }

  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function esc(value = "") {
    return String(value).replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
  }

  function normalize(value) {
    return String(value).trim().toLocaleLowerCase("ru-RU").replace(/ё/g, "е").replace(/\s+/g, " ");
  }

  const typeInfo = {
    letters: { title: "Пропущенные буквы", short: "Буквы", icon: "А_", className: "letters" },
    double: { title: "Одна или две буквы", short: "Одна или две", icon: "Н/НН", className: "double" },
    spelling: { title: "Слитно или раздельно", short: "Написание", icon: "↔", className: "spelling" },
    stress: { title: "Ударения", short: "Ударения", icon: "А́", className: "stress" }
  };

  function allItems() {
    return state.sets.flatMap(set => set.items.map(item => ({ ...item, setId: set.id, setTitle: set.title, type: set.type })));
  }

  function learningStats(items = allItems()) {
    const needsRepeat = items.filter(item => item.mistakes > 0).length;
    const learned = items.filter(item => item.attempts > 0 && item.mistakes === 0).length;
    return {
      words: items.length,
      learned,
      needsRepeat,
      untouched: Math.max(0, items.length - learned - needsRepeat)
    };
  }

  function mistakeItems() {
    return allItems().filter(item => item.mistakes > 0).sort((a, b) => b.mistakes - a.mistakes);
  }

  function setHeader(detail = false) {
    backButton.classList.toggle("is-hidden", !detail);
    brand.classList.toggle("is-hidden", detail);
    bottomNav.classList.toggle("is-hidden", detail);
    bottomNav.querySelectorAll("button").forEach(button => { button.disabled = false; });
    settingsButton.classList.toggle("is-hidden", detail && view.route === "quiz");
  }

  function render() {
    window.scrollTo({ top: 0, behavior: "instant" });
    document.querySelectorAll(".nav-item").forEach(button => button.classList.toggle("is-active", button.dataset.route === view.route));
    if (view.route === "home") renderHome();
    else if (view.route === "review") renderReview();
    else if (view.route === "stats") renderStats();
    else if (view.route === "set") renderSet();
    else if (view.route === "quiz") renderQuiz();
    else if (view.route === "result") renderResult();
  }

  function renderHome() {
    setHeader(false);
    const progress = learningStats();
    const headline = progress.needsRepeat
      ? `${progress.needsRepeat} ${wordForm(progress.needsRepeat, ["слово", "слова", "слов"])}`
      : `${progress.words} ${wordForm(progress.words, ["слово", "слова", "слов"])}`;
    app.innerHTML = `
      <section class="page-head">
        <div><p class="eyebrow">Личная подборка</p><h1>Мои наборы</h1></div>
      </section>
      <section class="summary-card">
        <div class="summary-row">
          <div>
            <div class="summary-title">${progress.needsRepeat ? "Нужно повторить" : "В вашей подборке"}</div>
            <div class="summary-value">${headline}</div>
            <div class="summary-note">${progress.needsRepeat ? "Ошибки собраны в разделе «Повтор»" : "Можно начать тренировку с любого набора"}</div>
          </div>
          <div class="summary-badge">${progress.needsRepeat ? "↻" : "✓"}</div>
        </div>
      </section>
      <div class="section-head"><h2>Наборы</h2><button class="text-btn" type="button" data-action="new-set">Добавить</button></div>
      ${state.sets.length ? `<div class="set-list">${state.sets.map(setCard).join("")}</div>` : emptySets()}
      <button class="fab" type="button" data-action="new-set" aria-label="Создать набор">+</button>
    `;
  }

  function setCard(set) {
    const info = typeInfo[set.type];
    const progress = learningStats(set.items);
    const status = progress.needsRepeat ? ` · ${progress.needsRepeat} на повторе` : "";
    return `<button class="set-card" type="button" data-open-set="${set.id}">
      <span class="set-icon ${info.className}">${info.icon}</span>
      <span><span class="set-title">${esc(set.title)}</span><span class="set-meta">${set.items.length} ${wordForm(set.items.length, ["слово", "слова", "слов"])}${status}</span></span>
      <span class="chevron">›</span>
    </button>`;
  }

  function emptySets() {
    return `<section class="empty-state"><div class="empty-icon">＋</div><h2>Создайте первый набор</h2><p>Соберите слова по одной теме и тренируйте их в случайном порядке.</p><button class="primary-btn" type="button" data-action="new-set">Создать набор</button></section>`;
  }

  function renderSet() {
    setHeader(true);
    const set = state.sets.find(entry => entry.id === view.setId);
    if (!set) return navigate("home");
    const info = typeInfo[set.type];
    const progress = learningStats(set.items);
    app.innerHTML = `
      <section class="detail-card">
        <div class="detail-top"><span class="set-icon ${info.className}">${info.icon}</span><div><p class="eyebrow">${info.title}</p><h1>${esc(set.title)}</h1><p class="subtext">${set.items.length} ${wordForm(set.items.length, ["слово", "слова", "слов"])}</p></div></div>
        <div class="detail-actions">
          <button class="primary-btn" type="button" data-action="start-set" ${set.items.length ? "" : "disabled"}>Начать тренировку</button>
          <button class="secondary-btn" type="button" data-action="add-words">Добавить слово</button>
        </div>
        ${progress.needsRepeat ? `<div class="review-strip"><span><strong>${progress.needsRepeat}</strong> ${wordForm(progress.needsRepeat, ["слово нужно", "слова нужно", "слов нужно"])} повторить</span><button type="button" data-action="repeat-set-mistakes">Повторить ошибки</button></div>` : ""}
      </section>
      <div class="section-head">
        <h2>Слова</h2>
        <div class="section-actions">
          ${set.items.length ? `<button class="text-btn answer-toggle" type="button" data-action="toggle-answers">${view.showAnswers ? "Скрыть ответы" : "Показать ответы"}</button>` : ""}
          <button class="text-btn muted-action" type="button" data-action="set-menu">Изменить</button>
        </div>
      </div>
      ${set.items.length ? `
        ${set.items.length >= 8 ? `<div class="word-search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"></circle><path d="m20 20-4-4"></path></svg><input id="wordSearch" type="search" placeholder="Найти слово" autocomplete="off" aria-label="Найти слово в наборе"><span id="wordSearchCount">${set.items.length}</span></div>` : ""}
        <div class="word-list" id="wordList">${set.items.map((item, index) => wordRow(item, set.type, view.showAnswers, index)).join("")}</div>
        <div class="word-search-empty" id="wordSearchEmpty" hidden>Ничего не найдено</div>
      ` : `<section class="empty-state"><div class="empty-icon">А</div><h2>Пока пусто</h2><p>Добавьте первое слово в этот набор.</p><button class="primary-btn" type="button" data-action="add-words">Добавить слово</button></section>`}
    `;
  }

  function wordRow(item, type, showAnswer = false, index = 0) {
    let prompt = item.prompt;
    let answer = item.answer;
    if (type === "letters") {
      const data = letterData(item);
      prompt = data.masked;
      answer = data.word;
    }
    if (type === "double") {
      const data = doubleData(item);
      prompt = data.masked;
      answer = `${data.word} · ${data.answer}`;
    }
    if (type === "stress") { prompt = item.plain; answer = formatStress(item); }
    if (type === "spelling") answer = answerLabel(item.answer);
    const answerMarkup = showAnswer
      ? `<div class="word-answer is-revealed">${esc(answer)}</div>`
      : `<div class="word-answer is-concealed">Ответ скрыт</div>`;
    const searchText = normalize(`${prompt || ""} ${answer || ""}`);
    return `<div class="word-row" data-word-search="${esc(searchText)}"><div class="word-number" aria-hidden="true">${index + 1}</div><div class="word-copy"><div class="word-prompt">${esc(prompt)}</div>${answerMarkup}</div><button class="row-menu" type="button" aria-label="Удалить слово" data-delete-item="${esc(item.id)}">×</button></div>`;
  }

  function renderReview() {
    setHeader(false);
    const mistakes = mistakeItems();
    const availableSets = state.sets.map(set => {
      const errors = set.items.filter(item => item.mistakes > 0).length;
      return { set, count: errors };
    }).filter(entry => entry.count);
    const hasWords = allItems().length > 0;
    app.innerHTML = `
      <section class="page-head"><div><p class="eyebrow">Работа над ошибками</p><h1>Повтор</h1></div></section>
      ${mistakes.length ? `
        <section class="summary-card"><div class="summary-row"><div><div class="summary-title">Нужно закрепить</div><div class="summary-value">${mistakes.length} ${wordForm(mistakes.length, ["слово", "слова", "слов"])}</div><div class="summary-note">Здесь только слова, в которых были ошибки</div></div><div class="summary-badge">↻</div></div></section>
        <button class="primary-btn full-width" type="button" data-action="start-mistakes">Повторить все ошибки</button>
        <div class="section-head"><h2>Ошибки по наборам</h2></div>
        ${availableSets.map(({set, count}) => `<div class="review-card"><div class="review-count">${count}</div><div class="review-copy"><h3>${esc(set.title)}</h3><p>${typeInfo[set.type].title}</p></div><button class="small-primary" type="button" data-review-set="${set.id}">Повторить</button></div>`).join("")}
      ` : hasWords
        ? `<section class="empty-state review-complete"><div class="empty-icon is-success">✓</div><h2>Всё повторено</h2><p>Сейчас нет слов с ошибками. Новую тренировку можно начать в разделе «Наборы».</p><button class="primary-btn" type="button" data-route="home">К наборам</button></section>`
        : `<section class="empty-state"><div class="empty-icon">＋</div><h2>Пока нечего повторять</h2><p>Сначала создайте набор и добавьте в него слова.</p><button class="primary-btn" type="button" data-route="home">Создать набор</button></section>`}
    `;
  }

  function renderStats() {
    setHeader(false);
    const progress = learningStats();
    const completed = progress.words ? Math.round(progress.learned / progress.words * 100) : 0;
    app.innerHTML = `
      <section class="page-head"><div><p class="eyebrow">Что уже закреплено</p><h1>Прогресс</h1></div></section>
      <section class="learning-overview">
        <div class="learning-top"><div><span>Закреплено</span><strong>${progress.learned} из ${progress.words}</strong></div><span class="learning-percent">${completed}%</span></div>
        <div class="learning-track"><span style="width:${completed}%"></span></div>
        <div class="learning-breakdown">
          <div><strong>${progress.untouched}</strong><span>ещё не проходили</span></div>
          <div class="${progress.needsRepeat ? "needs-attention" : ""}"><strong>${progress.needsRepeat}</strong><span>нужно повторить</span></div>
        </div>
        ${progress.needsRepeat ? `<button class="primary-btn full-width" type="button" data-action="start-mistakes">Повторить ошибки</button>` : ""}
      </section>
      <div class="section-head"><h2>По наборам</h2></div>
      <div class="stat-card stat-list">${state.sets.length ? state.sets.map(set => {
        const setProgress = learningStats(set.items);
        const details = [`${setProgress.learned} закреплено`];
        if (setProgress.untouched) details.push(`${setProgress.untouched} не проходили`);
        return `<button class="stat-set-row" type="button" data-open-set="${set.id}"><span><strong>${esc(set.title)}</strong><small>${details.join(" · ")}</small></span><span class="stat-set-end">${setProgress.needsRepeat ? `<span class="repeat-pill">${setProgress.needsRepeat} повторить</span>` : `<span class="ready-mark">${setProgress.words && !setProgress.untouched ? "Готово" : ""}</span>`}<span class="chevron">›</span></span></button>`;
      }).join("") : `<p class="subtext">Создайте первый набор, чтобы здесь появилась статистика.</p>`}</div>
    `;
  }

  function startQuiz(items, title, source = "set") {
    if (!items.length) return toast("В этом наборе пока нет слов");
    const baseItems = items.map(item => ({ ...item }));
    quiz = {
      title,
      source,
      baseItems,
      items: shuffle(baseItems.map(item => ({ ...item }))),
      index: 0,
      correct: 0,
      wrongAttempts: 0,
      wrongItemIds: [],
      wrongCounts: {},
      answered: false,
      chosenStress: null
    };
    view = { route: "quiz", setId: view.setId };
    render();
  }

  function requestQuiz(items, title, source = "set") {
    if (!items.length) return toast("В этом наборе пока нет слов");
    if (items.length <= 20) return startQuiz(items, title, source);
    pendingQuiz = { items, title, source };
    openSheet(`<div class="sheet-head"><div><p class="eyebrow">Выберите объём</p><h2>Начать тренировку</h2></div><button class="close-btn" type="button" data-close-sheet>×</button></div>
      <p class="subtext quiz-size-copy">В наборе ${items.length} ${wordForm(items.length, ["слово", "слова", "слов"])}. Можно пройти короткую случайную подборку или весь набор.</p>
      <div class="quiz-size-list">
        <button class="quiz-size-option is-primary" type="button" data-action="start-random-20"><span class="quiz-size-badge">20</span><span><strong>20 случайных слов</strong><small>Новая подборка при каждом запуске</small></span></button>
        <button class="quiz-size-option" type="button" data-action="start-all-words"><span class="quiz-size-badge">${items.length}</span><span><strong>Все слова</strong><small>Пройти набор целиком</small></span></button>
      </div>`);
  }

  function launchPendingQuiz(limit = null) {
    if (!pendingQuiz) return;
    const { items, title, source } = pendingQuiz;
    const selected = limit ? shuffle(items.map(item => ({ ...item }))).slice(0, limit) : items;
    closeSheet();
    startQuiz(selected, title, source);
  }

  function renderQuiz() {
    setHeader(true);
    if (!quiz || !quiz.items[quiz.index]) return navigate("home");
    const item = quiz.items[quiz.index];
    const type = item.type || state.sets.find(set => set.id === item.setId)?.type || state.sets.find(set => set.items.some(entry => entry.id === item.id))?.type;
    const totalWords = quiz.baseItems?.length || quiz.items.length;
    const progress = Math.round(quiz.correct / totalWords * 100);
    let answerUI = "";
    if (type === "letters") {
      const data = letterData(item);
      const choices = data.missing.length === 1 ? letterChoices(data.missing) : [];
      answerUI = `<div class="quiz-prompt">${highlightGaps(data.masked)}</div>
        ${choices.length ? `<p class="quiz-instruction letter-instruction">Выберите пропущенную букву</p><div class="letter-choice-grid">${choices.map(choice => `<button class="letter-choice-btn" type="button" data-letter-choice="${esc(choice)}">${esc(choice)}</button>`).join("")}</div>` : `<p class="quiz-instruction letter-instruction">Введите только пропущенные буквы по порядку</p><input class="answer-input short-answer" id="answerInput" maxlength="${data.missing.length}" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="${"_ ".repeat(data.missing.length).trim()}" aria-label="Введите только пропущенные буквы"/><button class="primary-btn full-width" type="button" data-action="check-text">Проверить</button>`}`;
    } else if (type === "double") {
      const data = doubleData(item);
      answerUI = `<div class="quiz-prompt">${highlightGaps(data.masked)}</div><p class="quiz-instruction letter-instruction">Одна буква или две?</p><div class="double-choice-grid"><button class="double-choice-btn" type="button" data-double-choice="${esc(data.letter)}">${esc(data.letter)}</button><button class="double-choice-btn" type="button" data-double-choice="${esc(data.letter.repeat(2))}">${esc(data.letter.repeat(2))}</button></div>`;
    } else if (type === "spelling") {
      answerUI = `<div class="quiz-prompt">${esc(item.prompt).replaceAll("/", "<span class=\"gap\"> / </span>")}</div><div class="choice-grid"><button class="choice-btn" type="button" data-choice="together">Слитно</button><button class="choice-btn" type="button" data-choice="separate">Раздельно</button><button class="choice-btn" type="button" data-choice="hyphen">Через дефис</button><button class="choice-btn" type="button" data-choice="skip">Не знаю</button></div>`;
    } else {
      answerUI = `<div class="stress-word" aria-label="Выберите ударную гласную">${[...item.plain].map((letter, index) => `<button class="stress-letter ${VOWELS.includes(letter.toLowerCase()) ? "is-vowel" : ""}" type="button" ${VOWELS.includes(letter.toLowerCase()) ? `data-stress-index="${index}"` : "disabled"}>${esc(letter)}</button>`).join("")}</div><p class="quiz-instruction">Нажмите на ударную гласную</p>`;
    }
    app.innerHTML = `
      <section class="quiz-page">
        <div class="quiz-head"><div class="progress-track"><div class="progress-fill" style="width:${progress}%"></div></div><span class="progress-count">${quiz.correct} / ${totalWords}</span></div>
        <div class="quiz-card">
          <div class="quiz-kind">${typeInfo[type].short}</div>
          ${answerUI}
          <div id="feedbackArea"></div>
        </div>
        <div class="quiz-footer"></div>
      </section>
    `;
    if (type === "letters" && document.querySelector("#answerInput")) setTimeout(() => document.querySelector("#answerInput")?.focus(), 80);
  }

  function highlightGaps(prompt) {
    return esc(prompt).replace(/[_…]+/g, match => `<span class="gap">${match}</span>`);
  }

  function letterData(item) {
    const word = String(item.word || item.answer || "").trim();
    const chars = [...word];
    let hidden = Array.isArray(item.hidden) ? item.hidden.map(Number).filter(index => index >= 0 && index < chars.length) : [];
    if (!hidden.length && item.prompt) {
      const promptChars = [...String(item.prompt)];
      hidden = promptChars.map((char, index) => /[_…]/.test(char) ? index : -1).filter(index => index >= 0 && index < chars.length);
    }
    const uniqueHidden = [...new Set(hidden)].sort((a, b) => a - b);
    return {
      word,
      hidden: uniqueHidden,
      missing: uniqueHidden.map(index => chars[index]).join(""),
      masked: chars.map((char, index) => uniqueHidden.includes(index) ? "_" : char).join("")
    };
  }

  function doubleRun(word, selectedIndex) {
    const chars = [...String(word)];
    const index = Number(selectedIndex);
    const letter = chars[index] || "";
    let start = index;
    let end = index;
    while (start > 0 && chars[start - 1].toLocaleLowerCase("ru-RU") === letter.toLocaleLowerCase("ru-RU")) start -= 1;
    while (end + 1 < chars.length && chars[end + 1].toLocaleLowerCase("ru-RU") === letter.toLocaleLowerCase("ru-RU")) end += 1;
    return { letter, start, count: end - start + 1 };
  }

  function doubleData(item) {
    const word = String(item.word || "").trim();
    const chars = [...word];
    const start = Number(item.start);
    const count = Number(item.count) || 1;
    const letter = item.letter || chars[start] || "";
    return {
      word,
      letter,
      start,
      count,
      answer: letter.repeat(count),
      masked: [...chars.slice(0, start), "_", ...chars.slice(start + count)].join("")
    };
  }

  function letterChoices(correct) {
    const isUpper = correct === correct.toLocaleUpperCase("ru-RU");
    const lower = correct.toLocaleLowerCase("ru-RU");
    const vowelPool = [...VOWELS];
    const consonantPool = [..."бвгджзйклмнпрстфхцчшщ"];
    const pool = VOWELS.includes(lower) ? vowelPool : consonantPool;
    const alternative = LETTER_ALTERNATIVES[lower] || pool.find(letter => letter !== lower);
    const options = shuffle([lower, alternative]);
    return options.map(letter => isUpper ? letter.toLocaleUpperCase("ru-RU") : letter);
  }

  function checkAnswer(userAnswer) {
    if (quiz.answered) return;
    const item = quiz.items[quiz.index];
    const original = findOriginalItem(item.id);
    const type = item.type || findSetForItem(item.id)?.type;
    let isCorrect = false;
    if (type === "letters") isCorrect = String(userAnswer).trim().toLocaleLowerCase("ru-RU") === letterData(item).missing.toLocaleLowerCase("ru-RU");
    else if (type === "double") isCorrect = String(userAnswer).toLocaleLowerCase("ru-RU") === doubleData(item).answer.toLocaleLowerCase("ru-RU");
    else if (type === "spelling") isCorrect = userAnswer === item.answer;
    else isCorrect = Number(userAnswer) === Number(item.stressIndex);

    quiz.answered = true;
    if (isCorrect) quiz.correct += 1;
    else {
      quiz.items.push({ ...item });
      quiz.wrongAttempts = (quiz.wrongAttempts || 0) + 1;
      if (!quiz.wrongItemIds.includes(item.id)) quiz.wrongItemIds.push(item.id);
      quiz.wrongCounts[item.id] = (quiz.wrongCounts[item.id] || 0) + 1;
    }
    const totalWords = quiz.baseItems?.length || quiz.items.length;
    document.querySelector(".progress-fill").style.width = `${Math.round(quiz.correct / totalWords * 100)}%`;
    document.querySelector(".progress-count").textContent = `${quiz.correct} / ${totalWords}`;
    if (original) {
      original.attempts += 1;
      original.correct += isCorrect ? 1 : 0;
      if (!isCorrect) original.mistakes += 1;
      else if (quiz.source === "review") original.mistakes = 0;
      original.lastAnsweredAt = new Date().toISOString();
    }
    const now = new Date();
    const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
    state.activityDates = [...new Set([...(state.activityDates || []), today])];
    saveState();

    document.querySelectorAll("#app button, #app input").forEach(control => { control.disabled = true; });
    if (type === "stress") document.querySelector(`[data-stress-index="${userAnswer}"]`)?.classList.add("is-chosen");
    const answer = displayCorrectAnswer(item, type);
    const area = document.querySelector("#feedbackArea");
    area.innerHTML = `<div class="feedback ${isCorrect ? "correct" : "wrong"}"><div class="feedback-title">${isCorrect ? "Верно" : "Пока неверно"}</div><div class="feedback-answer">Правильный ответ: <strong>${esc(answer)}</strong></div>${isCorrect ? "" : `<div class="feedback-repeat">Это слово ещё раз появится в конце.</div>`}</div>`;
    document.querySelector(".quiz-footer").innerHTML = `<button class="primary-btn full-width" type="button" data-action="next-question">${quiz.index + 1 === quiz.items.length ? "Посмотреть результат" : "Дальше"}</button>`;
    document.querySelector("[data-action='next-question']").disabled = false;
  }

  function displayCorrectAnswer(item, type) {
    if (type === "stress") return formatStress(item);
    if (type === "spelling") return spellingResult(item.prompt, item.answer);
    if (type === "letters") return letterData(item).word;
    if (type === "double") return doubleData(item).word;
    return item.answer;
  }

  function spellingResult(prompt, answer) {
    if (answer === "together") return prompt.replaceAll("/", "").replaceAll("-", "");
    if (answer === "separate") return prompt.replaceAll("/", " ").replace(/\s+/g, " ");
    if (answer === "hyphen") return prompt.replaceAll("/", "-");
    return prompt;
  }

  function renderResult() {
    setHeader(false);
    const totalWords = quiz.baseItems?.length || quiz.items.length;
    const wrongWords = quiz.wrongItemIds?.length || 0;
    const correctFirstTry = Math.max(0, totalWords - wrongWords);
    const correctPercent = totalWords ? Math.round(correctFirstTry / totalWords * 100) : 0;
    app.innerHTML = `<section class="result-wrap"><div class="result-card">
      <div class="result-check" aria-hidden="true">✓</div>
      <p class="eyebrow">Тренировка завершена</p>
      <div class="result-score" aria-label="${correctFirstTry} из ${totalWords} правильно"><strong>${correctFirstTry}<span> из ${totalWords}</span></strong><p>правильно с первого раза</p></div>
      <div class="result-percent"><strong>${correctPercent}%</strong><span>правильно</span></div>
      ${wrongWords ? `<button class="result-errors-btn full-width" type="button" data-action="show-quiz-errors">Посмотреть ошибки</button>` : ""}
      <div class="button-row"><button class="secondary-btn" type="button" data-action="finish-quiz">К наборам</button><button class="primary-btn" type="button" data-action="repeat-quiz">Пройти ещё раз</button></div>
    </div></section>`;
  }

  function showQuizErrors() {
    const ids = new Set(quiz?.wrongItemIds || []);
    const items = (quiz?.baseItems || []).filter(item => ids.has(item.id));
    if (!items.length) return toast("В этой тренировке не было ошибок");
    const rows = items.map((item, index) => {
      const type = item.type || findSetForItem(item.id)?.type;
      let prompt = item.prompt || item.plain || item.word || "";
      if (type === "letters") prompt = letterData(item).masked;
      else if (type === "double") prompt = doubleData(item).masked;
      const count = quiz.wrongCounts?.[item.id] || 1;
      return `<div class="session-error-row">
        <span class="session-error-number">${index + 1}</span>
        <span class="session-error-copy"><strong>${esc(prompt)}</strong><span>Правильно: ${esc(displayCorrectAnswer(item, type))}</span></span>
        <span class="session-error-count">${count} ${wordForm(count, ["ошибка", "ошибки", "ошибок"])}</span>
      </div>`;
    }).join("");
    openSheet(`<div class="sheet-head"><div><p class="eyebrow">Последняя тренировка</p><h2>Ошибки</h2></div><button class="close-btn" type="button" data-close-sheet>×</button></div>
      <p class="subtext quiz-errors-copy">Эти слова уже повторены до правильного ответа.</p>
      <div class="session-error-list">${rows}</div>
      <button class="primary-btn full-width" type="button" data-close-sheet>Закрыть</button>`);
  }

  function showNewSet() {
    openSheet(`<div class="sheet-head"><h2>Новый набор</h2><button class="close-btn" type="button" data-close-sheet>×</button></div>
      <form id="newSetForm">
        <div class="field"><label for="setTitle">Название</label><input id="setTitle" name="title" maxlength="60" placeholder="Например, Слова к диктанту" required /></div>
        <div class="field"><span class="field-label">Тип заданий</span><div class="type-grid">
          ${typeRadio("letters", true)}${typeRadio("double")}${typeRadio("spelling")}${typeRadio("stress")}
        </div></div>
        <button class="primary-btn full-width" type="submit">Создать набор</button>
      </form>`);
    setTimeout(() => document.querySelector("#setTitle")?.focus(), 100);
  }

  function typeRadio(type, checked = false) {
    const info = typeInfo[type];
    const descriptions = { letters: "Вставить пропущенную букву", double: "Выбрать н или нн, к или кк", spelling: "Выбрать способ написания", stress: "Поставить ударение" };
    return `<div class="type-option"><input id="type-${type}" type="radio" name="type" value="${type}" ${checked ? "checked" : ""}/><label for="type-${type}"><span class="set-icon ${info.className}">${info.icon}</span><span class="type-copy"><strong>${info.title}</strong><span>${descriptions[type]}</span></span><span class="radio-dot"></span></label></div>`;
  }

  function showAddWords() {
    const set = state.sets.find(entry => entry.id === view.setId);
    if (!set) return;
    draftHidden = [];
    draftStressIndex = null;
    draftDoubleIndex = null;
    const commonHead = `<div class="sheet-head"><div><p class="eyebrow">${typeInfo[set.type].title}</p><h2>Добавить слово</h2></div><button class="close-btn" type="button" data-close-sheet>×</button></div>`;
    if (set.type === "letters") {
      openSheet(`${commonHead}<form id="addLettersForm">
        <div class="field"><label for="letterWord">Слово целиком</label><input id="letterWord" name="word" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="Например, багаж" required /><p class="field-hint">Пишется только один раз — без подчёркиваний и знака «равно».</p></div>
        <div class="field"><span class="field-label">Нажмите на буквы, которые нужно спрятать</span><div class="letter-picker empty-picker" id="letterPicker">Сначала введите слово</div></div>
        <div class="add-preview" id="addPreview"><span>В задании будет:</span><strong>—</strong></div>
        <button class="primary-btn full-width" id="addWordButton" type="submit" disabled>Добавить слово</button>
      </form>${addedFooter()}`);
      setTimeout(() => document.querySelector("#letterWord")?.focus(), 100);
    } else if (set.type === "double") {
      openSheet(`${commonHead}<form id="addDoubleForm">
        <div class="field"><label for="doubleWord">Слово целиком</label><input id="doubleWord" name="word" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="Например, деревянный" required /><p class="field-hint">Нажмите на букву — если она двойная, выделятся сразу обе.</p></div>
        <div class="field"><span class="field-label">Какую букву проверять?</span><div class="letter-picker empty-picker" id="doublePicker">Сначала введите слово</div></div>
        <div class="add-preview" id="doublePreview"><span>В задании будет:</span><strong>—</strong></div>
        <button class="primary-btn full-width" id="addDoubleButton" type="submit" disabled>Добавить слово</button>
      </form>${addedFooter()}`);
      setTimeout(() => document.querySelector("#doubleWord")?.focus(), 100);
    } else if (set.type === "spelling") {
      openSheet(`${commonHead}<form id="addSpellingForm">
        <div class="split-fields"><div class="field"><label for="spellingPart1">Первая часть</label><input id="spellingPart1" name="part1" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="в" required /></div><div class="join-mark">+</div><div class="field"><label for="spellingPart2">Вторая часть</label><input id="spellingPart2" name="part2" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="общем" required /></div></div>
        <div class="field"><span class="field-label">Как пишется правильно?</span><div class="segmented-control">
          <label><input type="radio" name="answer" value="together" checked><span>Слитно</span></label>
          <label><input type="radio" name="answer" value="separate"><span>Раздельно</span></label>
          <label><input type="radio" name="answer" value="hyphen"><span>Через дефис</span></label>
        </div></div>
        <div class="add-preview" id="spellingPreview"><span>Правильный ответ:</span><strong>—</strong></div>
        <button class="primary-btn full-width" type="submit">Добавить слово</button>
      </form>${addedFooter()}`);
      setTimeout(() => document.querySelector("#spellingPart1")?.focus(), 100);
    } else {
      openSheet(`${commonHead}<form id="addStressForm">
        <div class="field"><label for="stressWordInput">Слово</label><input id="stressWordInput" name="word" autocomplete="off" autocapitalize="none" spellcheck="false" placeholder="Например, звонит" required /><p class="field-hint">Напишите слово обычно, затем нажмите на ударную гласную.</p></div>
        <div class="field"><span class="field-label">Куда падает ударение?</span><div class="letter-picker empty-picker" id="stressPicker">Сначала введите слово</div></div>
        <button class="primary-btn full-width" id="addStressButton" type="submit" disabled>Добавить слово</button>
      </form>${addedFooter()}`);
      setTimeout(() => document.querySelector("#stressWordInput")?.focus(), 100);
    }
  }

  function addedFooter() {
    return `<div class="added-footer"><span id="addedCount">Можно добавить несколько слов подряд</span><button class="text-btn" type="button" data-close-sheet>Готово</button></div>`;
  }

  function showSetMenu() {
    const set = state.sets.find(entry => entry.id === view.setId);
    if (!set) return;
    openSheet(`<div class="sheet-head"><h2>Изменить набор</h2><button class="close-btn" type="button" data-close-sheet>×</button></div>
      <form id="renameSetForm"><div class="field"><label for="renameTitle">Название</label><input id="renameTitle" name="title" maxlength="60" value="${esc(set.title)}" required /></div><button class="primary-btn full-width" type="submit">Сохранить название</button></form>
      <div style="height:12px"></div><button class="danger-btn full-width" type="button" data-action="delete-set">Удалить набор</button>`);
  }

  function showSettings() {
    openSheet(`<div class="sheet-head"><h2>Данные приложения</h2><button class="close-btn" type="button" data-close-sheet>×</button></div>
      <p class="subtext">Слова и результаты хранятся только в этом браузере. Сохраните копию перед очисткой Safari или сменой телефона.</p>
      <div class="settings-list">
        <button class="settings-btn" type="button" data-action="export"><span class="small-icon"><svg viewBox="0 0 24 24"><path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/></svg></span><span><strong>Скачать резервную копию</strong><span>Все наборы и прогресс в одном файле</span></span></button>
        <button class="settings-btn" type="button" data-action="import"><span class="small-icon"><svg viewBox="0 0 24 24"><path d="M12 21V9"/><path d="m7 14 5-5 5 5"/><path d="M5 3h14"/></svg></span><span><strong>Восстановить из файла</strong><span>Заменит текущие данные данными из копии</span></span></button>
        <button class="settings-btn danger" type="button" data-action="reset"><span class="small-icon"><svg viewBox="0 0 24 24"><path d="M4 7h16"/><path d="M9 7V4h6v3"/><path d="m7 7 1 14h8l1-14"/></svg></span><span><strong>Очистить всё</strong><span>Удалить наборы и результаты</span></span></button>
      </div>`);
  }

  function openSheet(content) {
    addedInSheet = 0;
    modalLayer.innerHTML = `<section class="sheet" role="dialog" aria-modal="true">${content}</section>`;
    modalLayer.classList.add("is-open");
    modalLayer.setAttribute("aria-hidden", "false");
  }

  function closeSheet() {
    modalLayer.classList.remove("is-open");
    modalLayer.setAttribute("aria-hidden", "true");
    modalLayer.innerHTML = "";
    pendingQuiz = null;
  }

  function pickerWords(word, renderCharacter) {
    const groups = [];
    let current = [];
    [...word].forEach((char, index) => {
      if (/\s/.test(char)) {
        if (current.length) groups.push(current);
        current = [];
      } else current.push({ char, index });
    });
    if (current.length) groups.push(current);
    return groups.map(group => `<span class="picker-word">${group.map(({ char, index }) => renderCharacter(char, index)).join("")}</span>`).join("");
  }

  function renderLetterPicker(word) {
    const picker = document.querySelector("#letterPicker");
    if (!picker) return;
    const chars = [...word];
    draftHidden = draftHidden.filter(index => index < chars.length && /[а-яё]/i.test(chars[index]));
    const markup = pickerWords(word, (char, index) => /[а-яё]/i.test(char)
      ? `<button class="picker-letter ${draftHidden.includes(index) ? "is-selected" : ""}" type="button" data-hide-index="${index}">${esc(char)}</button>`
      : `<span class="picker-letter is-disabled">${esc(char)}</span>`);
    picker.classList.toggle("empty-picker", !markup);
    picker.innerHTML = markup || "Сначала введите слово";
    const masked = chars.map((char, index) => draftHidden.includes(index) ? "_" : char).join("");
    const preview = document.querySelector("#addPreview strong");
    if (preview) preview.textContent = masked || "—";
    const submit = document.querySelector("#addWordButton");
    if (submit) submit.disabled = !word.trim() || !draftHidden.length;
  }

  function renderDoublePicker(word) {
    const picker = document.querySelector("#doublePicker");
    if (!picker) return;
    const chars = [...word];
    if (draftDoubleIndex !== null && (!chars[draftDoubleIndex] || !/[а-яё]/i.test(chars[draftDoubleIndex]))) draftDoubleIndex = null;
    const selected = draftDoubleIndex === null ? null : doubleRun(word, draftDoubleIndex);
    const markup = pickerWords(word, (char, index) => /[а-яё]/i.test(char)
      ? `<button class="picker-letter ${selected && index >= selected.start && index < selected.start + selected.count ? "is-selected" : ""}" type="button" data-double-index="${index}">${esc(char)}</button>`
      : `<span class="picker-letter is-disabled">${esc(char)}</span>`);
    picker.classList.toggle("empty-picker", !markup);
    picker.innerHTML = markup || "Сначала введите слово";
    const preview = document.querySelector("#doublePreview strong");
    if (preview) preview.textContent = selected ? doubleData({ word, letter: selected.letter, start: selected.start, count: selected.count }).masked : "—";
    const submit = document.querySelector("#addDoubleButton");
    if (submit) submit.disabled = !word.trim() || !selected || selected.count > 2;
  }

  function renderStressPicker(word) {
    const picker = document.querySelector("#stressPicker");
    if (!picker) return;
    const chars = [...word];
    if (draftStressIndex !== null && (!chars[draftStressIndex] || !VOWELS.includes(chars[draftStressIndex].toLocaleLowerCase("ru-RU")))) draftStressIndex = null;
    const markup = pickerWords(word, (char, index) => VOWELS.includes(char.toLocaleLowerCase("ru-RU"))
      ? `<button class="picker-letter ${draftStressIndex === index ? "is-selected stress-selected" : ""}" type="button" data-draft-stress="${index}">${esc(char)}</button>`
      : `<span class="picker-letter is-disabled">${esc(char)}</span>`);
    picker.classList.toggle("empty-picker", !markup);
    picker.innerHTML = markup || "Сначала введите слово";
    const submit = document.querySelector("#addStressButton");
    if (submit) submit.disabled = !word.trim() || draftStressIndex === null;
  }

  function updateSpellingPreview() {
    const first = document.querySelector("#spellingPart1")?.value.trim() || "";
    const second = document.querySelector("#spellingPart2")?.value.trim() || "";
    const answer = document.querySelector("input[name='answer']:checked")?.value || "together";
    const preview = document.querySelector("#spellingPreview strong");
    if (preview) preview.textContent = first && second ? spellingResult(`${first}/${second}`, answer) : "—";
  }

  function noteAdded() {
    addedInSheet += 1;
    const counter = document.querySelector("#addedCount");
    if (counter) counter.textContent = `Добавлено: ${addedInSheet}`;
    toast("Слово добавлено");
  }

  function parseLines(text, type) {
    const lines = text.split(/\r?\n/).map(line => line.trim()).filter(Boolean);
    const items = [];
    const errors = [];
    lines.forEach((line, index) => {
      if (type === "stress") {
        const item = parseStress(line);
        if (item) items.push(item); else errors.push(index + 1);
        return;
      }
      const parts = line.split(/\s*(?:=|→|:)\s*/);
      if (parts.length < 2) return errors.push(index + 1);
      const prompt = parts.shift().trim();
      const rawAnswer = parts.join("=").trim();
      if (!prompt || !rawAnswer) return errors.push(index + 1);
      if (type === "letters") items.push(makeItem({ prompt, answer: rawAnswer }));
      else {
        const mapped = mapSpellingAnswer(rawAnswer);
        if (!mapped || !prompt.includes("/")) errors.push(index + 1);
        else items.push(makeItem({ prompt, answer: mapped }));
      }
    });
    return { items, errors };
  }

  function parseStress(input) {
    const clean = input.trim().normalize("NFC");
    if (!clean) return null;
    const chars = [...clean];
    let stressIndex = chars.findIndex(char => /[АЕЁИОУЫЭЮЯ]/.test(char));
    let plainChars = chars.map(char => char.toLocaleLowerCase("ru-RU"));
    if (stressIndex < 0) {
      const decomposed = [...clean.normalize("NFD")];
      const accentIndex = decomposed.findIndex(char => char === "\u0301");
      if (accentIndex > 0) {
        const before = decomposed.slice(0, accentIndex).filter(char => char !== "\u0301");
        stressIndex = before.length - 1;
        plainChars = decomposed.filter(char => char !== "\u0301").join("").normalize("NFC").toLocaleLowerCase("ru-RU").split("");
      }
    }
    if (stressIndex < 0 || !VOWELS.includes(plainChars[stressIndex]?.toLowerCase())) return null;
    return makeItem({ plain: plainChars.join(""), stressIndex });
  }

  function formatStress(item) {
    return [...item.plain].map((char, index) => index === Number(item.stressIndex) ? char.toLocaleUpperCase("ru-RU") : char).join("");
  }

  function mapSpellingAnswer(value) {
    const answer = normalize(value);
    if (["слитно", "вместе"].includes(answer)) return "together";
    if (["раздельно", "отдельно"].includes(answer)) return "separate";
    if (["дефис", "через дефис", "через-дефис"].includes(answer)) return "hyphen";
    return null;
  }

  function answerLabel(value) {
    return ({ together: "слитно", separate: "раздельно", hyphen: "через дефис" })[value] || value;
  }

  function findOriginalItem(id) {
    for (const set of state.sets) {
      const item = set.items.find(entry => entry.id === id);
      if (item) return item;
    }
    return null;
  }

  function findSetForItem(id) {
    return state.sets.find(set => set.items.some(item => item.id === id));
  }

  function shuffle(items) {
    const copy = [...items];
    for (let index = copy.length - 1; index > 0; index--) {
      const swap = Math.floor(Math.random() * (index + 1));
      [copy[index], copy[swap]] = [copy[swap], copy[index]];
    }
    return copy;
  }

  function wordForm(number, forms) {
    const n = Math.abs(number) % 100;
    const n1 = n % 10;
    if (n > 10 && n < 20) return forms[2];
    if (n1 > 1 && n1 < 5) return forms[1];
    if (n1 === 1) return forms[0];
    return forms[2];
  }

  function navigate(route, setId = null) {
    view = { route, setId, showAnswers: false };
    render();
    app.focus({ preventScroll: true });
  }

  function toast(message) {
    const node = document.createElement("div");
    node.className = "toast";
    node.textContent = message;
    document.querySelector("#toastRegion").append(node);
    setTimeout(() => node.remove(), 2800);
  }

  function exportData() {
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `slovo-backup-${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
    toast("Резервная копия сохранена");
  }

  app.addEventListener("click", event => {
    const routeButton = event.target.closest("[data-route]");
    if (routeButton) return navigate(routeButton.dataset.route);
    const setButton = event.target.closest("[data-open-set]");
    if (setButton) return navigate("set", setButton.dataset.openSet);
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (action === "new-set") showNewSet();
    else if (action === "add-words") showAddWords();
    else if (action === "set-menu") showSetMenu();
    else if (action === "toggle-answers") {
      view.showAnswers = !view.showAnswers;
      render();
    }
    else if (action === "start-set") {
      const set = state.sets.find(entry => entry.id === view.setId);
      requestQuiz(set.items.map(item => ({ ...item, type: set.type, setId: set.id })), set.title);
    } else if (action === "repeat-set-mistakes") {
      const set = state.sets.find(entry => entry.id === view.setId);
      const errors = set?.items.filter(item => item.mistakes > 0) || [];
      requestQuiz(errors.map(item => ({ ...item, type: set.type, setId: set.id })), `${set.title} — ошибки`, "review");
    } else if (action === "start-mistakes") requestQuiz(mistakeItems(), "Повтор ошибок", "review");
    else if (action === "check-text") checkAnswer(document.querySelector("#answerInput")?.value || "");
    else if (action === "next-question") {
      if (quiz.index + 1 >= quiz.items.length) navigate("result", view.setId);
      else { quiz.index += 1; quiz.answered = false; quiz.chosenStress = null; render(); }
    } else if (action === "finish-quiz") navigate(quiz.source === "review" ? "review" : "home");
    else if (action === "repeat-quiz") startQuiz(quiz.baseItems || quiz.items, quiz.title, quiz.source);
    else if (action === "show-quiz-errors") showQuizErrors();

    const choice = event.target.closest("[data-choice]")?.dataset.choice;
    if (choice) checkAnswer(choice);
    const letterChoice = event.target.closest("[data-letter-choice]")?.dataset.letterChoice;
    if (letterChoice !== undefined) checkAnswer(letterChoice);
    const doubleChoice = event.target.closest("[data-double-choice]")?.dataset.doubleChoice;
    if (doubleChoice !== undefined) checkAnswer(doubleChoice);
    const stressIndex = event.target.closest("[data-stress-index]")?.dataset.stressIndex;
    if (stressIndex !== undefined) checkAnswer(stressIndex);
    const deleteId = event.target.closest("[data-delete-item]")?.dataset.deleteItem;
    if (deleteId) {
      const set = state.sets.find(entry => entry.id === view.setId);
      if (set && confirm("Удалить это слово из набора?")) { set.items = set.items.filter(item => item.id !== deleteId); saveState(); render(); }
    }
    const reviewSetId = event.target.closest("[data-review-set]")?.dataset.reviewSet;
    if (reviewSetId) {
      const set = state.sets.find(entry => entry.id === reviewSetId);
      const errors = set.items.filter(item => item.mistakes > 0);
      requestQuiz(errors.map(item => ({...item, type: set.type, setId: set.id})), set.title, "review");
    }
  });

  app.addEventListener("keydown", event => {
    if (event.key === "Enter" && view.route === "quiz" && !quiz?.answered && document.activeElement?.id === "answerInput") {
      event.preventDefault();
      checkAnswer(document.querySelector("#answerInput").value);
    }
  });

  app.addEventListener("input", event => {
    if (event.target.id !== "wordSearch") return;
    const query = normalize(event.target.value);
    const rows = [...document.querySelectorAll("[data-word-search]")];
    let visible = 0;
    rows.forEach(row => {
      const matches = !query || row.dataset.wordSearch.includes(query);
      row.hidden = !matches;
      if (matches) visible += 1;
    });
    const counter = document.querySelector("#wordSearchCount");
    if (counter) counter.textContent = query ? `${visible}/${rows.length}` : rows.length;
    document.querySelector("#wordSearchEmpty")?.toggleAttribute("hidden", visible > 0);
  });

  bottomNav.addEventListener("click", event => {
    const button = event.target.closest("[data-route]");
    if (button) navigate(button.dataset.route);
  });

  modalLayer.addEventListener("click", event => {
    if (event.target === modalLayer || event.target.closest("[data-close-sheet]")) { closeSheet(); if (view.route === "set") render(); return; }
    const hiddenIndex = event.target.closest("[data-hide-index]")?.dataset.hideIndex;
    if (hiddenIndex !== undefined) {
      const index = Number(hiddenIndex);
      draftHidden = draftHidden.includes(index) ? draftHidden.filter(value => value !== index) : [...draftHidden, index];
      renderLetterPicker(document.querySelector("#letterWord")?.value || "");
      return;
    }
    const stressIndex = event.target.closest("[data-draft-stress]")?.dataset.draftStress;
    if (stressIndex !== undefined) {
      draftStressIndex = Number(stressIndex);
      renderStressPicker(document.querySelector("#stressWordInput")?.value || "");
      return;
    }
    const doubleIndex = event.target.closest("[data-double-index]")?.dataset.doubleIndex;
    if (doubleIndex !== undefined) {
      draftDoubleIndex = Number(doubleIndex);
      renderDoublePicker(document.querySelector("#doubleWord")?.value || "");
      return;
    }
    const action = event.target.closest("[data-action]")?.dataset.action;
    if (action === "start-random-20") launchPendingQuiz(20);
    else if (action === "start-all-words") launchPendingQuiz();
    else if (action === "export") exportData();
    else if (action === "import") importFile.click();
    else if (action === "reset" && confirm("Удалить все наборы и результаты? Это действие нельзя отменить.")) {
      state = { version: 2, createdAt: new Date().toISOString(), activityDates: [], sets: [] };
      saveState(); closeSheet(); navigate("home"); toast("Все данные удалены");
    } else if (action === "delete-set" && confirm("Удалить набор вместе со словами и статистикой?")) {
      state.sets = state.sets.filter(set => set.id !== view.setId); saveState(); closeSheet(); navigate("home"); toast("Набор удалён");
    }
  });

  modalLayer.addEventListener("input", event => {
    if (event.target.id === "letterWord") renderLetterPicker(event.target.value);
    else if (event.target.id === "doubleWord") renderDoublePicker(event.target.value);
    else if (event.target.id === "stressWordInput") renderStressPicker(event.target.value);
    else if (event.target.id === "spellingPart1" || event.target.id === "spellingPart2") updateSpellingPreview();
  });

  modalLayer.addEventListener("change", event => {
    if (event.target.name === "answer") updateSpellingPreview();
  });

  modalLayer.addEventListener("submit", event => {
    event.preventDefault();
    const form = event.target;
    if (form.id === "newSetForm") {
      const data = new FormData(form);
      const set = { id: uid(), title: data.get("title").trim(), type: data.get("type"), createdAt: new Date().toISOString(), items: [] };
      state.sets.unshift(set); saveState(); closeSheet(); navigate("set", set.id); showAddWords();
    } else if (form.id === "addLettersForm") {
      const set = state.sets.find(entry => entry.id === view.setId);
      const word = new FormData(form).get("word").trim();
      if (!word || !draftHidden.length) return toast("Выберите хотя бы одну букву для пропуска");
      if (!addUniqueItem(set, makeLettersItem(word, draftHidden))) return;
      form.reset(); draftHidden = []; renderLetterPicker(""); document.querySelector("#letterWord")?.focus();
    } else if (form.id === "addDoubleForm") {
      const set = state.sets.find(entry => entry.id === view.setId);
      const word = new FormData(form).get("word").trim();
      if (!word || draftDoubleIndex === null) return toast("Нажмите на букву, которую нужно проверить");
      const run = doubleRun(word, draftDoubleIndex);
      if (run.count > 2) return toast("В этом месте больше двух одинаковых букв");
      if (!addUniqueItem(set, makeDoubleItem(word, draftDoubleIndex))) return;
      form.reset(); draftDoubleIndex = null; renderDoublePicker(""); document.querySelector("#doubleWord")?.focus();
    } else if (form.id === "addSpellingForm") {
      const set = state.sets.find(entry => entry.id === view.setId);
      const data = new FormData(form);
      const first = data.get("part1").trim();
      const second = data.get("part2").trim();
      if (!first || !second) return;
      if (!addUniqueItem(set, makeItem({ prompt: `${first}/${second}`, answer: data.get("answer") }))) return;
      form.reset(); document.querySelector("input[name='answer'][value='together']").checked = true; updateSpellingPreview(); document.querySelector("#spellingPart1")?.focus();
    } else if (form.id === "addStressForm") {
      const set = state.sets.find(entry => entry.id === view.setId);
      const word = new FormData(form).get("word").trim().toLocaleLowerCase("ru-RU");
      if (!word || draftStressIndex === null) return toast("Нажмите на ударную гласную");
      if (!addUniqueItem(set, makeItem({ plain: word, stressIndex: draftStressIndex }))) return;
      form.reset(); draftStressIndex = null; renderStressPicker(""); document.querySelector("#stressWordInput")?.focus();
    } else if (form.id === "renameSetForm") {
      const set = state.sets.find(entry => entry.id === view.setId);
      set.title = new FormData(form).get("title").trim(); saveState(); closeSheet(); render(); toast("Название сохранено");
    }
  });

  backButton.addEventListener("click", () => {
    if (view.route === "quiz" || view.route === "result") {
      if (confirm("Закончить тренировку? Результаты уже отвеченных слов сохранятся.")) navigate(quiz?.source === "review" ? "review" : "set", quiz?.source === "review" ? null : view.setId);
    } else navigate("home");
  });

  settingsButton.addEventListener("click", showSettings);

  importFile.addEventListener("change", async () => {
    const file = importFile.files?.[0];
    if (!file) return;
    try {
      const parsed = JSON.parse(await file.text());
      if (!parsed || !Array.isArray(parsed.sets)) throw new Error("bad format");
      state = parsed; saveState(); closeSheet(); navigate("home"); toast("Данные восстановлены");
    } catch (_) { toast("Не удалось открыть резервную копию"); }
    importFile.value = "";
  });

  document.addEventListener("keydown", event => { if (event.key === "Escape" && modalLayer.classList.contains("is-open")) closeSheet(); });

  if ("serviceWorker" in navigator) window.addEventListener("load", () => {
    navigator.serviceWorker.register("./sw.js").then(registration => registration.update()).catch(() => {});
  });
  render();
})();
