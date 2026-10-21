# Budgetly

A personal monthly budget planner that runs entirely in your browser.

## Features

- **Transactions** – add, edit, and delete income and expenses (amount, category, date, optional note). Delete asks for confirmation.
- **Filters** – filter the month's list by type (All / Income / Expense) and category, and search notes.
- **Categories** – 14 default categories with fixed colors. Add your own; deleting a custom category moves its transactions to "Other" / "Other Income".
- **Monthly budgets** – optional limit per expense category with a progress bar (green under 80%, amber 80–100%, red over 100% with "Over by $X").
- **Dashboard** – month selector, Total Income, Total Expenses, Net, Savings Rate (N/A when income is $0), spending donut chart, 6-month income vs. expenses bar chart, and top 3 spending categories.
- **Data** – export all transactions to CSV, load sample data (6 months), reset everything. Sample data loads automatically on first visit.
- **Light / Dark / System theme** – System follows your OS setting live. Charts re-color with the theme.
- **Responsive and accessible** – works from 390px phones to desktop; labelled inputs, keyboard navigation, visible focus, focus-trapped dialogs that close with Escape.

Built with plain HTML, CSS, and vanilla JavaScript. [Chart.js](https://www.chartjs.org/) 4.4.1 is loaded from cdnjs. No frameworks, no npm, no build step.

## Run locally

Download or clone the repo, then open `index.html` in a browser. That's it.

(Charts need an internet connection to load Chart.js from the CDN. Everything else works offline.)

## Deploy on Netlify

1. In Netlify, choose **Add new site → Import an existing project** and pick this GitHub repo.
2. Leave the **build command** empty.
3. Set the **publish directory** to `.` (already set in `netlify.toml`).
4. Deploy.

## Your data

Everything (transactions, custom categories, budgets, theme) is saved in your browser's `localStorage`. Nothing is sent to a server. Data doesn't sync between browsers or devices, and clearing your browser's site data deletes it — use **Export CSV** to keep a copy.

---

Built by Ignacio Bembhy - FAU ISM Midterm
