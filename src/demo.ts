// Sample notes for the demo mode (kept in memory, nothing leaves the page).

import { FakeGitHub } from "./core/fake";

const en: Record<string, string> = {
  "Welcome.md": `# Welcome to Notewing

Notewing keeps your notes as **Markdown files in your own GitHub repository**. There is no Notewing server: the app talks to GitHub directly from your browser.

- [x] Write in Markdown, see the preview side by side
- [x] Work offline: changes are saved in the browser and pushed later
- [ ] Try the search: press **Ctrl + K**
- [ ] Paste a screenshot into a note, it is stored in the repository

> This is the demo. Nothing you write here is saved when you close the tab.

See [the shortcuts](Help/Keyboard%20shortcuts.md) and [the reading list](Personal/Reading%20list.md).
`,
  "Help/Keyboard shortcuts.md": `# Keyboard shortcuts

| Keys | Action |
|---|---|
| Ctrl + K | Search notes |
| Alt + N | New note |
| Ctrl + S | Sync now |
| Ctrl + E | Switch between editing and preview |
| Ctrl + Shift + F | Focus mode |
| Ctrl + \\ | Show or hide the sidebar |

On a Mac use ⌘ instead of Ctrl.
`,
  "Help/Markdown cheatsheet.md": `# Markdown cheatsheet

## Text

**bold**, *italic*, ~~strikethrough~~, \`inline code\`, [link](https://commonmark.org/help/)

## Code

\`\`\`js
const note = await repo.text("Welcome.md");
console.log(note.length);
\`\`\`

## Tasks

- [ ] open
- [x] done
`,
  "Work/Project plan.md": `# Project plan

1. Collect requirements
2. Draft the design
3. Review with the team

## Risks

- Deadlines are tight
- The API is not final
`,
  "Work/Meeting notes 2026-09-21.md": `# Meeting notes

**Attendees:** Anna, Ben, Chen

- Agreed on the release date
- Ben will prepare the demo
- [ ] Send the summary to the team
`,
  "Personal/Reading list.md": `# Reading list

- [x] *The Pragmatic Programmer*
- [ ] *Designing Data-Intensive Applications*
- [ ] *A Philosophy of Software Design*
`,
  "Personal/Recipes/Pancakes.md": `# Pancakes

- 200 g flour
- 2 eggs
- 300 ml milk
- a pinch of salt

Mix, rest for 10 minutes, fry on a hot pan.
`,
};

const ru: Record<string, string> = {
  "Добро пожаловать.md": `# Добро пожаловать в Notewing

Notewing хранит заметки как **Markdown-файлы в вашем собственном репозитории на GitHub**. Своего сервера у Notewing нет: приложение обращается к GitHub прямо из браузера.

- [x] Пишите в Markdown и сразу видите результат
- [x] Работайте без интернета: изменения сохраняются в браузере и отправляются позже
- [ ] Попробуйте поиск: нажмите **Ctrl + K**
- [ ] Вставьте скриншот в заметку, он сохранится в репозитории

> Это демо. Всё, что вы здесь напишете, исчезнет после закрытия вкладки.

Смотрите [горячие клавиши](Справка/Горячие%20клавиши.md) и [список книг](Личное/Что%20почитать.md).
`,
  "Справка/Горячие клавиши.md": `# Горячие клавиши

| Клавиши | Действие |
|---|---|
| Ctrl + K | Поиск по заметкам |
| Alt + N | Новая заметка |
| Ctrl + S | Синхронизировать |
| Ctrl + E | Переключить редактор и просмотр |
| Ctrl + Shift + F | Режим фокуса |
| Ctrl + \\ | Показать или скрыть боковую панель |

На Mac вместо Ctrl используйте ⌘.
`,
  "Справка/Шпаргалка по Markdown.md": `# Шпаргалка по Markdown

## Текст

**жирный**, *курсив*, ~~зачёркнутый~~, \`код\`, [ссылка](https://commonmark.org/help/)

## Код

\`\`\`js
const note = await repo.text("Добро пожаловать.md");
console.log(note.length);
\`\`\`

## Задачи

- [ ] открыта
- [x] готово
`,
  "Работа/План проекта.md": `# План проекта

1. Собрать требования
2. Сделать черновик дизайна
3. Обсудить с командой

## Риски

- Сжатые сроки
- API ещё меняется
`,
  "Работа/Встреча 2026-09-21.md": `# Заметки со встречи

**Участники:** Анна, Борис, Вера

- Согласовали дату релиза
- Борис готовит демо
- [ ] Разослать итоги команде
`,
  "Личное/Что почитать.md": `# Что почитать

- [x] «Программист-прагматик»
- [ ] «Высоконагруженные приложения»
- [ ] «Философия проектирования ПО»
`,
  "Личное/Рецепты/Блины.md": `# Блины

- 200 г муки
- 2 яйца
- 300 мл молока
- щепотка соли

Смешать, дать постоять 10 минут, жарить на горячей сковороде.
`,
};

export async function demoGitHub(lang: string): Promise<FakeGitHub> {
  const fake = new FakeGitHub("demo", "notes", "main");
  const day = 86400000;
  const files = lang === "ru" ? ru : en;
  await fake.commit(files, lang === "ru" ? "Первые заметки" : "First notes", new Date(Date.now() - 3 * day).toISOString());
  return fake;
}
