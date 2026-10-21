/*
 * Budgetly — personal monthly budget planner
 * Plain HTML/CSS/vanilla JS. No build step. Data lives only in this browser (localStorage).
 *
 * ---------------------------------------------------------------------------
 * SUMMARY MATH — worked example
 * (money is stored as integer cents so totals never drift, e.g. 0.1 + 0.2)
 *
 *   Income:    Salary $2,600.00 + Salary $2,600.00 + Freelance $450.00  = $5,650.00
 *   Expenses:  Rent $1,650.00 + Groceries $412.35 + Dining Out $187.65  = $2,250.00
 *   Net          = Income − Expenses = $5,650.00 − $2,250.00           = $3,400.00  (green, positive)
 *   Savings rate = Net ÷ Income      = 3,400.00 ÷ 5,650.00 = 0.60177…   → "60.2%"
 *   Income of $0 → savings rate shows "N/A" (no division by zero).
 *
 *   Budget bar: Groceries $412.35 spent of a $500.00 budget = 82.47% → "82%", amber (80–100%).
 *               Under 80% is green; over 100% is red and shows "Over by $X".
 * ---------------------------------------------------------------------------
 *
 * Sections: constants · state · utils · storage · data operations · rendering ·
 *           charts · modals · events · init
 */
(function () {
  'use strict';

  // ==========================================================================
  // CONSTANTS
  // ==========================================================================

  const STORAGE_KEYS = {
    transactions: 'budgetly.transactions',
    customCategories: 'budgetly.customCategories',
    budgets: 'budgetly.budgets',
    theme: 'budgetly.theme',
  };

  const DEFAULT_CATEGORIES = [
    { id: 'salary', name: 'Salary', type: 'income', color: '#16a34a' },
    { id: 'freelance', name: 'Freelance', type: 'income', color: '#0891b2' },
    { id: 'gifts', name: 'Gifts', type: 'income', color: '#db2777' },
    { id: 'other-income', name: 'Other Income', type: 'income', color: '#65a30d' },
    { id: 'rent', name: 'Rent', type: 'expense', color: '#6366f1' },
    { id: 'groceries', name: 'Groceries', type: 'expense', color: '#22c55e' },
    { id: 'dining-out', name: 'Dining Out', type: 'expense', color: '#f97316' },
    { id: 'transportation', name: 'Transportation', type: 'expense', color: '#0ea5e9' },
    { id: 'utilities', name: 'Utilities', type: 'expense', color: '#eab308' },
    { id: 'entertainment', name: 'Entertainment', type: 'expense', color: '#a855f7' },
    { id: 'shopping', name: 'Shopping', type: 'expense', color: '#ec4899' },
    { id: 'health', name: 'Health', type: 'expense', color: '#14b8a6' },
    { id: 'subscriptions', name: 'Subscriptions', type: 'expense', color: '#ef4444' },
    { id: 'other', name: 'Other', type: 'expense', color: '#94a3b8' },
  ].map(function (c) { return Object.assign({ isDefault: true }, c); });

  // Where transactions go when their custom category is deleted
  const FALLBACK_CATEGORY = { income: 'other-income', expense: 'other' };

  // Fixed palette for custom categories (assigned once, then stored with the category)
  const CUSTOM_COLORS = ['#0d9488', '#c026d3', '#84cc16', '#f59e0b', '#3b82f6', '#be123c', '#7c3aed', '#059669', '#d97706', '#2563eb'];

  const SAMPLE_BUDGETS = {
    groceries: 50000,
    'dining-out': 20000,
    transportation: 15000,
    utilities: 30000,
    entertainment: 10000,
    shopping: 15000,
    health: 8000,
    subscriptions: 3000,
  };

  const NOTE_MAX = 100;
  const CATEGORY_NAME_MAX = 30;
  const MAX_CENTS = 99999999999; // $999,999,999.99

  const DESKTOP_QUERY = window.matchMedia('(min-width: 1024px)');
  const DARK_QUERY = window.matchMedia('(prefers-color-scheme: dark)');
  const REDUCED_MOTION = window.matchMedia('(prefers-reduced-motion: reduce)');

  // ==========================================================================
  // STATE
  // ==========================================================================

  const today = new Date();
  const state = {
    transactions: [],        // { id, type, amountCents, categoryId, date: 'YYYY-MM-DD', note, createdAt }
    customCategories: [],    // { id, name, type, color }
    budgets: {},             // { [expenseCategoryId]: cents }
    theme: 'system',         // 'light' | 'dark' | 'system'
    month: { year: today.getFullYear(), month: today.getMonth() }, // month is 0–11
    filters: { type: 'all', categoryId: 'all', search: '' },
    editingId: null,
    storageOK: true,
  };

  const charts = { donut: null, bar: null };
  const dom = {};

  // ==========================================================================
  // UTILS
  // ==========================================================================

  const usd = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD' });
  const usdCompact = new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', notation: 'compact', maximumFractionDigits: 1 });
  const monthYearFmt = new Intl.DateTimeFormat('en-US', { month: 'long', year: 'numeric' });
  const shortMonthFmt = new Intl.DateTimeFormat('en-US', { month: 'short' });
  const dateFmt = new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', year: 'numeric' });

  function formatMoney(cents) { return usd.format(cents / 100); }
  function centsToPlain(cents) { return (cents / 100).toFixed(2); }
  function formatPercent(ratio) { return (ratio * 100).toFixed(1) + '%'; }
  function pad(n) { return String(n).padStart(2, '0'); }
  function plural(n, word) { return n + ' ' + word + (n === 1 ? '' : 's'); }

  /** Local-time YYYY-MM-DD (never toISOString, which converts to UTC). */
  function toISODate(d) { return d.getFullYear() + '-' + pad(d.getMonth() + 1) + '-' + pad(d.getDate()); }
  function todayISO() { return toISODate(new Date()); }

  /** Parse YYYY-MM-DD as a LOCAL date. Returns null for malformed or impossible dates (e.g. 2026-02-30). */
  function parseLocalDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return null;
    const y = Number(m[1]), mo = Number(m[2]) - 1, d = Number(m[3]);
    const date = new Date(y, mo, d);
    if (date.getFullYear() !== y || date.getMonth() !== mo || date.getDate() !== d) return null;
    return date;
  }

  function formatDate(iso) { const d = parseLocalDate(iso); return d ? dateFmt.format(d) : iso; }
  function monthKey(ym) { return ym.year + '-' + pad(ym.month + 1); }
  function addMonths(ym, delta) { const d = new Date(ym.year, ym.month + delta, 1); return { year: d.getFullYear(), month: d.getMonth() }; }
  function monthLabel(ym) { return monthYearFmt.format(new Date(ym.year, ym.month, 1)); }
  function isCurrentMonth(ym) { const n = new Date(); return ym.year === n.getFullYear() && ym.month === n.getMonth(); }

  /**
   * Validate a money string. Accepts "42", "42.5", "1,250.00".
   * Returns { cents } or { error }.
   */
  function parseAmount(raw) {
    let s = String(raw || '').trim();
    if (!s) return { error: 'Amount is required.' };
    if (s.indexOf(',') !== -1) {
      if (!/^\d{1,3}(,\d{3})+(\.\d*)?$/.test(s)) return { error: 'Enter a valid number, e.g. 1,250.00.' };
      s = s.replace(/,/g, '');
    }
    if (!/^-?(\d+\.?\d*|\.\d+)$/.test(s)) return { error: 'Enter a valid number, e.g. 42.50.' };
    if (s.charAt(0) === '-') return { error: 'Amount must be greater than 0.' };
    const parts = s.split('.');
    const frac = parts[1] || '';
    if (frac.length > 2) return { error: 'Use at most 2 decimal places.' };
    const cents = parseInt(parts[0] || '0', 10) * 100 + parseInt((frac + '00').slice(0, 2), 10);
    if (!(cents > 0)) return { error: 'Amount must be greater than 0.' };
    if (cents > MAX_CENTS) return { error: 'Amount is too large.' };
    return { cents: cents };
  }

  function uid() {
    try {
      if (window.crypto && typeof window.crypto.randomUUID === 'function') return window.crypto.randomUUID();
    } catch (e) { /* fall through */ }
    return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  /** Small DOM builder. Text is always set via textContent, so user input is never parsed as HTML. */
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      Object.keys(attrs).forEach(function (key) {
        const value = attrs[key];
        if (value === null || value === undefined || value === false) return;
        if (key === 'class') node.className = value;
        else if (key === 'text') node.textContent = value;
        else if (key === 'style') Object.keys(value).forEach(function (p) { node.style.setProperty(p, value[p]); });
        else node.setAttribute(key, value === true ? '' : value);
      });
    }
    (children || []).forEach(function (child) { if (child !== null && child !== undefined) node.append(child); });
    return node;
  }

  function dot(color) { return el('span', { class: 'dot', 'aria-hidden': 'true', style: { '--dot': color } }); }

  function svgIcon(path) {
    const ns = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(ns, 'svg');
    svg.setAttribute('viewBox', '0 0 24 24');
    svg.setAttribute('width', '18');
    svg.setAttribute('height', '18');
    svg.setAttribute('aria-hidden', 'true');
    const p = document.createElementNS(ns, 'path');
    p.setAttribute('d', path);
    p.setAttribute('fill', 'none');
    p.setAttribute('stroke', 'currentColor');
    p.setAttribute('stroke-width', '2');
    p.setAttribute('stroke-linecap', 'round');
    p.setAttribute('stroke-linejoin', 'round');
    svg.appendChild(p);
    return svg;
  }
  const ICON_EDIT = 'M12 20h9M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z';
  const ICON_TRASH = 'M3 6h18M8 6V4h8v2M6 6l1 14h10l1-14';
  const ICON_X = 'M7 7l10 10M17 7L7 17';

  function cssVar(name) { return getComputedStyle(document.documentElement).getPropertyValue(name).trim(); }

  // Seeded RNG so sample data looks the same every time for a given month
  function mulberry32(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  // ==========================================================================
  // STORAGE (every access wrapped in try/catch so blocked storage never breaks the app)
  // ==========================================================================

  function storageAvailable() {
    try {
      const key = 'budgetly.__test__';
      window.localStorage.setItem(key, '1');
      window.localStorage.removeItem(key);
      return true;
    } catch (e) {
      return false;
    }
  }

  function storageHas(key) {
    try { return window.localStorage.getItem(key) !== null; } catch (e) { return false; }
  }

  function storageGet(key, fallback) {
    try {
      const raw = window.localStorage.getItem(key);
      return raw === null ? fallback : JSON.parse(raw);
    } catch (e) {
      return fallback;
    }
  }

  function storageSet(key, value) {
    try {
      window.localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (e) {
      return false;
    }
  }

  function saveTransactions() { storageSet(STORAGE_KEYS.transactions, state.transactions); }
  function saveCategories() { storageSet(STORAGE_KEYS.customCategories, state.customCategories); }
  function saveBudgets() { storageSet(STORAGE_KEYS.budgets, state.budgets); }
  function saveTheme() { storageSet(STORAGE_KEYS.theme, state.theme); }
  function saveAll() { saveTransactions(); saveCategories(); saveBudgets(); }

  function isValidCustomCategory(c) {
    return c && typeof c.id === 'string' && c.id.indexOf('custom-') === 0 &&
      typeof c.name === 'string' && c.name.trim() !== '' &&
      (c.type === 'income' || c.type === 'expense') &&
      typeof c.color === 'string' && /^#[0-9a-f]{6}$/i.test(c.color);
  }

  /** Clean a stored transaction; returns null if it can't be repaired. */
  function sanitizeTransaction(t) {
    if (!t || typeof t !== 'object') return null;
    if (t.type !== 'income' && t.type !== 'expense') return null;
    if (!Number.isInteger(t.amountCents) || t.amountCents <= 0 || t.amountCents > MAX_CENTS) return null;
    if (!parseLocalDate(t.date)) return null;
    const cat = getCategory(t.categoryId);
    return {
      id: typeof t.id === 'string' && t.id ? t.id : uid(),
      type: t.type,
      amountCents: t.amountCents,
      categoryId: cat && cat.type === t.type ? cat.id : FALLBACK_CATEGORY[t.type],
      date: t.date,
      note: typeof t.note === 'string' ? t.note.slice(0, NOTE_MAX) : '',
      createdAt: Number.isFinite(t.createdAt) ? t.createdAt : 0,
    };
  }

  function sanitizeBudgets(obj) {
    const clean = {};
    if (!obj || typeof obj !== 'object') return clean;
    Object.keys(obj).forEach(function (id) {
      const cat = getCategory(id);
      const cents = obj[id];
      if (cat && cat.type === 'expense' && Number.isInteger(cents) && cents > 0 && cents <= MAX_CENTS) clean[id] = cents;
    });
    return clean;
  }

  /** Load everything from storage. Returns true when sample data was auto-loaded (first visit). */
  function loadState() {
    state.storageOK = storageAvailable();

    const theme = storageGet(STORAGE_KEYS.theme, 'system');
    state.theme = ['light', 'dark', 'system'].indexOf(theme) !== -1 ? theme : 'system';

    const custom = storageGet(STORAGE_KEYS.customCategories, []);
    state.customCategories = Array.isArray(custom) ? custom.filter(isValidCustomCategory) : [];

    state.budgets = sanitizeBudgets(storageGet(STORAGE_KEYS.budgets, {}));

    if (!storageHas(STORAGE_KEYS.transactions)) {
      // First visit (or storage blocked): start with demo data
      state.transactions = buildSampleTransactions();
      state.budgets = Object.assign({}, SAMPLE_BUDGETS);
      saveAll();
      return true;
    }

    const stored = storageGet(STORAGE_KEYS.transactions, []);
    state.transactions = Array.isArray(stored) ? stored.map(sanitizeTransaction).filter(Boolean) : [];
    return false;
  }

  // ==========================================================================
  // DATA OPERATIONS (categories, transactions, selectors, sample data, CSV)
  // ==========================================================================

  function allCategories() { return DEFAULT_CATEGORIES.concat(state.customCategories); }
  function getCategory(id) { return allCategories().find(function (c) { return c.id === id; }) || null; }
  function categoriesOfType(type) { return allCategories().filter(function (c) { return c.type === type; }); }
  function categoryOrFallback(id, type) { return getCategory(id) || getCategory(FALLBACK_CATEGORY[type]); }

  function addTransaction(data) {
    state.transactions.push(Object.assign({ id: uid(), createdAt: Date.now() }, data));
    saveTransactions();
  }

  function updateTransaction(id, data) {
    const tx = state.transactions.find(function (t) { return t.id === id; });
    if (!tx) return false;
    Object.assign(tx, data);
    saveTransactions();
    return true;
  }

  function deleteTransaction(id) {
    state.transactions = state.transactions.filter(function (t) { return t.id !== id; });
    saveTransactions();
  }

  function addCustomCategory(name, type) {
    const used = state.customCategories.map(function (c) { return c.color; });
    const color = CUSTOM_COLORS.find(function (c) { return used.indexOf(c) === -1; }) ||
      CUSTOM_COLORS[state.customCategories.length % CUSTOM_COLORS.length];
    const cat = { id: 'custom-' + uid(), name: name, type: type, color: color };
    state.customCategories.push(cat);
    saveCategories();
    return cat;
  }

  /** Delete a custom category; its transactions move to Other / Other Income. Returns how many moved. */
  function deleteCustomCategory(id) {
    const cat = getCategory(id);
    if (!cat || cat.isDefault) return 0;
    const fallback = FALLBACK_CATEGORY[cat.type];
    let moved = 0;
    state.transactions.forEach(function (t) {
      if (t.categoryId === id) { t.categoryId = fallback; moved++; }
    });
    state.customCategories = state.customCategories.filter(function (c) { return c.id !== id; });
    delete state.budgets[id];
    if (state.filters.categoryId === id) state.filters.categoryId = 'all';
    saveAll();
    return moved;
  }

  function countTransactionsInCategory(id) {
    return state.transactions.filter(function (t) { return t.categoryId === id; }).length;
  }

  function monthTransactions(ym) {
    const key = monthKey(ym);
    return state.transactions.filter(function (t) { return t.date.slice(0, 7) === key; });
  }

  function summarize(list) {
    let income = 0;
    let expense = 0;
    list.forEach(function (t) {
      if (t.type === 'income') income += t.amountCents;
      else expense += t.amountCents;
    });
    const net = income - expense;
    return { income: income, expense: expense, net: net, savingsRate: income > 0 ? net / income : null };
  }

  /** [{ category, cents }] for expenses, largest first. */
  function expensesByCategory(list) {
    const totals = new Map();
    list.forEach(function (t) {
      if (t.type !== 'expense') return;
      totals.set(t.categoryId, (totals.get(t.categoryId) || 0) + t.amountCents);
    });
    return Array.from(totals.entries())
      .map(function (entry) { return { category: categoryOrFallback(entry[0], 'expense'), cents: entry[1] }; })
      .sort(function (a, b) { return b.cents - a.cents; });
  }

  function newestFirst(a, b) {
    if (a.date !== b.date) return a.date < b.date ? 1 : -1;
    return (b.createdAt || 0) - (a.createdAt || 0);
  }

  function applyFilters(list) {
    const f = state.filters;
    const q = f.search.trim().toLowerCase();
    return list.filter(function (t) {
      if (f.type !== 'all' && t.type !== f.type) return false;
      if (f.categoryId !== 'all' && t.categoryId !== f.categoryId) return false;
      if (q && (t.note || '').toLowerCase().indexOf(q) === -1) return false;
      return true;
    }).sort(newestFirst);
  }

  function filtersActive() {
    return state.filters.type !== 'all' || state.filters.categoryId !== 'all' || state.filters.search.trim() !== '';
  }

  /** Realistic demo data for the current month and the 5 before it (no future-dated entries). */
  function buildSampleTransactions() {
    const now = new Date();
    const todayStr = toISODate(now);
    const base = { year: now.getFullYear(), month: now.getMonth() };
    const list = [];
    let seq = 0;

    for (let back = 5; back >= 0; back--) {
      const ym = addMonths(base, -back);
      const rand = mulberry32(ym.year * 12 + ym.month + 11);
      const daysInMonth = new Date(ym.year, ym.month + 1, 0).getDate();
      const between = function (min, max) { return Math.round((min + rand() * (max - min)) * 100); };
      const pick = function (arr) { return arr[Math.floor(rand() * arr.length)]; };
      const randomDay = function () { return 1 + Math.floor(rand() * daysInMonth); };
      const add = function (day, type, categoryId, cents, note) {
        const date = ym.year + '-' + pad(ym.month + 1) + '-' + pad(Math.min(day, daysInMonth));
        if (date > todayStr) return;
        list.push({ id: uid(), type: type, amountCents: cents, categoryId: categoryId, date: date, note: note, createdAt: Date.now() + seq++ });
      };

      // Income
      add(1, 'income', 'salary', 260000, 'Paycheck');
      add(15, 'income', 'salary', 260000, 'Paycheck');
      if (back % 2 === 0) add(8 + Math.floor(rand() * 12), 'income', 'freelance', between(350, 900), pick(['Logo design project', 'Website fixes for client', 'Consulting session']));
      if (back === 3) add(12, 'income', 'gifts', 15000, 'Birthday gift from family');
      if (back === 4) add(20, 'income', 'other-income', 4823, 'Credit card cashback');

      // Fixed expenses
      add(1, 'expense', 'rent', 165000, 'Monthly rent');
      add(3, 'expense', 'health', 4000, 'Gym membership');
      add(5, 'expense', 'subscriptions', 1549, 'Netflix');
      add(8, 'expense', 'subscriptions', 1199, 'Spotify');
      add(20, 'expense', 'subscriptions', 299, 'iCloud storage');
      add(12, 'expense', 'utilities', between(95, 165), 'Electric bill');
      add(18, 'expense', 'utilities', 6999, 'Internet');
      add(22, 'expense', 'utilities', between(28, 45), 'Water bill');

      // Weekly groceries
      [2, 9, 16, 23].forEach(function (d) {
        add(d + Math.floor(rand() * 2), 'expense', 'groceries', between(85, 135), pick(['Publix', 'Trader Joe\'s', 'Whole Foods', 'Costco run', 'Aldi']));
      });

      // Variable spending
      const diningCount = 3 + Math.floor(rand() * 3);
      for (let i = 0; i < diningCount; i++) add(randomDay(), 'expense', 'dining-out', between(18, 62), pick(['Chipotle', 'Sushi night', 'Brunch with friends', 'Pizza delivery', 'Coffee & pastries', 'Thai takeout']));

      add(4, 'expense', 'transportation', between(38, 55), 'Gas');
      add(19, 'expense', 'transportation', between(38, 55), 'Gas');
      if (rand() > 0.4) add(randomDay(), 'expense', 'transportation', between(14, 32), 'Uber ride');

      const funCount = 1 + Math.floor(rand() * 2);
      for (let i = 0; i < funCount; i++) add(randomDay(), 'expense', 'entertainment', between(15, 85), pick(['Movie tickets', 'Concert tickets', 'Bowling night', 'New video game', 'Mini golf']));

      const shopCount = 1 + Math.floor(rand() * 3);
      for (let i = 0; i < shopCount; i++) add(randomDay(), 'expense', 'shopping', between(20, 140), pick(['Amazon order', 'Target', 'New sneakers', 'Home decor', 'Clothes']));

      if (rand() > 0.5) add(randomDay(), 'expense', 'health', between(15, 60), 'Pharmacy');
      if (rand() > 0.5) add(randomDay(), 'expense', 'other', between(15, 45), pick(['Haircut', 'Dry cleaning', 'Pet supplies']));
    }
    return list;
  }

  function csvField(value, guardFormula) {
    let s = String(value === null || value === undefined ? '' : value);
    // Prevent spreadsheet formula injection from user-entered text
    if (guardFormula && /^[=+\-@\t\r]/.test(s)) s = "'" + s;
    if (/[",\r\n]/.test(s)) s = '"' + s.replace(/"/g, '""') + '"';
    return s;
  }

  function buildCsv() {
    const rows = [['date', 'type', 'category', 'amount', 'note'].join(',')];
    state.transactions.slice().sort(newestFirst).forEach(function (t) {
      const cat = categoryOrFallback(t.categoryId, t.type);
      rows.push([
        t.date,
        t.type === 'income' ? 'Income' : 'Expense',
        csvField(cat.name, true),
        centsToPlain(t.amountCents),
        csvField(t.note, true),
      ].join(','));
    });
    return rows.join('\r\n') + '\r\n';
  }

  // ==========================================================================
  // RENDERING
  // ==========================================================================

  function cacheDom() {
    [
      'month-label', 'prev-month', 'next-month', 'today-btn', 'storage-banner',
      'stat-income', 'stat-income-sub', 'stat-expense', 'stat-expense-sub', 'stat-net', 'stat-net-sub', 'stat-rate', 'stat-rate-sub',
      'donut-chart', 'donut-content', 'donut-empty', 'donut-legend', 'donut-total', 'donut-subtitle',
      'bar-chart', 'bar-content', 'bar-empty', 'bar-subtitle', 'chart-fallback',
      'top-list', 'top-empty', 'top-subtitle',
      'budget-list', 'budgets-summary',
      'tx-heading', 'tx-count', 'tx-list', 'tx-empty', 'tx-empty-title', 'tx-empty-text', 'clear-filters-btn', 'add-tx-btn',
      'filter-category', 'filter-search',
      'tx-panel', 'panel-close', 'form-title', 'tx-form', 'tx-amount', 'tx-category', 'tx-date', 'tx-note', 'tx-note-count',
      'tx-amount-error', 'tx-category-error', 'tx-date-error', 'tx-note-error', 'tx-cancel', 'tx-submit',
      'category-list', 'category-form', 'cat-name', 'cat-type', 'cat-name-error',
      'export-btn', 'sample-btn', 'reset-btn',
      'backdrop', 'confirm-dialog', 'confirm-title', 'confirm-message', 'confirm-ok', 'confirm-cancel', 'toast-region',
    ].forEach(function (id) {
      dom[id.replace(/-([a-z])/g, function (_, c) { return c.toUpperCase(); })] = document.getElementById(id);
    });
  }

  function renderAll() {
    // Keep keyboard focus on the same control after re-rendering lists
    const activeId = document.activeElement && document.activeElement.id;
    const list = monthTransactions(state.month);

    renderMonthNav();
    renderSummary(list);
    renderCharts(list);
    renderTopCategories(list);
    renderBudgets(list);
    renderFilterOptions();
    renderTransactions(list);
    renderCategories();

    if (activeId && document.activeElement && document.activeElement.id !== activeId) {
      const again = document.getElementById(activeId);
      if (again) again.focus({ preventScroll: true });
    }
  }

  function renderMonthNav() {
    const label = monthLabel(state.month);
    dom.monthLabel.textContent = label;
    dom.todayBtn.hidden = isCurrentMonth(state.month);
    const short = isCurrentMonth(state.month) ? 'This month' : label;
    dom.donutSubtitle.textContent = short;
    dom.topSubtitle.textContent = short;
    dom.barSubtitle.textContent = 'Last 6 months · ending ' + label;
  }

  function renderSummary(list) {
    const s = summarize(list);
    const incomeCount = list.filter(function (t) { return t.type === 'income'; }).length;
    const expenseCount = list.length - incomeCount;

    dom.statIncome.textContent = formatMoney(s.income);
    dom.statIncomeSub.textContent = incomeCount + (incomeCount === 1 ? ' entry' : ' entries');
    dom.statExpense.textContent = formatMoney(s.expense);
    dom.statExpenseSub.textContent = expenseCount + (expenseCount === 1 ? ' entry' : ' entries');

    dom.statNet.textContent = formatMoney(s.net);
    dom.statNet.className = 'stat-value' + (s.net > 0 ? ' positive' : s.net < 0 ? ' negative' : '');
    dom.statNetSub.textContent = s.net > 0 ? 'Surplus' : s.net < 0 ? 'Deficit' : 'Break-even';

    dom.statRate.textContent = s.savingsRate === null ? 'N/A' : formatPercent(s.savingsRate);
    dom.statRateSub.textContent = s.savingsRate === null ? 'No income this month' : 'Net ÷ income';
  }

  function renderTopCategories(list) {
    const rows = expensesByCategory(list);
    const total = rows.reduce(function (sum, r) { return sum + r.cents; }, 0);
    dom.topEmpty.hidden = rows.length > 0;
    dom.topList.hidden = rows.length === 0;
    dom.topList.replaceChildren.apply(dom.topList, rows.slice(0, 3).map(function (r, i) {
      const share = r.cents / total;
      return el('li', { class: 'top-item' }, [
        el('span', { class: 'top-rank', text: String(i + 1), 'aria-hidden': 'true' }),
        el('span', { class: 'top-name' }, [dot(r.category.color), el('span', { text: r.category.name })]),
        el('span', { class: 'top-amount', text: formatMoney(r.cents) }),
        el('span', { class: 'top-meter' }, [
          el('span', { class: 'track', 'aria-hidden': 'true' }, [
            el('span', { class: 'fill', style: { width: (share * 100).toFixed(1) + '%', '--dot': r.category.color } }),
          ]),
          el('small', { text: formatPercent(share) }),
        ]),
      ]);
    }));
  }

  function renderBudgets(list) {
    const spentBy = new Map(expensesByCategory(list).map(function (r) { return [r.category.id, r.cents]; }));
    let budgetedTotal = 0;
    let budgetedSpent = 0;

    const items = categoriesOfType('expense').map(function (cat) {
      const spent = spentBy.get(cat.id) || 0;
      const budget = state.budgets[cat.id] || 0;
      const inputId = 'budget-' + cat.id;
      const errorId = inputId + '-error';
      const children = [
        el('div', { class: 'budget-top' }, [
          el('span', { class: 'budget-name' }, [dot(cat.color), el('span', { text: cat.name })]),
          el('div', { class: 'budget-input' }, [
            el('label', { class: 'sr-only', for: inputId, text: 'Monthly budget for ' + cat.name }),
            el('div', { class: 'input-prefix' }, [
              el('span', { 'aria-hidden': 'true', text: '$' }),
              el('input', {
                id: inputId, class: 'input', type: 'text', inputmode: 'decimal', autocomplete: 'off',
                placeholder: 'No limit', value: budget ? centsToPlain(budget) : '',
                'data-budget-for': cat.id, 'aria-describedby': errorId,
              }),
            ]),
          ]),
        ]),
      ];

      if (budget) {
        budgetedTotal += budget;
        budgetedSpent += spent;
        const pct = (spent / budget) * 100;
        const level = pct > 100 ? 'over' : pct >= 80 ? 'warn' : 'ok';
        const remaining = budget - spent;
        children.push(
          el('p', { class: 'budget-spent' }, [el('strong', { text: formatMoney(spent) }), ' of ' + formatMoney(budget)]),
          el('div', {
            class: 'track', role: 'progressbar', 'aria-label': cat.name + ' budget used',
            'aria-valuemin': '0', 'aria-valuemax': '100', 'aria-valuenow': String(Math.min(100, Math.round(pct))),
            'aria-valuetext': Math.round(pct) + '% of budget used',
          }, [el('div', { class: 'fill ' + level, style: { width: Math.min(100, pct).toFixed(1) + '%' } })]),
          el('p', { class: 'budget-status' }, [
            el('span', { class: 'status-' + level, text: Math.round(pct) + '% used' }),
            el('span', {
              class: remaining < 0 ? 'status-over' : '',
              text: remaining < 0 ? 'Over by ' + formatMoney(-remaining) : formatMoney(remaining) + ' left',
            }),
          ])
        );
      } else {
        children.push(el('p', { class: 'budget-spent' }, [el('strong', { text: formatMoney(spent) }), ' spent · no budget set']));
      }
      children.push(el('p', { class: 'field-error', id: errorId }));
      return el('div', { class: 'card budget-item' }, children);
    });

    dom.budgetList.replaceChildren.apply(dom.budgetList, items);
    dom.budgetsSummary.textContent = budgetedTotal
      ? formatMoney(budgetedSpent) + ' spent of ' + formatMoney(budgetedTotal) + ' budgeted in ' + monthLabel(state.month) + '. Budgets apply to every month.'
      : 'Set a monthly limit on any expense category to track your progress.';
  }

  function fillCategorySelect(select, categories, selected, placeholder) {
    const options = [];
    if (placeholder) options.push(el('option', { value: placeholder.value, text: placeholder.label }));
    categories.forEach(function (c) { options.push(el('option', { value: c.id, text: c.name })); });
    select.replaceChildren.apply(select, options);
    const valid = categories.some(function (c) { return c.id === selected; });
    select.value = valid ? selected : (placeholder ? placeholder.value : '');
    return select.value;
  }

  function renderFilterOptions() {
    const type = state.filters.type;
    const cats = type === 'all' ? allCategories() : categoriesOfType(type);
    state.filters.categoryId = fillCategorySelect(dom.filterCategory, cats, state.filters.categoryId, { value: 'all', label: 'All categories' });
  }

  function renderTransactions(monthList) {
    const items = applyFilters(monthList);
    const label = monthLabel(state.month);

    dom.txList.replaceChildren.apply(dom.txList, items.map(transactionItem));
    dom.txCount.textContent = filtersActive()
      ? 'Showing ' + items.length + ' of ' + plural(monthList.length, 'transaction') + ' in ' + label
      : plural(monthList.length, 'transaction') + ' in ' + label;

    const empty = items.length === 0;
    dom.txEmpty.hidden = !empty;
    dom.txList.hidden = empty;
    if (empty) {
      const noData = monthList.length === 0;
      dom.txEmptyTitle.textContent = noData ? 'No transactions in ' + label : 'No matching transactions';
      dom.txEmptyText.textContent = noData
        ? 'Add your first income or expense for this month to get started.'
        : 'Try a different type, category, or search term.';
      dom.clearFiltersBtn.hidden = noData;
    }
  }

  function transactionItem(t) {
    const cat = categoryOrFallback(t.categoryId, t.type);
    const sign = t.type === 'income' ? '+' : '−';
    const amountText = sign + formatMoney(t.amountCents);
    const desc = cat.name + ' ' + (t.type === 'income' ? 'income' : 'expense') + ' of ' + formatMoney(t.amountCents) + ' on ' + formatDate(t.date);
    const meta = formatDate(t.date) + (t.note ? ' · ' + t.note : '');
    return el('li', { class: 'tx-item' + (state.editingId === t.id ? ' is-editing' : '') }, [
      el('div', { class: 'tx-main' }, [
        el('div', { class: 'tx-cat' }, [dot(cat.color), el('span', { text: cat.name })]),
        el('div', { class: 'tx-meta', title: meta, text: meta }),
      ]),
      el('div', { class: 'tx-amount ' + t.type }, [
        el('span', { 'aria-hidden': 'true', text: amountText }),
        el('span', { class: 'sr-only', text: (t.type === 'income' ? 'Income ' : 'Expense ') + formatMoney(t.amountCents) }),
      ]),
      el('div', { class: 'tx-actions' }, [
        el('button', { type: 'button', class: 'icon-btn', 'data-action': 'edit', 'data-id': t.id, 'aria-label': 'Edit ' + desc }, [svgIcon(ICON_EDIT)]),
        el('button', { type: 'button', class: 'icon-btn danger', 'data-action': 'delete', 'data-id': t.id, 'aria-label': 'Delete ' + desc }, [svgIcon(ICON_TRASH)]),
      ]),
    ]);
  }

  function renderCategories() {
    const groups = [['income', 'Income'], ['expense', 'Expense']].map(function (g) {
      const chips = categoriesOfType(g[0]).map(function (c) {
        const children = [dot(c.color), el('span', { class: 'chip-name', text: c.name })];
        if (!c.isDefault) {
          children.push(el('button', {
            type: 'button', class: 'chip-delete', 'data-delete-category': c.id, 'aria-label': 'Delete category ' + c.name,
          }, [svgIcon(ICON_X)]));
        }
        return el('li', { class: 'chip' + (c.isDefault ? '' : ' custom') }, children);
      });
      return el('div', { class: 'category-group' }, [
        el('h3', { text: g[1] }),
        el('ul', { class: 'chips', 'aria-label': g[1] + ' categories' }, chips),
      ]);
    });
    dom.categoryList.replaceChildren.apply(dom.categoryList, groups);
  }

  // ---------- Transaction form ----------

  function getFormType() {
    const checked = dom.txForm.querySelector('input[name="type"]:checked');
    return checked ? checked.value : 'expense';
  }

  function setFormType(type) {
    const radio = dom.txForm.querySelector('input[name="type"][value="' + type + '"]');
    if (radio) radio.checked = true;
  }

  function populateFormCategories(selected) {
    fillCategorySelect(dom.txCategory, categoriesOfType(getFormType()), selected, { value: '', label: 'Select a category' });
  }

  function setFieldError(input, errorEl, message) {
    errorEl.textContent = message || '';
    if (message) input.setAttribute('aria-invalid', 'true');
    else input.removeAttribute('aria-invalid');
  }

  function clearFormErrors() {
    setFieldError(dom.txAmount, dom.txAmountError, '');
    setFieldError(dom.txCategory, dom.txCategoryError, '');
    setFieldError(dom.txDate, dom.txDateError, '');
    setFieldError(dom.txNote, dom.txNoteError, '');
  }

  function updateNoteCount() {
    dom.txNoteCount.textContent = dom.txNote.value.length + '/' + NOTE_MAX;
  }

  function resetForm() {
    state.editingId = null;
    dom.txForm.reset();
    clearFormErrors();
    dom.formTitle.textContent = 'Add transaction';
    dom.txSubmit.textContent = 'Add transaction';
    setFormType('expense');
    populateFormCategories('');
    dom.txDate.value = todayISO();
    updateNoteCount();
  }

  function fillFormForEdit(tx) {
    state.editingId = tx.id;
    clearFormErrors();
    dom.formTitle.textContent = 'Edit transaction';
    dom.txSubmit.textContent = 'Save changes';
    setFormType(tx.type);
    populateFormCategories(tx.categoryId);
    dom.txAmount.value = centsToPlain(tx.amountCents);
    dom.txDate.value = tx.date;
    dom.txNote.value = tx.note || '';
    updateNoteCount();
  }

  /** Validate the transaction form. Returns the data object or null (with inline errors shown). */
  function readTransactionForm() {
    clearFormErrors();
    const type = getFormType();
    const errors = [];

    const amount = parseAmount(dom.txAmount.value);
    if (amount.error) errors.push([dom.txAmount, dom.txAmountError, amount.error]);

    const cat = getCategory(dom.txCategory.value);
    if (!dom.txCategory.value) errors.push([dom.txCategory, dom.txCategoryError, 'Category is required.']);
    else if (!cat || cat.type !== type) errors.push([dom.txCategory, dom.txCategoryError, 'Choose a category that matches the type.']);

    if (!dom.txDate.value) errors.push([dom.txDate, dom.txDateError, 'Date is required.']);
    else if (!parseLocalDate(dom.txDate.value)) errors.push([dom.txDate, dom.txDateError, 'Enter a valid date.']);

    const note = dom.txNote.value.trim();
    if (note.length > NOTE_MAX) errors.push([dom.txNote, dom.txNoteError, 'Note must be ' + NOTE_MAX + ' characters or fewer.']);

    if (errors.length) {
      errors.forEach(function (e) { setFieldError(e[0], e[1], e[2]); });
      errors[0][0].focus();
      return null;
    }
    return { type: type, amountCents: amount.cents, categoryId: cat.id, date: dom.txDate.value, note: note };
  }

  // ---------- Toasts ----------

  function toast(message) {
    const node = el('div', { class: 'toast', text: message });
    dom.toastRegion.append(node);
    setTimeout(function () { node.remove(); }, 3200);
  }

  // ==========================================================================
  // CHARTS (Chart.js 4 from cdnjs; colors are read from CSS variables so they follow the theme)
  // ==========================================================================

  function chartsAvailable() { return typeof window.Chart !== 'undefined'; }

  function chartColors() {
    return {
      text: cssVar('--text'),
      muted: cssVar('--text-muted'),
      grid: cssVar('--chart-grid'),
      surface: cssVar('--surface'),
      income: cssVar('--chart-income'),
      expense: cssVar('--chart-expense'),
      tooltipBg: cssVar('--tooltip-bg'),
      tooltipText: cssVar('--tooltip-text'),
    };
  }

  function tooltipOptions(c, labelCallback, titleCallback) {
    const callbacks = { label: labelCallback };
    if (titleCallback) callbacks.title = titleCallback;
    return {
      backgroundColor: c.tooltipBg,
      titleColor: c.tooltipText,
      bodyColor: c.tooltipText,
      borderColor: c.grid,
      borderWidth: 1,
      padding: 10,
      cornerRadius: 8,
      boxPadding: 4,
      titleFont: { family: 'Inter', weight: '600' },
      bodyFont: { family: 'Inter' },
      callbacks: callbacks,
    };
  }

  function upsertChart(key, canvas, config) {
    if (charts[key]) {
      charts[key].data = config.data;
      charts[key].options = config.options;
      charts[key].update();
    } else {
      charts[key] = new window.Chart(canvas, config);
    }
  }

  function destroyChart(key) {
    if (charts[key]) { charts[key].destroy(); charts[key] = null; }
  }

  function destroyAllCharts() { destroyChart('donut'); destroyChart('bar'); }

  function renderCharts(list) {
    const ok = chartsAvailable();
    dom.chartFallback.hidden = ok;
    if (ok) window.Chart.defaults.font.family = "'Inter', system-ui, sans-serif";
    renderDonut(list, ok);
    renderBar(ok);
  }

  function renderDonut(list, ok) {
    const rows = expensesByCategory(list);
    const total = rows.reduce(function (sum, r) { return sum + r.cents; }, 0);
    const empty = rows.length === 0;

    dom.donutContent.hidden = empty;
    dom.donutEmpty.hidden = !empty;
    if (empty) {
      destroyChart('donut');
      dom.donutLegend.replaceChildren();
      return;
    }

    dom.donutTotal.textContent = formatMoney(total);
    dom.donutLegend.replaceChildren.apply(dom.donutLegend, rows.map(function (r) {
      return el('li', {}, [
        dot(r.category.color),
        el('span', { class: 'name', text: r.category.name }),
        el('span', { class: 'pct', text: formatPercent(r.cents / total) }),
        el('span', { class: 'amt', text: formatMoney(r.cents) }),
      ]);
    }));

    dom.donutChart.setAttribute('aria-label',
      'Donut chart of expenses by category for ' + monthLabel(state.month) + ', total ' + formatMoney(total) + ': ' +
      rows.map(function (r) { return r.category.name + ' ' + formatPercent(r.cents / total); }).join(', ') + '.');

    dom.donutChart.parentElement.hidden = !ok;
    if (!ok) return;

    const c = chartColors();
    upsertChart('donut', dom.donutChart, {
      type: 'doughnut',
      data: {
        labels: rows.map(function (r) { return r.category.name; }),
        datasets: [{
          data: rows.map(function (r) { return r.cents / 100; }),
          backgroundColor: rows.map(function (r) { return r.category.color; }),
          borderColor: c.surface,
          hoverBorderColor: c.surface,
          borderWidth: 3,
          hoverOffset: 6,
        }],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '70%',
        layout: { padding: 6 },
        animation: { duration: REDUCED_MOTION.matches ? 0 : 500 },
        plugins: {
          legend: { display: false },
          tooltip: tooltipOptions(c, function (ctx) {
            const cents = rows[ctx.dataIndex].cents;
            return ' ' + ctx.label + ': ' + formatMoney(cents) + ' (' + formatPercent(cents / total) + ')';
          }),
        },
      },
    });
  }

  function renderBar(ok) {
    const months = [];
    for (let i = 5; i >= 0; i--) months.push(addMonths(state.month, -i));
    const sums = months.map(function (m) { return summarize(monthTransactions(m)); });
    const empty = sums.every(function (s) { return s.income === 0 && s.expense === 0; });

    dom.barContent.hidden = empty || !ok;
    dom.barEmpty.hidden = !empty;
    if (empty) { destroyChart('bar'); return; }

    dom.barChart.setAttribute('aria-label',
      'Bar chart of income versus expenses for the 6 months ending ' + monthLabel(state.month) + ': ' +
      months.map(function (m, i) {
        return monthLabel(m) + ' income ' + formatMoney(sums[i].income) + ', expenses ' + formatMoney(sums[i].expense);
      }).join('; ') + '.');

    if (!ok) return;

    const c = chartColors();
    const dataset = function (label, color, key) {
      return {
        label: label,
        data: sums.map(function (s) { return s[key] / 100; }),
        backgroundColor: color,
        hoverBackgroundColor: color,
        borderRadius: 6,
        maxBarThickness: 28,
        categoryPercentage: 0.7,
        barPercentage: 0.9,
      };
    };

    upsertChart('bar', dom.barChart, {
      type: 'bar',
      data: {
        labels: months.map(function (m) { return shortMonthFmt.format(new Date(m.year, m.month, 1)); }),
        datasets: [dataset('Income', c.income, 'income'), dataset('Expenses', c.expense, 'expense')],
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        animation: { duration: REDUCED_MOTION.matches ? 0 : 500 },
        interaction: { mode: 'index', intersect: false },
        scales: {
          x: {
            grid: { display: false },
            border: { color: c.grid },
            ticks: { color: c.muted, font: { size: 12 } },
          },
          y: {
            beginAtZero: true,
            grid: { color: c.grid },
            border: { display: false },
            ticks: {
              color: c.muted,
              font: { size: 12 },
              maxTicksLimit: 6,
              callback: function (value) { return usdCompact.format(value); },
            },
          },
        },
        plugins: {
          legend: {
            position: 'bottom',
            labels: { color: c.text, usePointStyle: true, pointStyle: 'rectRounded', boxWidth: 10, boxHeight: 10, padding: 16, font: { size: 12, weight: '500' } },
          },
          tooltip: tooltipOptions(c,
            function (ctx) { return ' ' + ctx.dataset.label + ': ' + formatMoney(Math.round(ctx.parsed.y * 100)); },
            function (items) { return items.length ? monthLabel(months[items[0].dataIndex]) : ''; }),
        },
      },
    });
  }

  // ==========================================================================
  // MODALS (focus trap, Escape to close, focus restore)
  // ==========================================================================

  const modalStack = [];
  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]):not([type="hidden"]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

  function focusableIn(node) {
    return Array.prototype.filter.call(node.querySelectorAll(FOCUSABLE), function (n) {
      if (n.getClientRects().length === 0 && !(n.type === 'radio')) return false;
      // Only the checked radio in a group is reachable with Tab
      if (n.type === 'radio' && !n.checked) return false;
      return true;
    });
  }

  function openModal(node, opts) {
    const entry = {
      node: node,
      show: opts.show,
      hide: opts.hide,
      fallbackFocus: opts.fallbackFocus,
      returnFocus: document.activeElement,
    };
    modalStack.push(entry);
    entry.show();
    dom.backdrop.hidden = false;
    dom.backdrop.classList.toggle('over-dialog', modalStack.length > 1);
    document.body.classList.add('modal-open');
    const target = opts.initialFocus || focusableIn(node)[0] || node;
    target.focus();
  }

  function closeModal(node, restoreFocus) {
    const index = modalStack.findIndex(function (m) { return m.node === node; });
    if (index === -1) return;
    const entry = modalStack.splice(index, 1)[0];
    entry.hide();
    if (modalStack.length === 0) {
      dom.backdrop.hidden = true;
      document.body.classList.remove('modal-open');
    }
    dom.backdrop.classList.toggle('over-dialog', modalStack.length > 1);
    if (restoreFocus === false) return;
    const target = entry.returnFocus && document.contains(entry.returnFocus) ? entry.returnFocus : entry.fallbackFocus;
    if (target && typeof target.focus === 'function') target.focus({ preventScroll: true });
  }

  function isModalOpen(node) { return modalStack.some(function (m) { return m.node === node; }); }

  function handleModalKeydown(e) {
    const top = modalStack[modalStack.length - 1];
    if (!top) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      closeModal(top.node);
      return;
    }
    if (e.key !== 'Tab') return;
    const items = focusableIn(top.node);
    if (!items.length) { e.preventDefault(); return; }
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    const outside = !top.node.contains(active);
    if (e.shiftKey && (active === first || outside)) { e.preventDefault(); last.focus(); }
    else if (!e.shiftKey && (active === last || outside)) { e.preventDefault(); first.focus(); }
  }

  /** Accessible replacement for window.confirm(). Resolves true/false. */
  function confirmDialog(options) {
    return new Promise(function (resolve) {
      let confirmed = false;
      dom.confirmTitle.textContent = options.title;
      dom.confirmMessage.textContent = options.message;
      dom.confirmOk.textContent = options.confirmText || 'Confirm';
      dom.confirmOk.onclick = function () { confirmed = true; closeModal(dom.confirmDialog); };
      dom.confirmCancel.onclick = function () { closeModal(dom.confirmDialog); };
      openModal(dom.confirmDialog, {
        initialFocus: dom.confirmCancel,
        fallbackFocus: options.fallbackFocus,
        show: function () { dom.confirmDialog.hidden = false; },
        hide: function () { dom.confirmDialog.hidden = true; resolve(confirmed); },
      });
    });
  }

  // Transaction form: modal on mobile/tablet, side panel on desktop
  function openTransactionForm(tx) {
    if (tx) fillFormForEdit(tx);
    else resetForm();
    renderTransactions(monthTransactions(state.month)); // highlight the row being edited

    if (DESKTOP_QUERY.matches) {
      dom.txPanel.scrollIntoView({ behavior: REDUCED_MOTION.matches ? 'auto' : 'smooth', block: 'nearest' });
      dom.txAmount.focus({ preventScroll: true });
      return;
    }
    if (isModalOpen(dom.txPanel)) return;
    openModal(dom.txPanel, {
      initialFocus: dom.txAmount,
      fallbackFocus: dom.addTxBtn,
      show: function () {
        dom.txPanel.classList.add('is-open');
        dom.txPanel.setAttribute('role', 'dialog');
        dom.txPanel.setAttribute('aria-modal', 'true');
      },
      hide: function () {
        dom.txPanel.classList.remove('is-open');
        dom.txPanel.removeAttribute('role');
        dom.txPanel.removeAttribute('aria-modal');
      },
    });
  }

  function closeTransactionForm() {
    const wasEditing = state.editingId !== null;
    resetForm();
    if (isModalOpen(dom.txPanel)) closeModal(dom.txPanel);
    if (wasEditing) renderTransactions(monthTransactions(state.month));
  }

  // ==========================================================================
  // THEME
  // ==========================================================================

  function resolvedTheme() {
    if (state.theme === 'system') return DARK_QUERY.matches ? 'dark' : 'light';
    return state.theme;
  }

  function applyTheme() {
    document.documentElement.setAttribute('data-theme', resolvedTheme());
    const radio = document.querySelector('input[name="theme"][value="' + state.theme + '"]');
    if (radio) radio.checked = true;
    const meta = document.querySelector('meta[name="theme-color"]');
    if (meta) meta.setAttribute('content', cssVar('--bg'));
    // Rebuild charts so every color (segments' borders, ticks, grid, legend, tooltips) picks up the new theme
    destroyAllCharts();
    renderCharts(monthTransactions(state.month));
  }

  // ==========================================================================
  // EVENTS
  // ==========================================================================

  function goToMonth(ym) {
    state.month = ym;
    renderAll();
  }

  function onTransactionSubmit(e) {
    e.preventDefault();
    const data = readTransactionForm();
    if (!data) return;

    const editing = state.editingId;
    if (editing) {
      updateTransaction(editing, data);
      toast('Transaction updated');
    } else {
      addTransaction(data);
      toast('Transaction added');
    }

    // If the entry belongs to another month, jump there so the user sees it
    const d = parseLocalDate(data.date);
    const targetMonth = { year: d.getFullYear(), month: d.getMonth() };
    if (monthKey(targetMonth) !== monthKey(state.month)) {
      state.month = targetMonth;
      toast('Showing ' + monthLabel(targetMonth));
    }

    const keepType = data.type;
    closeTransactionForm();
    if (!editing) { setFormType(keepType); populateFormCategories(''); }
    renderAll();
    if (DESKTOP_QUERY.matches && !editing) dom.txAmount.focus({ preventScroll: true });
  }

  function onListClick(e) {
    const button = e.target.closest('button[data-action]');
    if (!button) return;
    const tx = state.transactions.find(function (t) { return t.id === button.dataset.id; });
    if (!tx) return;

    if (button.dataset.action === 'edit') {
      openTransactionForm(tx);
      return;
    }

    const cat = categoryOrFallback(tx.categoryId, tx.type);
    confirmDialog({
      title: 'Delete transaction?',
      message: cat.name + ' · ' + formatMoney(tx.amountCents) + ' on ' + formatDate(tx.date) + '. This can\'t be undone.',
      confirmText: 'Delete',
      fallbackFocus: dom.txHeading,
    }).then(function (ok) {
      if (!ok) return;
      deleteTransaction(tx.id);
      if (state.editingId === tx.id) closeTransactionForm();
      renderAll();
      toast('Transaction deleted');
    });
  }

  /** Save a budget input. keepFocus=true re-focuses the same input (Enter); otherwise focus stays wherever it moved (Tab/click). */
  function commitBudget(input, keepFocus) {
    const id = input.dataset.budgetFor;
    const errorEl = document.getElementById(input.id + '-error');
    const raw = input.value.trim();
    if (raw === '') {
      setFieldError(input, errorEl, '');
      if (!state.budgets[id]) return;
      delete state.budgets[id];
    } else {
      const parsed = parseAmount(raw);
      if (parsed.error) { setFieldError(input, errorEl, parsed.error.replace('Amount', 'Budget')); return; }
      setFieldError(input, errorEl, '');
      if (state.budgets[id] === parsed.cents) { input.value = centsToPlain(parsed.cents); return; }
      state.budgets[id] = parsed.cents;
    }
    saveBudgets();
    // Deferred so focus has already moved (e.g. Tab to the next budget) before rows are rebuilt
    setTimeout(function () {
      const focusId = keepFocus ? input.id : (document.activeElement && document.activeElement.id);
      renderBudgets(monthTransactions(state.month));
      const node = focusId && document.getElementById(focusId);
      if (node && document.activeElement !== node) node.focus({ preventScroll: true });
    }, 0);
  }

  function onCategorySubmit(e) {
    e.preventDefault();
    const name = dom.catName.value.trim().replace(/\s+/g, ' ');
    const type = dom.catType.value === 'income' ? 'income' : 'expense';
    let error = '';
    if (!name) error = 'Category name is required.';
    else if (name.length > CATEGORY_NAME_MAX) error = 'Use ' + CATEGORY_NAME_MAX + ' characters or fewer.';
    else if (allCategories().some(function (c) { return c.name.toLowerCase() === name.toLowerCase(); })) error = 'A category with this name already exists.';
    setFieldError(dom.catName, dom.catNameError, error);
    if (error) { dom.catName.focus(); return; }

    addCustomCategory(name, type);
    dom.catName.value = '';
    populateFormCategories(dom.txCategory.value);
    renderAll();
    toast('Category "' + name + '" added');
  }

  function onCategoryListClick(e) {
    const button = e.target.closest('button[data-delete-category]');
    if (!button) return;
    const cat = getCategory(button.dataset.deleteCategory);
    if (!cat || cat.isDefault) return;
    const count = countTransactionsInCategory(cat.id);
    const fallbackName = getCategory(FALLBACK_CATEGORY[cat.type]).name;
    confirmDialog({
      title: 'Delete "' + cat.name + '"?',
      message: count
        ? plural(count, 'transaction') + ' in this category will move to "' + fallbackName + '".'
        : 'This category has no transactions.',
      confirmText: 'Delete category',
      fallbackFocus: dom.catName,
    }).then(function (ok) {
      if (!ok) return;
      const moved = deleteCustomCategory(cat.id);
      populateFormCategories(dom.txCategory.value);
      renderAll();
      toast('Category deleted' + (moved ? ' · ' + plural(moved, 'transaction') + ' moved to ' + fallbackName : ''));
    });
  }

  function onExport() {
    if (!state.transactions.length) { toast('No transactions to export yet.'); return; }
    const blob = new Blob(['﻿' + buildCsv()], { type: 'text/csv;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = el('a', { href: url, download: 'budgetly-transactions-' + todayISO() + '.csv' });
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(function () { URL.revokeObjectURL(url); }, 1000);
    toast('Exported ' + plural(state.transactions.length, 'transaction'));
  }

  function onLoadSample() {
    const run = function () {
      state.transactions = buildSampleTransactions();
      state.budgets = Object.assign({}, SAMPLE_BUDGETS);
      state.filters = { type: 'all', categoryId: 'all', search: '' };
      resetFilterControls();
      const now = new Date();
      state.month = { year: now.getFullYear(), month: now.getMonth() };
      saveAll();
      closeTransactionForm();
      renderAll();
      toast('Sample data loaded');
    };
    if (!state.transactions.length) { run(); return; }
    confirmDialog({
      title: 'Load sample data?',
      message: 'This replaces your ' + plural(state.transactions.length, 'transaction') + ' and budgets with 6 months of demo data. Custom categories are kept.',
      confirmText: 'Replace with sample',
      fallbackFocus: dom.sampleBtn,
    }).then(function (ok) { if (ok) run(); });
  }

  function onReset() {
    confirmDialog({
      title: 'Reset all data?',
      message: 'This permanently deletes all transactions, custom categories, and budgets stored in this browser. Your theme choice is kept.',
      confirmText: 'Reset everything',
      fallbackFocus: dom.resetBtn,
    }).then(function (ok) {
      if (!ok) return;
      state.transactions = [];
      state.customCategories = [];
      state.budgets = {};
      state.filters = { type: 'all', categoryId: 'all', search: '' };
      resetFilterControls();
      saveAll(); // saving an empty list means sample data won't auto-load again
      closeTransactionForm();
      renderAll();
      toast('All data reset');
    });
  }

  function resetFilterControls() {
    const all = document.getElementById('filter-all');
    if (all) all.checked = true;
    dom.filterSearch.value = '';
  }

  function addMediaListener(query, handler) {
    if (typeof query.addEventListener === 'function') query.addEventListener('change', handler);
    else if (typeof query.addListener === 'function') query.addListener(handler);
  }

  function bindEvents() {
    dom.prevMonth.addEventListener('click', function () { goToMonth(addMonths(state.month, -1)); });
    dom.nextMonth.addEventListener('click', function () { goToMonth(addMonths(state.month, 1)); });
    dom.todayBtn.addEventListener('click', function () {
      const now = new Date();
      goToMonth({ year: now.getFullYear(), month: now.getMonth() });
      dom.nextMonth.focus();
    });

    // Theme
    document.querySelectorAll('input[name="theme"]').forEach(function (radio) {
      radio.addEventListener('change', function () {
        state.theme = radio.value;
        saveTheme();
        applyTheme();
      });
    });
    addMediaListener(DARK_QUERY, function () { if (state.theme === 'system') applyTheme(); });

    // Filters
    document.querySelectorAll('input[name="filter-type"]').forEach(function (radio) {
      radio.addEventListener('change', function () {
        state.filters.type = radio.value;
        renderFilterOptions();
        renderTransactions(monthTransactions(state.month));
      });
    });
    dom.filterCategory.addEventListener('change', function () {
      state.filters.categoryId = dom.filterCategory.value;
      renderTransactions(monthTransactions(state.month));
    });
    dom.filterSearch.addEventListener('input', function () {
      state.filters.search = dom.filterSearch.value;
      renderTransactions(monthTransactions(state.month));
    });
    dom.clearFiltersBtn.addEventListener('click', function () {
      state.filters = { type: 'all', categoryId: 'all', search: '' };
      resetFilterControls();
      renderFilterOptions();
      renderTransactions(monthTransactions(state.month));
      dom.filterSearch.focus();
    });

    // Transactions
    dom.addTxBtn.addEventListener('click', function () { openTransactionForm(null); });
    dom.txList.addEventListener('click', onListClick);
    dom.txForm.addEventListener('submit', onTransactionSubmit);
    dom.txCancel.addEventListener('click', closeTransactionForm);
    dom.panelClose.addEventListener('click', closeTransactionForm);
    dom.txForm.querySelectorAll('input[name="type"]').forEach(function (radio) {
      radio.addEventListener('change', function () {
        populateFormCategories(dom.txCategory.value);
        setFieldError(dom.txCategory, dom.txCategoryError, '');
      });
    });
    dom.txNote.addEventListener('input', function () { updateNoteCount(); setFieldError(dom.txNote, dom.txNoteError, ''); });
    [[dom.txAmount, dom.txAmountError], [dom.txCategory, dom.txCategoryError], [dom.txDate, dom.txDateError]].forEach(function (pair) {
      pair[0].addEventListener('input', function () { setFieldError(pair[0], pair[1], ''); });
      pair[0].addEventListener('change', function () { setFieldError(pair[0], pair[1], ''); });
    });

    // Budgets (delegated: rows are re-rendered)
    dom.budgetList.addEventListener('change', function (e) {
      if (e.target.matches('input[data-budget-for]')) commitBudget(e.target, false);
    });
    dom.budgetList.addEventListener('keydown', function (e) {
      if (e.key === 'Enter' && e.target.matches('input[data-budget-for]')) {
        e.preventDefault();
        commitBudget(e.target, true);
      }
    });

    // Categories
    dom.categoryForm.addEventListener('submit', onCategorySubmit);
    dom.catName.addEventListener('input', function () { setFieldError(dom.catName, dom.catNameError, ''); });
    dom.categoryList.addEventListener('click', onCategoryListClick);

    // Data
    dom.exportBtn.addEventListener('click', onExport);
    dom.sampleBtn.addEventListener('click', onLoadSample);
    dom.resetBtn.addEventListener('click', onReset);

    // Modals
    document.addEventListener('keydown', handleModalKeydown);
    dom.backdrop.addEventListener('click', function () {
      const top = modalStack[modalStack.length - 1];
      if (top) closeModal(top.node);
    });

    // Switching to desktop while the mobile modal is open: turn it back into the side panel
    addMediaListener(DESKTOP_QUERY, function () {
      if (DESKTOP_QUERY.matches && isModalOpen(dom.txPanel)) closeModal(dom.txPanel, false);
    });
  }

  // ==========================================================================
  // INIT
  // ==========================================================================

  function init() {
    cacheDom();
    const sampleLoaded = loadState();
    dom.storageBanner.hidden = state.storageOK;
    bindEvents();
    resetForm();
    renderAll();
    applyTheme();
    if (sampleLoaded && state.storageOK) toast('Sample data loaded so you can explore. Use “Reset all data” to start fresh.');
  }

  init();
})();
