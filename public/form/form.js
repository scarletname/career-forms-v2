const formId = decodeURIComponent(location.pathname.split('/')[2] || '');
const isPreview = new URLSearchParams(location.search).has('preview');
const app = document.getElementById('app');

const DRAFT_KEY = `draft:${formId}`;
const SESSION_KEY = `session:${formId}`;
const INPUT_TYPES = { text: 'text', email: 'email', date: 'date' };
const MAX_LENGTH = { text: 500, textarea: 5000, email: 254 };

let form = null;
let started = false;
let lastFocusedField = null;

// localStorage может быть недоступен (приватный режим, запрет cookies) — форма должна работать и без него
function storageGet(key) {
    try { return localStorage.getItem(key); } catch { return null; }
}
function storageSet(key, value) {
    try { localStorage.setItem(key, value); } catch { /* без черновика */ }
}
function storageRemove(key) {
    try { localStorage.removeItem(key); } catch { /* нечего удалять */ }
}

// crypto.randomUUID есть только на https и localhost, а с телефона по локальной сети его нет
function randomId() {
    if (window.crypto?.randomUUID) return crypto.randomUUID();
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 12);
}

function getSessionId() {
    let id = storageGet(SESSION_KEY);
    if (!id) {
        id = randomId();
        storageSet(SESSION_KEY, id);
    }
    return id;
}

const sessionId = getSessionId();

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

function apiUrl(path) {
    return `/api/${path}/${encodeURIComponent(formId)}`;
}

function sendEvent(type, fieldId) {
    if (isPreview || form?.status !== 'published') return;
    fetch(`${apiUrl('public/forms')}/events`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sessionId, type, fieldId }),
        keepalive: true,
    }).catch(() => { /* аналитика не должна мешать заполнению */ });
}

function showMessage(title, text) {
    app.replaceChildren(el('h1', { text: title }), el('p', { text }));
}

function readDraft() {
    try { return JSON.parse(storageGet(DRAFT_KEY)) || {}; } catch { return {}; }
}

function collectAnswers(formEl) {
    const data = new FormData(formEl);
    const answers = {};
    for (const field of form.fields) {
        answers[field.id] = field.type === 'multi' ? data.getAll(field.id) : (data.get(field.id) ?? '');
    }
    return { answers, consent: data.get('consent') === 'on' };
}

function renderChoiceField(field, saved, errorId, title) {
    const fieldset = el('fieldset', {}, [el('legend', { text: title })]);
    const savedIds = Array.isArray(saved) ? saved : [saved];
    const type = field.type === 'single' ? 'radio' : 'checkbox';

    for (const option of field.options) {
        const input = el('input', { type, name: field.id, value: option.id, checked: savedIds.includes(option.id) });
        input.setAttribute('aria-describedby', errorId);
        fieldset.append(el('label', { className: 'option' }, [input, el('span', { text: option.label })]));
    }
    return [fieldset];
}

function renderInputField(field, saved, errorId, title) {
    const inputId = `input-${field.id}`;
    const input = field.type === 'textarea'
        ? el('textarea', { id: inputId, name: field.id, rows: 5 })
        : el('input', { id: inputId, name: field.id, type: INPUT_TYPES[field.type] });

    if (MAX_LENGTH[field.type]) input.maxLength = MAX_LENGTH[field.type];
    if (field.type === 'email') input.autocomplete = 'email';
    input.required = field.required;
    input.value = typeof saved === 'string' ? saved : '';
    input.setAttribute('aria-describedby', errorId);

    return [el('label', { htmlFor: inputId, text: title }), input];
}

function renderField(field, saved) {
    const errorId = `error-${field.id}`;
    const title = field.label + (field.required ? ' *' : '');
    const isChoice = field.type === 'single' || field.type === 'multi';
    const parts = isChoice
        ? renderChoiceField(field, saved, errorId, title)
        : renderInputField(field, saved, errorId, title);

    const wrapper = el('div', { className: 'field' }, [...parts, el('p', { className: 'error', id: errorId })]);
    wrapper.dataset.fieldId = field.id;
    return wrapper;
}

function renderConsent() {
    const input = el('input', { type: 'checkbox', name: 'consent' });
    input.setAttribute('aria-describedby', 'error-consent');

    const wrapper = el('div', { className: 'field' }, [
        el('label', { className: 'option' }, [input, el('span', { text: 'Я согласен(на) на обработку персональных данных *' })]),
        el('p', { className: 'error', id: 'error-consent' }),
    ]);
    wrapper.dataset.fieldId = 'consent';
    return wrapper;
}

function renderForm() {
    const draft = readDraft();
    const formEl = el('form', { className: 'form', noValidate: true });

    for (const field of form.fields) formEl.append(renderField(field, draft[field.id]));
    formEl.append(
        renderConsent(),
        el('p', { className: 'form-error', id: 'form-error', role: 'alert' }),
        el('button', { type: 'submit', className: 'submit', text: 'Отправить заявку', disabled: isPreview }),
    );

    formEl.addEventListener('input', onInput);
    formEl.addEventListener('focusin', onFocus);
    formEl.addEventListener('submit', onSubmit);

    const header = [el('h1', { text: form.title })];
    if (isPreview) header.unshift(el('p', { className: 'preview-banner', text: 'Предпросмотр: так форму увидят студенты. Отправка отключена.' }));
    if (form.description) header.push(el('p', { className: 'description', text: form.description }));
    header.push(el('p', { className: 'muted', text: '* — обязательные поля' }));

    app.replaceChildren(...header, formEl);
}

function clearError(wrapper) {
    if (!wrapper) return;
    wrapper.classList.remove('has-error');
    wrapper.querySelector('.error').textContent = '';
}

// Возвращает true, если сервер прислал ошибку по полю, которого нет на странице (форму изменили)
function showErrors(formEl, details) {
    let first = null;
    let missing = false;

    for (const [fieldId, message] of Object.entries(details)) {
        const wrapper = formEl.querySelector(`[data-field-id="${CSS.escape(fieldId)}"]`);
        if (!wrapper) {
            missing = true;
            continue;
        }
        wrapper.classList.add('has-error');
        wrapper.querySelector('.error').textContent = message;
        first ??= wrapper;
    }
    first?.querySelector('input, textarea')?.focus();
    return missing;
}

function onInput(event) {
    clearError(event.target.closest('.field'));
    if (isPreview) return;

    storageSet(DRAFT_KEY, JSON.stringify(collectAnswers(event.currentTarget).answers));
    if (!started) {
        started = true;
        sendEvent('start');
    }
}

function onFocus(event) {
    const fieldId = event.target.closest('.field')?.dataset.fieldId;
    if (!fieldId || fieldId === 'consent' || fieldId === lastFocusedField) return;
    lastFocusedField = fieldId;
    sendEvent('field', fieldId);
}

async function onSubmit(event) {
    event.preventDefault();
    if (isPreview) return;

    const formEl = event.currentTarget;
    const button = formEl.querySelector('.submit');
    const formError = formEl.querySelector('#form-error');

    formEl.querySelectorAll('.field').forEach(clearError);
    formError.textContent = '';
    button.disabled = true;
    button.textContent = 'Отправляем…';

    try {
        const res = await fetch(`${apiUrl('public/forms')}/responses`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ ...collectAnswers(formEl), sessionId }),
        });
        const body = await res.json().catch(() => ({}));

        if (res.ok) {
            storageRemove(DRAFT_KEY);
            showMessage('Заявка отправлена', 'Спасибо! Организаторы получили ваши ответы.');
            return;
        }
        if (res.status === 400 && body.details) {
            const missing = showErrors(formEl, body.details);
            formError.textContent = missing
                ? 'Организатор изменил форму. Обновите страницу — введённые ответы сохранятся.'
                : 'Исправьте ошибки в отмеченных полях.';
        } else {
            formError.textContent = body.error || 'Не удалось отправить заявку. Попробуйте ещё раз.';
        }
    } catch {
        formError.textContent = 'Нет соединения с сервером. Ответы сохранены, попробуйте отправить ещё раз.';
    }

    button.disabled = false;
    button.textContent = 'Отправить заявку';
}

async function load() {
    const url = isPreview ? apiUrl('forms') : apiUrl('public/forms');
    try {
        const res = await fetch(url);
        if (!res.ok) {
            showMessage('Форма не найдена', 'Проверьте ссылку или обратитесь к организатору.');
            return;
        }
        form = await res.json();
    } catch {
        showMessage('Не удалось загрузить форму', 'Проверьте подключение к интернету и обновите страницу.');
        return;
    }

    document.title = form.title;
    if (!isPreview && form.status === 'closed') {
        showMessage(form.title, 'Приём заявок по этой форме закрыт.');
        return;
    }
    renderForm();
    sendEvent('open');
}

load();
