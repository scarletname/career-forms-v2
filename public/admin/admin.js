const app = document.getElementById('app');

const FIELD_TYPES = [
    { type: 'text', label: 'Короткий текст' },
    { type: 'textarea', label: 'Длинный текст' },
    { type: 'email', label: 'Email' },
    { type: 'date', label: 'Дата' },
    { type: 'single', label: 'Один вариант' },
    { type: 'multi', label: 'Несколько вариантов' },
];
const CHOICE_TYPES = ['single', 'multi'];
const STATUS_LABELS = { draft: 'Черновик', published: 'Опубликована', closed: 'Приём закрыт' };
const TABS = [
    { id: 'builder', label: 'Конструктор' },
    { id: 'responses', label: 'Ответы' },
    { id: 'stats', label: 'Статистика' },
];

// Открытая форма: form — как сохранено на сервере, draft — копия, которую редактирует менеджер
let editor = null;
let lastHash = location.hash;

// Весь текст из данных выводится через textContent — так он не может стать HTML-разметкой
function el(tag, props = {}, children = []) {
    const node = document.createElement(tag);
    for (const [key, value] of Object.entries(props)) {
        if (key === 'text') node.textContent = value;
        else node[key] = value;
    }
    node.append(...children);
    return node;
}

function labeled(text, input) {
    return el('label', { className: 'label' }, [el('span', { text }), input]);
}

function iconButton(text, title, disabled, onclick) {
    const button = el('button', { type: 'button', className: 'btn icon', text, title, disabled, onclick });
    button.setAttribute('aria-label', title);
    return button;
}

function plural(n, forms) {
    const mod10 = n % 10;
    const mod100 = n % 100;
    if (mod10 === 1 && mod100 !== 11) return forms[0];
    if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
    return forms[2];
}

function formatDate(iso) {
    return new Date(iso).toLocaleString('ru-RU', { dateStyle: 'medium', timeStyle: 'short' });
}

function percent(part, total) {
    return total ? `${Math.round((part / total) * 100)}%` : '—';
}

async function api(path, { method = 'GET', body } = {}) {
    const res = await fetch(`/api${path}`, {
        method,
        headers: body ? { 'Content-Type': 'application/json' } : {},
        body: body ? JSON.stringify(body) : undefined,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
        const err = new Error(data.error || 'Ошибка сервера');
        err.details = data.details;
        throw err;
    }
    return data;
}

// ---------- Навигация: #/ — список, #/forms/<id>/<вкладка> — форма ----------

function parseHash() {
    const [, section, id, tab] = location.hash.split('/');
    if (section !== 'forms' || !id) return null;
    return { id: decodeURIComponent(id), tab: TABS.some((t) => t.id === tab) ? tab : 'builder' };
}

async function route() {
    const target = parseHash();
    if (editor?.dirty && target?.id !== editor.form.id) {
        if (!confirm('Есть несохранённые изменения. Уйти без сохранения?')) {
            history.replaceState(null, '', lastHash || '#/');
            return;
        }
    }
    lastHash = location.hash;

    try {
        if (target) await openForm(target.id, target.tab);
        else await renderList();
    } catch (err) {
        editor = null;
        app.replaceChildren(
            el('p', { className: 'notice error', text: err.message }),
            el('a', { href: '#/', text: '← К списку форм' }),
        );
    }
}

window.addEventListener('hashchange', route);
window.addEventListener('beforeunload', (event) => {
    if (!editor?.dirty) return;
    event.preventDefault();
    event.returnValue = '';
});

// ---------- Список форм ----------

function statusBadge(status) {
    return el('span', { className: `badge ${status}`, text: STATUS_LABELS[status] });
}

async function createForm() {
    try {
        const form = await api('/forms', { method: 'POST' });
        location.hash = `#/forms/${form.id}`;
    } catch (err) {
        alert(err.message);
    }
}

async function renderList() {
    editor = null;
    document.title = 'Формы — админка';
    const forms = await api('/forms');

    const header = el('div', { className: 'page-header' }, [
        el('h1', { text: 'Формы' }),
        el('button', { className: 'btn primary', text: '+ Новая форма', onclick: createForm }),
    ]);

    if (!forms.length) {
        app.replaceChildren(header, el('p', {
            className: 'empty',
            text: 'Форм пока нет. Создайте первую: добавьте вопросы, опубликуйте и отправьте ссылку студентам.',
        }));
        return;
    }

    const cards = forms.map((form) => el('a', { className: 'card form-card', href: `#/forms/${form.id}` }, [
        el('div', { className: 'form-card-title' }, [el('strong', { text: form.title }), statusBadge(form.status)]),
        el('div', {
            className: 'muted',
            text: `${form.fieldsCount} ${plural(form.fieldsCount, ['вопрос', 'вопроса', 'вопросов'])} · `
                + `${form.responsesCount} ${plural(form.responsesCount, ['заявка', 'заявки', 'заявок'])} · `
                + `изменена ${formatDate(form.updatedAt)}`,
        }),
    ]));
    app.replaceChildren(header, el('div', { className: 'form-list' }, cards));
}

// ---------- Страница формы ----------

async function openForm(id, tab) {
    if (editor?.form.id !== id) {
        const path = `/forms/${encodeURIComponent(id)}`;
        const [form, responses] = await Promise.all([api(path), api(`${path}/responses`)]);
        editor = { form, draft: structuredClone(form), dirty: false, errors: [], responses, selectedResponseId: null };
    }
    editor.tab = tab;
    renderEditor();
}

function renderEditor() {
    const { form, tab } = editor;
    document.title = `${form.title} — админка`;

    const content = el('div', { className: 'tab-content' });
    app.replaceChildren(
        el('a', { href: '#/', className: 'back', text: '← Все формы' }),
        renderFormHeader(),
        renderTabs(),
        content,
    );

    if (tab === 'builder') renderBuilder(content);
    if (tab === 'responses') renderResponses(content);
    if (tab === 'stats') renderStats(content);
}

function renderFormHeader() {
    const { form } = editor;
    const header = el('div', { className: 'page-header' }, [
        el('div', { className: 'title-row' }, [el('h1', { text: form.title }), statusBadge(form.status)]),
        el('div', { className: 'actions' }, [
            el('a', { className: 'btn', href: `/f/${form.id}?preview`, target: '_blank', text: 'Предпросмотр' }),
            ...statusButtons(form.status),
        ]),
    ]);
    return form.status === 'draft' ? header : el('div', {}, [header, renderPublicLink(form)]);
}

function statusButtons(status) {
    if (status === 'draft') {
        return [el('button', {
            className: 'btn primary',
            text: 'Опубликовать',
            onclick: () => changeStatus('published', 'Форма станет доступна по ссылке. Вернуть её в черновик будет нельзя. Опубликовать?'),
        })];
    }
    if (status === 'published') {
        return [el('button', {
            className: 'btn',
            text: 'Закрыть приём',
            onclick: () => changeStatus('closed', 'Студенты больше не смогут отправлять заявки. Закрыть приём?'),
        })];
    }
    return [el('button', { className: 'btn primary', text: 'Открыть приём снова', onclick: () => changeStatus('published') })];
}

async function changeStatus(next, question) {
    if (editor.dirty) {
        alert('Сначала сохраните изменения в конструкторе.');
        return;
    }
    if (question && !confirm(question)) return;

    try {
        const form = await api(`/forms/${editor.form.id}/status`, { method: 'POST', body: { status: next } });
        editor.form = form;
        editor.draft = structuredClone(form);
        renderEditor();
    } catch (err) {
        alert(err.message);
    }
}

function renderPublicLink(form) {
    const url = `${location.origin}/f/${form.id}`;
    const input = el('input', { className: 'input', value: url, readOnly: true, onfocus: (e) => e.target.select() });
    const copy = el('button', { className: 'btn', text: 'Копировать' });

    copy.onclick = async () => {
        try {
            await navigator.clipboard.writeText(url);
            copy.textContent = 'Скопировано';
        } catch {
            input.select();
            copy.textContent = 'Нажмите Ctrl+C';
        }
        setTimeout(() => { copy.textContent = 'Копировать'; }, 2000);
    };

    return el('div', { className: 'public-link' }, [el('span', { className: 'muted', text: 'Ссылка для студентов' }), input, copy]);
}

function renderTabs() {
    const { form, tab, responses } = editor;
    return el('nav', { className: 'tabs' }, TABS.map((t) => el('a', {
        className: t.id === tab ? 'tab active' : 'tab',
        href: `#/forms/${form.id}/${t.id}`,
        text: t.id === 'responses' ? `${t.label} (${responses.length})` : t.label,
    })));
}

// ---------- Конструктор ----------

function markDirty() {
    editor.dirty = true;
    document.getElementById('save-bar')?.replaceWith(renderSaveBar());
}

function renderBuilder(container) {
    const { draft, form } = editor;

    if (form.status !== 'draft') {
        container.append(el('p', {
            className: 'notice',
            text: 'Форма опубликована: после сохранения изменения сразу увидят студенты. Уже полученные заявки не изменятся.',
        }));
    }

    container.append(el('div', { className: 'card' }, [
        labeled('Название', el('input', {
            className: 'input', value: draft.title, maxLength: 200, placeholder: 'Например, «Летняя стажировка 2027»',
            oninput: (e) => { draft.title = e.target.value; markDirty(); },
        })),
        labeled('Описание для студентов', el('textarea', {
            className: 'input', value: draft.description, rows: 3, maxLength: 2000, placeholder: 'Необязательно',
            oninput: (e) => { draft.description = e.target.value; markDirty(); },
        })),
    ]));

    container.append(...draft.fields.map(renderFieldEditor));
    if (!draft.fields.length) {
        container.append(el('p', { className: 'empty', text: 'В форме пока нет вопросов. Выберите тип первого вопроса:' }));
    }

    container.append(
        el('div', { className: 'add-field' }, [
            el('span', { className: 'muted', text: 'Добавить вопрос:' }),
            ...FIELD_TYPES.map((t) => el('button', { className: 'btn small', text: t.label, onclick: () => addField(t.type) })),
        ]),
        renderErrors(),
        renderSaveBar(),
    );
}

function renderFieldEditor(field, index) {
    const last = editor.draft.fields.length - 1;
    const typeSelect = el('select', { className: 'input', onchange: (e) => changeType(field, e.target.value) },
        FIELD_TYPES.map((t) => el('option', { value: t.type, text: t.label, selected: t.type === field.type })));
    typeSelect.setAttribute('aria-label', 'Тип вопроса');

    const card = el('div', { className: 'card field-editor' }, [
        el('div', { className: 'field-head' }, [
            el('strong', { text: `Вопрос ${index + 1}` }),
            typeSelect,
            el('div', { className: 'field-tools' }, [
                iconButton('↑', 'Переместить выше', index === 0, () => moveField(index, -1)),
                iconButton('↓', 'Переместить ниже', index === last, () => moveField(index, 1)),
                iconButton('✕', 'Удалить вопрос', false, () => removeField(index)),
            ]),
        ]),
        labeled('Текст вопроса', el('input', {
            className: 'input', value: field.label, maxLength: 300,
            oninput: (e) => { field.label = e.target.value; markDirty(); },
        })),
        el('label', { className: 'check' }, [
            el('input', { type: 'checkbox', checked: field.required, onchange: (e) => { field.required = e.target.checked; markDirty(); } }),
            el('span', { text: 'Обязательный вопрос' }),
        ]),
    ]);

    if (CHOICE_TYPES.includes(field.type)) card.append(renderOptions(field));
    return card;
}

function renderOptions(field) {
    const rows = field.options.map((option, i) => el('div', { className: 'option-row' }, [
        el('span', { className: 'option-mark', text: field.type === 'single' ? '○' : '☐' }),
        el('input', {
            className: 'input', value: option.label, maxLength: 200, placeholder: `Вариант ${i + 1}`,
            oninput: (e) => { option.label = e.target.value; markDirty(); },
        }),
        // Сервер требует минимум два варианта, поэтому последние два удалить нельзя
        iconButton('✕', 'Удалить вариант', field.options.length <= 2, () => {
            field.options.splice(i, 1);
            markDirty();
            renderEditor();
        }),
    ]));

    const add = el('button', {
        className: 'btn small', text: '+ Вариант', disabled: field.options.length >= 30,
        onclick: () => {
            field.options.push({ label: '' });
            markDirty();
            renderEditor();
        },
    });
    return el('div', { className: 'options' }, [...rows, add]);
}

function addField(type) {
    const field = { type, label: '', required: false };
    if (CHOICE_TYPES.includes(type)) field.options = [{ label: '' }, { label: '' }];
    editor.draft.fields.push(field);
    markDirty();
    renderEditor();

    const cards = app.querySelectorAll('.field-editor');
    cards[cards.length - 1]?.querySelector('input.input')?.focus();
}

function changeType(field, type) {
    field.type = type;
    if (CHOICE_TYPES.includes(type)) field.options ??= [{ label: '' }, { label: '' }];
    else delete field.options;
    markDirty();
    renderEditor();
}

function moveField(index, delta) {
    const fields = editor.draft.fields;
    [fields[index], fields[index + delta]] = [fields[index + delta], fields[index]];
    markDirty();
    renderEditor();
}

function removeField(index) {
    const field = editor.draft.fields[index];
    const count = field.id ? editor.responses.length : 0;

    if (count) {
        const question = `По форме уже есть ${count} ${plural(count, ['заявка', 'заявки', 'заявок'])}. `
            + 'Ответы на этот вопрос останутся в них, но вопрос исчезнет из формы и статистики. Удалить?';
        if (!confirm(question)) return;
    } else if (field.label.trim() && !confirm('Удалить вопрос?')) {
        return;
    }

    editor.draft.fields.splice(index, 1);
    markDirty();
    renderEditor();
}

function renderErrors() {
    if (!editor.errors.length) return el('div');
    return el('div', { className: 'notice error', role: 'alert' }, [
        el('strong', { text: 'Форма не сохранена:' }),
        el('ul', {}, editor.errors.map((text) => el('li', { text }))),
    ]);
}

function renderSaveBar() {
    return el('div', { className: 'save-bar', id: 'save-bar' }, [
        el('button', { className: 'btn primary', text: 'Сохранить', disabled: !editor.dirty, onclick: save }),
        el('span', { className: 'muted', text: editor.dirty ? 'Есть несохранённые изменения' : 'Все изменения сохранены' }),
    ]);
}

async function save() {
    const { draft } = editor;
    try {
        const form = await api(`/forms/${editor.form.id}`, {
            method: 'PUT',
            body: { title: draft.title, description: draft.description, fields: draft.fields },
        });
        // Сервер выдал id новым полям и вариантам — дальше редактируем уже их
        Object.assign(editor, { form, draft: structuredClone(form), dirty: false, errors: [] });
    } catch (err) {
        editor.errors = Array.isArray(err.details) ? err.details : [err.message];
    }
    renderEditor();
}

// ---------- Ответы ----------

function responseTitle(response) {
    return response.answers.find((a) => a.type === 'text' && a.value)?.value ?? 'Заявка';
}

function formatAnswer(answer) {
    if (Array.isArray(answer.value)) return answer.value.join(', ');
    if (answer.type === 'date' && answer.value) {
        return new Date(answer.value).toLocaleDateString('ru-RU', { timeZone: 'UTC' });
    }
    return answer.value;
}

async function renderResponses(container) {
    container.append(el('p', { className: 'muted', text: 'Загрузка…' }));
    try {
        editor.responses = await api(`/forms/${editor.form.id}/responses`);
    } catch (err) {
        container.replaceChildren(el('p', { className: 'notice error', text: err.message }));
        return;
    }
    app.querySelector('.tab.active').textContent = `Ответы (${editor.responses.length})`;
    renderResponsesView(container);
}

function renderResponsesView(container) {
    const { responses, form } = editor;
    if (!responses.length) {
        container.replaceChildren(el('p', {
            className: 'empty',
            text: form.status === 'draft'
                ? 'Опубликуйте форму и отправьте ссылку студентам — заявки появятся здесь.'
                : 'Заявок пока нет.',
        }));
        return;
    }

    const selected = responses.find((r) => r.id === editor.selectedResponseId) ?? responses[0];
    const list = el('div', { className: 'response-list' }, responses.map((r) => el('button', {
        className: r === selected ? 'response-item active' : 'response-item',
        onclick: () => {
            editor.selectedResponseId = r.id;
            renderResponsesView(container);
        },
    }, [el('strong', { text: responseTitle(r) }), el('span', { className: 'muted', text: formatDate(r.submittedAt) })])));

    container.replaceChildren(el('div', { className: 'responses' }, [list, renderResponseDetail(selected)]));
}

// Показываем снимок из заявки, а не текущие вопросы формы
function renderResponseDetail(response) {
    const rows = response.answers.flatMap((answer) => {
        const value = formatAnswer(answer);
        return [
            el('dt', { text: answer.label }),
            el('dd', { className: value ? '' : 'muted', text: value || 'Не заполнено' }),
        ];
    });
    return el('div', { className: 'card response-detail' }, [
        el('p', { className: 'muted', text: `Отправлена ${formatDate(response.submittedAt)} · согласие на обработку данных получено` }),
        el('dl', {}, rows),
    ]);
}

// ---------- Статистика ----------

function tile(label, value, hint) {
    return el('div', { className: 'card tile' }, [
        el('span', { className: 'muted', text: label }),
        el('strong', { className: 'tile-value', text: String(value) }),
        el('span', { className: 'muted', text: hint || ' ' }),
    ]);
}

async function renderStats(container) {
    container.append(el('p', { className: 'muted', text: 'Загрузка…' }));
    let stats;
    try {
        stats = await api(`/forms/${editor.form.id}/stats`);
    } catch (err) {
        container.replaceChildren(el('p', { className: 'notice error', text: err.message }));
        return;
    }

    const abandoned = stats.started - stats.submitted;
    const parts = [
        el('div', { className: 'tiles' }, [
            tile('Открыли форму', stats.opened),
            tile('Начали заполнять', stats.started, `${percent(stats.started, stats.opened)} от открывших`),
            tile('Отправили', stats.submitted, `${percent(stats.submitted, stats.started)} от начавших`),
        ]),
    ];

    if (stats.responses !== stats.submitted) {
        parts.push(el('p', {
            className: 'muted',
            text: `Всего заявок: ${stats.responses}. Часть отправлена из браузеров, где не сохраняются данные сайта, поэтому не попала в воронку.`,
        }));
    }

    parts.push(el('h2', { text: 'Где останавливаются' }));
    if (!abandoned) {
        parts.push(el('p', { className: 'empty', text: 'Пока никто не бросил заполнение.' }));
        container.replaceChildren(...parts);
        return;
    }

    const max = Math.max(1, ...stats.dropOff.map((d) => d.count));
    const known = stats.dropOff.reduce((sum, d) => sum + d.count, 0);

    parts.push(
        el('p', {
            className: 'muted',
            text: `Начали, но не отправили: ${abandoned}. Для каждого вопроса — сколько студентов были на нём последними. `
                + 'Сюда попадают и те, кто заполняет форму прямо сейчас.',
        }),
        el('div', { className: 'card bars' }, stats.dropOff.map((d) => el('div', { className: 'bar-row' }, [
            el('span', { className: 'bar-label', text: d.label }),
            el('div', { className: 'bar' }, [el('div', { className: 'bar-fill', style: `width: ${(d.count / max) * 100}%` })]),
            el('span', { className: 'bar-value', text: String(d.count) }),
        ]))),
    );
    if (abandoned > known) {
        parts.push(el('p', { className: 'muted', text: `Ещё ${abandoned - known} — на вопросах, которые уже удалены из формы.` }));
    }
    container.replaceChildren(...parts);
}

route();
